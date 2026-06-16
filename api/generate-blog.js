// api/generate-blog.js
// Generates one weekly blog article for Travelgenix and publishes to Duda
// Can be triggered by cron (alongside social posts) or manually
// POST /api/generate-blog with Authorization: Bearer {CRON_SECRET}
//
// HARDENED 21 May 2026:
//   - BRAND_GUARDRAILS prepended to system prompt (anti-fabrication rules)
//   - assertGuardrailsPresent runs before the model call
//   - validateContent runs on blog body and LinkedIn teaser; if either fails,
//     Duda publish is REFUSED and the blog is saved as Quality Hold instead
//   - AUTO_PUBLISH_ENABLED env var also gates Duda publish: even with valid
//     content, the blog stays as Queued (not Published) when the kill switch
//     is on. Blog publishing IS auto-publishing — same kill switch applies.

const Anthropic = require("@anthropic-ai/sdk").default;
const { importAndPublishBlog } = require("./duda-blog.js");
const { promotionDecide, renderBlogSolutionsBlock } = require("../lib/promotion-client.js");
const { BRAND_GUARDRAILS } = require("./brand-guardrails.js");
const { validateContent } = require("./validate-content.js");
const { assertGuardrailsPresent } = require("../lib/generation-pipeline.js");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const QUEUE_TABLE = "tblbhyiuULvedva0K";
const TRAVELGENIX_CLIENT = "recFXQY7be6gMr4In";
const DUDA_SITE_ID = "89c0010b";
const CRON_SECRET = process.env.CRON_SECRET;

// Strip citation tags from AI output
function stripCitations(text) {
  if (!text) return "";
  return text
    .replace(/<\/?cite[^>]*>/gi, "")
    .replace(/<\/?antml:cite[^>]*>/gi, "")
    .replace(/\[source[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getNextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
  return d.toISOString().split("T")[0];
}

const BLOG_VOICE_PROMPT = `You are the content engine for Travelgenix — a UK-based travel technology SaaS company. You are writing a weekly blog article for travelgenix.io/blog.

## Voice
You are writing as Andy Speight, CEO of Travelgenix. The voice is warm, direct and a little playful. Knowledgeable but never condescending. Short sentences. Punchy. Like a smart friend giving honest advice.

## Rules
- UK English spelling (colour, favourite, travelling)
- No em dashes — use commas, full stops or en dashes
- No Oxford commas
- No "leverage", "utilize", "synergy", "game-changer", "innovative", "cutting-edge", "delve"
- No "In today's digital landscape" or similar AI filler
- No citation tags, source references, or markup from web search
- Use contractions naturally
- 600-800 words
- Include 2-3 real statistics or examples from your web research
- End with 5 numbered actionable tips
- Include a clear SEO meta description (max 155 characters)

## Content Approach
Search the web for current UK travel industry news from the last 7-14 days. Find an angle that matters to SME travel agents and tour operators. Connect the news to practical advice they can act on.

Topics should be relevant to: AI adoption, digital marketing, competing with OTAs, building client loyalty, technology adoption, SEO, social media, or growing a small travel business.

The article should be genuinely useful regardless of whether the reader is a Travelgenix client. Position Travelgenix as a knowledgeable friend who helps the travel trade thrive.

## Output Format
Return ONLY valid JSON. No markdown fences. No preamble.

{
  "title": "Blog title (max 70 chars for SEO)",
  "slug": "url-friendly-slug",
  "description": "SEO meta description (max 155 chars)",
  "content": "Full HTML blog article. Use <h2>, <h3>, <p>, <ol>, <li>, <strong> tags. No inline styles. No <h1> (Duda adds that from the title).",
  "excerpt": "2-3 sentence excerpt for social sharing",
  "imagePrompt": "Pexels search query for the hero image",
  "linkedInTeaser": "A LinkedIn post (max 1300 chars) promoting this blog article. Written as Andy in first person. Delivers value in the post itself, then invites them to read the full article.",
  "pillar": "Which content pillar this maps to"
}`;

async function searchPexelsImage(query) {
  const PEXELS_KEY = process.env.PEXELS_KEY;
  if (!PEXELS_KEY) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    const data = await res.json();
    if (data.photos && data.photos.length > 0) {
      return data.photos[0].src.large2x;
    }
  } catch (e) {
    console.error("Pexels error:", e.message);
  }
  return null;
}

async function writeToQueue(record) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [record], typecast: true }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("Queue write error:", err);
  }
  return res.json();
}

module.exports = async (req, res) => {
  // Auth check
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const testMode = req.query.test === "true";

  try {
    console.log("Generating weekly blog article for Travelgenix...");

    // Assemble the hardened system prompt: BRAND_GUARDRAILS comes first so the
    // anti-fabrication rules sit above everything else. The voice/style block
    // follows. assertGuardrailsPresent throws if the sentinel is missing.
    const systemPrompt = BRAND_GUARDRAILS + "\n\n" + BLOG_VOICE_PROMPT;
    assertGuardrailsPresent(systemPrompt);

    // Generate blog content with web search
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      temperature: 0.7,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content: `Write a blog article for Travelgenix for the week of ${getNextMonday()}. Search for current UK travel industry news first, then write the article. Remember: never invent client names, never invent statistics that aren't sourced from a real publication (cite ABTA / Skift / Travel Weekly / Phocuswright / Travolution etc. when quoting a stat), never name competitors. Return ONLY valid JSON.`,
        },
      ],
    });

    // Extract text
    let textContent = "";
    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      }
    }

    // Parse JSON
    const jsonStr = textContent
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let blog;
    try {
      blog = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(200).json({
        status: "parse_error",
        error: e.message,
        rawResponse: textContent.slice(0, 3000),
        usage: response.usage,
      });
    }

    // Clean citations from all text fields
    blog.title = stripCitations(blog.title);
    blog.content = stripCitations(blog.content);
    blog.description = stripCitations(blog.description);
    blog.excerpt = stripCitations(blog.excerpt);
    blog.linkedInTeaser = stripCitations(blog.linkedInTeaser);

    // ── VALIDATOR — anti-hallucination check on blog body + LinkedIn teaser
    //
    // Blogs are higher-stakes than social posts because they go straight to
    // Duda with no human review. We run the same validator the social path
    // uses; if either the body or teaser fails, the Duda publish is REFUSED
    // and the blog is saved as Quality Hold for manual review.
    //
    // Stats are tolerated in blog content (allowBenchmarkStats=true) because
    // the system prompt requires citing real publications, but client names,
    // fake quotes, fake awards and competitor mentions still fail hard.
    const bodyValidation = validateContent(blog.content || "", { allowBenchmarkStats: true });
    const teaserValidation = validateContent(blog.linkedInTeaser || "");
    const bodyFailed = bodyValidation.severity === "fail";
    const teaserFailed = teaserValidation.severity === "fail";
    const validatorBlocked = bodyFailed || teaserFailed;

    if (validatorBlocked) {
      console.warn("[generate-blog] Validator blocked publishing:");
      if (bodyFailed) console.warn("  BODY:\n" + bodyValidation.formattedReport);
      if (teaserFailed) console.warn("  TEASER:\n" + teaserValidation.formattedReport);
    }

    // ── PROMOTION ENGINE — append Solutions block to the blog body ──
    // Asks the engine to pick a relevant TG product based on the blog topic,
    // then renders the HTML Solutions block and appends it to blog.content
    // so it ships to Duda as part of the article.
    //
    // Fails closed — engine outages don't block publishing. The blog ships
    // without a Solutions block on those days.
    try {
      const decision = await promotionDecide({
        tenantId: TRAVELGENIX_CLIENT,
        channel: "blog",
        contentTopic: [blog.title || "", blog.excerpt || ""].join(". ").slice(0, 500),
        contentArchetype: "thought-leadership"
      });

      if (decision && decision.shouldPromote && decision.product) {
        const block = renderBlogSolutionsBlock(decision);
        if (block) {
          blog.content = blog.content + "\n\n" + block;
          console.log(`[promo] Blog promoting ${decision.product.name} (${decision.prominence})`);
        }
      }
    } catch (promoErr) {
      console.error("[promo] Blog promotion decision failed (continuing without):", promoErr.message);
    }

    // Get hero image from Pexels
    let imageUrl = null;
    if (blog.imagePrompt) {
      imageUrl = await searchPexelsImage(blog.imagePrompt);
    }

    // If test mode, return for review without publishing
    if (testMode) {
      return res.status(200).json({
        status: "test_success",
        blog,
        imageUrl,
        usage: response.usage,
        note: "TEST MODE — blog NOT published. Remove ?test=true to publish.",
      });
    }

    // Publish to Duda — gated by validator AND the auto-publish kill switch.
    // Blogs publish straight to production with no human review, so we treat
    // any block as a hard stop.
    const killSwitchOn = process.env.AUTO_PUBLISH_ENABLED !== "true";
    let dudaResult = null;
    let publishSkippedReason = null;
    if (validatorBlocked) {
      publishSkippedReason = "validator_blocked";
      console.warn("[generate-blog] Refusing Duda publish — content validation failed.");
    } else if (killSwitchOn) {
      publishSkippedReason = "auto_publish_kill_switch";
      console.warn("[generate-blog] Refusing Duda publish — AUTO_PUBLISH_ENABLED env not 'true'.");
    } else {
      try {
        dudaResult = await importAndPublishBlog(DUDA_SITE_ID, {
          title: blog.title,
          content: blog.content,
          description: blog.description,
          author: "Andy Speight",
          imageUrl: imageUrl,
        });
        console.log(`Blog published to Duda: ${dudaResult.slug}`);
      } catch (e) {
        console.error("Duda publish error:", e.message);
        publishSkippedReason = "duda_error: " + e.message;
        // Don't fail the whole request — still save to queue
      }
    }

    // Save to Post Queue in Airtable (for tracking + LinkedIn teaser)
    const weekLabel = `${new Date().getFullYear()}-W${String(Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 86400000 / 7)).padStart(2, "0")}`;

    const queueRecord = {
      fields: {
        fldGRsU5pWRoAN34s: `Blog: ${blog.title}`, // Post Title
        fldVteQRAcqE2n1lV: [TRAVELGENIX_CLIENT], // Client link
        fldJKPHgL0U9ZZAuX: blog.linkedInTeaser || "", // Caption - LinkedIn
        fldWe3d6ec4pu9jcZ: blog.excerpt || "", // Caption - Facebook
        fldpAenBNwgJMFs7k: blog.excerpt || "", // Caption - Instagram
        fld1cSSlrKuA1SXp5: "#traveltech #travelagents", // Hashtags
        fld8s5QVemJ4plhzs: `https://travelgenix.io/blog/${blog.slug || ""}`, // CTA URL
        fld1a2lxyXPC71UtQ: getNextMonday(), // Scheduled Date
        fld2zaXYmEXQHTua8: "10:00", // Scheduled Time
        // Status: Quality Hold if validator failed; Published if Duda accepted;
        // Queued if validator passed but kill switch or Duda blocked publish.
        fldDmTOSTSlkObab7: validatorBlocked
          ? "Quality Hold"
          : (dudaResult ? "Published" : "Queued"),
        fldFWP2Zkppxipo9U: weekLabel, // Generated Week
        fldYHX5rR7f0Dgsnu: "LinkedIn Personal", // Target Channel (teaser)
        fldZyrr9DTA6mQvxH: blog.pillar || "Education", // Content Pillar
        fldrDRwNKnOQrl5lx: "Blog Article", // Content Type
        fldKUtqSv7v7PsTaB: blog.content, // Blog Content field
      },
    };

    // Quality Issues field for human review
    if (validatorBlocked) {
      const issuesReport = [
        bodyFailed ? "BODY:\n" + bodyValidation.formattedReport : null,
        teaserFailed ? "\nTEASER:\n" + teaserValidation.formattedReport : null,
      ].filter(Boolean).join("\n").slice(0, 50000);
      // The Post Queue table has a Quality Issues field; field IDs vary by deployment,
      // so write by field name via typecast.
      queueRecord.fields["Quality Issues"] = issuesReport;
    }

    if (imageUrl) {
      queueRecord.fields.fldNjzWAIj9eknEWS = imageUrl;
    }

    await writeToQueue(queueRecord);

    return res.status(200).json({
      status: validatorBlocked ? "quality_hold" : "success",
      blog: {
        title: blog.title,
        slug: blog.slug,
        description: blog.description,
        wordCount: blog.content.split(/\s+/).length,
      },
      duda: dudaResult
        ? { slug: dudaResult.slug, status: "published" }
        : { status: "not_published", reason: publishSkippedReason || "unknown" },
      validation: {
        body: { severity: bodyValidation.severity, issueCount: bodyValidation.issues.length },
        teaser: { severity: teaserValidation.severity, issueCount: teaserValidation.issues.length },
        formattedReport: validatorBlocked
          ? [bodyFailed ? bodyValidation.formattedReport : null, teaserFailed ? teaserValidation.formattedReport : null].filter(Boolean).join("\n---\n")
          : null,
      },
      autoPublishKillSwitch: killSwitchOn,
      imageUrl,
      usage: response.usage,
    });
  } catch (e) {
    console.error("Blog generation error:", e);
    const msg = e && e.message ? e.message : String(e);
    return res.status(500).json({ error: msg, guardrails_failed: msg.indexOf("GUARDRAILS_MISSING") !== -1 });
  }
};

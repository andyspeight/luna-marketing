// api/email-generate.js
// Newsletter draft generator
// Pulls top open Research Sparks and drafts a weekly newsletter using Andy's voice
// Saves to Email Queue with status "Awaiting Approval" (or "Quality Hold" if validator fails)
//
// Triggered by:
//   - Cron (Mondays 06:30 UTC) - automatic weekly newsletter draft
//   - Manual POST with auth - on-demand newsletter
//
// Body params (optional):
//   - clientId: Airtable client record ID (defaults to Travelgenix)
//   - emailType: "Newsletter" (default), "One-off Broadcast"
//   - includeSparks: true (default) - whether to use research sparks
//   - subjectHint: optional string to guide subject line
//
// PATCHED 1 May 2026 (Day 6.5): brand guardrails + content validator wired in.

const Anthropic = require("@anthropic-ai/sdk").default;
const { wrapEmail, plainToHtml, htmlToPlain } = require("./email-template.js");
const { addUtm } = require("./utm-helper.js");
const { BRAND_GUARDRAILS } = require("./brand-guardrails.js");
const { validateContent } = require("./validate-content.js");

const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const SPARKS_TABLE = "Research Sparks";
const EMAIL_QUEUE_TABLE = "Email Queue";
const CRON_SECRET = process.env.CRON_SECRET;

// Default Travelgenix client ID
const TRAVELGENIX_CLIENT_ID = "recFXQY7be6gMr4In";

// ── Airtable ──

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
  return r.json();
}

async function airtableCreate(table, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable create failed: ${r.status} ${err}`);
  }
  return r.json();
}

async function getClient(clientId) {
  const r = await airtableFetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${clientId}`
  );
  return r;
}

async function getOpenSparks(limit = 8) {
  const formula = encodeURIComponent(`AND({Status}='Open', {Score}>=6)`);
  const sortQuery = "&sort%5B0%5D%5Bfield%5D=Score&sort%5B0%5D%5Bdirection%5D=desc";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(SPARKS_TABLE)}?filterByFormula=${formula}${sortQuery}&maxRecords=${limit}`;
  const data = await airtableFetch(url);
  return (data.records || []).map((r) => ({
    id: r.id,
    source: r.fields.Source || "",
    headline: r.fields.Headline || "",
    url: r.fields.URL || "",
    summary: r.fields.Summary || "",
    score: r.fields.Score || 0,
    angle: r.fields["Suggested Angle"] || "",
  }));
}

// ── Newsletter draft generation ──

async function generateNewsletterDraft(clientFields, sparks, options = {}) {
  const businessName = clientFields["Business Name"] || "Travelgenix";
  const websiteUrl = clientFields["Website URL"] || "https://travelgenix.io";

  const sparksBlock = sparks.length > 0
    ? sparks.map((s, i) => `${i + 1}. [${s.source} — score ${s.score}]
   Headline: ${s.headline}
   URL: ${s.url}
   Angle: ${s.angle || "(no angle)"}
   Summary: ${(s.summary || "").slice(0, 250)}`).join("\n\n")
    : "(No fresh sparks. Generate a Travelgenix product/feature update or thought leadership piece instead. Do NOT invent product features that have not been launched.)";

  const today = new Date();
  const monthName = today.toLocaleString("en-GB", { month: "long", year: "numeric" });

  // Travelgenix-specific newsletter prompt. The BRAND_GUARDRAILS prepended above
  // already covers anti-fabrication, banned competitor names, banned words, etc.
  const newsletterPrompt = `You write a weekly B2B email newsletter for ${businessName}, a UK travel-tech SaaS company. The audience is travel agency owners, tour operators, and travel industry leaders.

Voice: Andy Speight (CEO). Warm, direct, knowledgeable, opinionated. Talks like a smart industry friend, not a corporate marketer.

UK English.

NEWSLETTER STRUCTURE (target 350-500 words total):

1. Subject line — under 60 chars. Specific, curiosity-driving, no clickbait. Make it about an industry trend or insight (do NOT name any competitor in the subject).
2. Preview text — under 130 chars. Complements subject, sells the open. Different from subject.
3. Opening — 2-3 sentences. Andy speaking directly. Hook the reader.
4. Main content — 2-3 short sections, each with an H2 heading. Use the Research Sparks as factual foundation. Don't summarise the news — give Andy's TAKE on what it means for UK SME travel agents.
5. One actionable tip OR product callout — short section. Practical value. Only mention Travelgenix product features that genuinely exist (Travelify mid-office, Luna AI suite, widgets, bookable websites). Do NOT invent feature names or version numbers.
6. Sign-off — "Andy" (just first name).

CTA: include ONE primary CTA URL pointing to ${websiteUrl} or a relevant page. We'll add UTM params automatically.

CRITICAL — when the sparks reference a competitor name, paraphrase the news WITHOUT naming the competitor. Example: instead of "TProfile's deal with NJT shows..." write "the latest consolidator deal in the homeworking space shows...". The brand guardrails above explain how to handle this.

Today's research sparks (use the most relevant 2-3):

${sparksBlock}

OUTPUT FORMAT — return ONLY a valid JSON object, no preamble, no markdown fences:

{
  "subject": "Subject line under 60 chars",
  "previewText": "Preview text under 130 chars",
  "bodyMarkdown": "## Section heading\\n\\nParagraph...\\n\\n## Another section\\n\\nMore content with [a link](https://travelgenix.io/feature)...",
  "ctaText": "Book a 15-min demo",
  "ctaUrl": "https://travelgenix.io/demo",
  "sourceSparkIds": ["recXXX", "recYYY"]
}

Newsletter date: ${monthName}.

${options.subjectHint ? `Subject hint from sender: ${options.subjectHint}` : ""}`;

  // Prepend brand guardrails — single source of truth for anti-fabrication etc.
  const systemPrompt = BRAND_GUARDRAILS + "\n\n" + newsletterPrompt;

  const response = await aiClient.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    temperature: 0.7,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: "Draft this week's Travelgenix newsletter using the research sparks above. Return ONLY the JSON object.",
    }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Compose final HTML ──

function composeEmailHtml(draft) {
  const ctaUrl = draft.ctaUrl ? addUtm(draft.ctaUrl, {
    source: "email",
    medium: "newsletter",
    campaign: "luna_marketing",
    content: "weekly_newsletter",
  }) : "";

  const bodyHtml = plainToHtml(draft.bodyMarkdown || "");

  return wrapEmail({
    subject: draft.subject,
    previewText: draft.previewText,
    bodyHtml,
    ctaText: draft.ctaText || "",
    ctaUrl,
  });
}

// ── Main handler ──

module.exports = async (req, res) => {
  // Auth: require Bearer for both cron and manual
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body || {};
    const clientId = body.clientId || TRAVELGENIX_CLIENT_ID;
    const emailType = body.emailType || "Newsletter";
    const includeSparks = body.includeSparks !== false;
    const subjectHint = body.subjectHint || "";

    // 1. Load client
    const client = await getClient(clientId);
    const clientFields = client.fields || {};
    const isTravelgenix = clientId === TRAVELGENIX_CLIENT_ID;

    // 2. Load sparks
    const sparks = includeSparks ? await getOpenSparks(8) : [];
    console.log(`Generating ${emailType} for ${clientFields["Business Name"]} with ${sparks.length} sparks`);

    // 3. Generate the draft (with brand guardrails prepended to system prompt)
    const draft = await generateNewsletterDraft(clientFields, sparks, { subjectHint });

    // 4. Compose final HTML
    const html = composeEmailHtml(draft);
    const plain = htmlToPlain(html);

    // 5. VALIDATE before saving (Travelgenix only — per Day 6.5 scope decision)
    let status = "Awaiting Approval";
    let qualityIssues = "";

    if (isTravelgenix) {
      const validationText = `${draft.subject || ""}\n\n${plain}`;
      const validation = validateContent(validationText);
      if (validation.severity === "fail") {
        status = "Quality Hold";
        qualityIssues = "FAIL (blocked from approval):\n" +
          validation.issues.filter(i => i.severity === "fail")
            .map(i => `  • ${i.code}: ${i.detail}`).join("\n");
        console.warn(`[VALIDATOR] Newsletter draft blocked: ${qualityIssues}`);
      } else if (validation.severity === "warn") {
        // Warnings: still saves as Awaiting Approval but log issues
        qualityIssues = "WARNINGS (review recommended):\n" +
          validation.issues.filter(i => i.severity === "warn")
            .map(i => `  • ${i.code}: ${i.detail}`).join("\n");
      }
    }

    // 6. Save to Email Queue
    const fields = {
      "Subject": draft.subject || "Travelgenix Newsletter",
      "Email Type": emailType,
      "Audience Segment": "Travelgenix Clients",
      "Body HTML": html,
      "Body Plain": plain,
      "Preview Text": draft.previewText || "",
      "Status": status,
    };

    if (qualityIssues) {
      // Use Rejection Reason field to surface quality issues — if you've added
      // a 'Quality Issues' field on Email Queue, this writes there too.
      fields["Rejection Reason"] = qualityIssues.slice(0, 1000);
    }

    if (draft.sourceSparkIds && Array.isArray(draft.sourceSparkIds) && draft.sourceSparkIds.length > 0) {
      fields["Source Sparks"] = draft.sourceSparkIds.filter((id) => typeof id === "string" && id.startsWith("rec"));
    }

    const saved = await airtableCreate(EMAIL_QUEUE_TABLE, fields);
    const recordId = saved.records && saved.records[0] ? saved.records[0].id : null;

    return res.status(200).json({
      success: true,
      recordId,
      subject: draft.subject,
      previewText: draft.previewText,
      sparkCount: sparks.length,
      ctaUrl: draft.ctaUrl,
      status,
      qualityIssues: qualityIssues || null,
      message: status === "Quality Hold"
        ? "Newsletter draft saved with Quality Hold status — validator flagged issues. Review before approving."
        : "Newsletter draft saved with status Awaiting Approval. Review in the Email Queue table.",
    });
  } catch (e) {
    console.error("Newsletter generation failed:", e);
    return res.status(500).json({ error: e.message });
  }
};

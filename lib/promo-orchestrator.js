// lib/promo-orchestrator.js
//
// Phase A — "this week we're promoting X".
//
// Given a focus product, fans out to up to three deliverables, all reusing the
// existing, hardened engines and all written as DRAFTS (nothing sends or
// publishes):
//   - Email draft  → content-composer-core.compose() → rendered → Email Queue (Status "Draft")
//   - Social drafts → generation-pipeline (prompt → model → polish → validate) → Post Queue
//                     ("Queued", or "Quality Hold" if the validator fails them)
//   - Mockup        → image-generator-v2.generateImage() (product-mockup) → Generated Images
//
// The product's Brain (Supplement + Brain Summary) flows in via the composer
// (which already reads them) and via the social user message built here.
//
// This module holds no HTTP/auth logic — that's the api/ wrapper.
//
// Author: Travelgenix
// Date:   16 June 2026

const { compose } = require("./content-composer-core");
const emailAdaptor = require("./content-composer-email");
const { prepareSections } = require("./email-render-prepare");
const { renderEmail } = require("./email-renderer");
const { getBrand } = require("./email-brand");
const { generateImage } = require("./image-generator-v2");
const pipeline = require("./generation-pipeline");
const { BRAND_GUARDRAILS } = require("../api/brand-guardrails");
const { buildBrandedVariants } = require("./social-image-variants");
const { importAndPublishBlog } = require("../api/duda-blog");
const { validateContent } = require("../api/validate-content");
const { nextPostingDates } = require("./post-scheduler");
const Anthropic = require("@anthropic-ai/sdk").default;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const EMAIL_QUEUE_TABLE = "tblzM5FsiLiriVLT1";
const POST_QUEUE_TABLE = "tblbhyiuULvedva0K";

// Social generation model. The pipeline's callModel default
// ("claude-sonnet-4-20250514") is no longer available on this account and 404s,
// so we pass a current model explicitly. Override with PROMO_SOCIAL_MODEL.
const SOCIAL_MODEL = process.env.PROMO_SOCIAL_MODEL || "claude-sonnet-4-6";
const BLOG_MODEL = process.env.PROMO_BLOG_MODEL || "claude-sonnet-4-6";
const DUDA_SITE_ID = process.env.DUDA_SITE_ID || "89c0010b"; // Travelgenix blog

// Post Queue field IDs (mirrors cron-generate.js — IDs survive renames).
const PQ = {
  title: "fldGRsU5pWRoAN34s", client: "fldVteQRAcqE2n1lV", contentType: "fldrDRwNKnOQrl5lx",
  fb: "fldWe3d6ec4pu9jcZ", ig: "fldpAenBNwgJMFs7k", li: "fldJKPHgL0U9ZZAuX", tw: "fldYQsiw65rcd2X2B",
  pin: "fldCfdS6ByrofDtkE", tt: "fldyVawF0JrCLb9n5", gbp: "fld39pPTqpajLLpnX",
  hashtags: "fld1cSSlrKuA1SXp5", ctaUrl: "fld8s5QVemJ4plhzs", status: "fldDmTOSTSlkObab7",
  week: "fldFWP2Zkppxipo9U", promotedProduct: "fldHBV7kTHHOQ1MfQ", destination: "flduL1WMpt4do8C4I",
  targetChannel: "fldYHX5rR7f0Dgsnu", contentPillar: "fldZyrr9DTA6mQvxH", firstComment: "fldkOeFJLYsjhZ9KZ",
  generatedBy: "fldR41kUibucfy7Dk",
  scheduledDate: "fld1a2lxyXPC71UtQ", scheduledTime: "fld2zaXYmEXQHTua8",
  // Image buckets — set all so every platform tab in My Posts shows the image.
  imageUrl: "fldNjzWAIj9eknEWS", imgLandscape: "fld0TAQrAThy14MDy", imgSquare: "fld2YOnS26eXpzx7o",
  imgWide: "fldlsMdGZItsMtBPA", imgPortrait: "fldcHFBAslBCW5Uoc"
};

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Airtable ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

function sanitiseHTML(html) {
  if (!html || typeof html !== "string") return "";
  let clean = html.replace(/<(script|style|iframe|object|embed|form)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "");
  clean = clean.replace(/javascript:/gi, "blocked:");
  clean = clean.replace(/\son\w+\s*=\s*"[^"]*"/gi, "").replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  return clean;
}

function isoWeekLabel(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Spread social posts over the coming days so they land on the calendar (which
// positions posts by Scheduled Date/Time). Post i goes to tomorrow + i days.
function upcomingDate(i) {
  const d = new Date();
  d.setDate(d.getDate() + 1 + i);
  return d.toISOString().split("T")[0];
}
function validTime(t, fallback) {
  return (typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t.trim())) ? t.trim() : fallback;
}

function productFacts(product) {
  const f = product.fields || {};
  const hero = Array.isArray(f["Hero image"]) && f["Hero image"][0] ? f["Hero image"][0].url : "";
  return {
    name: f["Name"] || "",
    oneLiner: f["One-liner"] || "",
    problem: f["Problem solved"] || "",
    proof: f["Proof point"] || "",
    ctaText: f["Primary CTA text"] || "",
    ctaUrl: f["Primary CTA URL"] || "",
    supplement: f["Supplement"] || "",
    brain: f["Brain Summary"] || "",
    heroImageUrl: hero
  };
}

const EMAIL_TYPE_BY_ARCHETYPE = {
  "product-launch": "One-off Broadcast",
  "marketing-newsletter": "Newsletter",
  "b2b-weekly": "Newsletter",
  "transactional": "Update"
};

function genUnsubToken() { return `unsub_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`; }

const GENERATED_IMAGES_TABLE = "tblov7qu0dSpQVExf";

/**
 * Find the most recent product mockup already generated for a product, so
 * social posts can reuse it instantly instead of waiting ~2.5 min to render a
 * new one. Matches Generated Images of type "product-mockup" whose Name
 * contains the product name. Returns a PNG URL or "" — never throws fatally.
 */
async function latestMockupUrlForProduct(productName) {
  if (!productName) return "";
  const formula = encodeURIComponent(`{Section Type}='product-mockup'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${GENERATED_IMAGES_TABLE}?filterByFormula=${formula}&maxRecords=100`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
  if (!r.ok) return "";
  const d = await r.json();
  const needle = productName.toLowerCase();
  const matches = (d.records || [])
    .filter(rec => {
      const f = rec.fields || {};
      const name = String(f["Name"] || "").toLowerCase();
      return f["PNG URL"] && name.includes(needle);
    })
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
  return matches.length ? matches[0].fields["PNG URL"] : "";
}

// ─────────────────────────────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────────────────────────────

async function generateEmailDraft({ tenantId, product, archetype, audience, actor, ip }) {
  const p = productFacts(product);
  const intent = `Write a ${archetype.replace("-", " ")} email promoting ${p.name} to our audience. ${p.name} is: ${p.oneLiner}. The problem it solves: ${p.problem}. Lead with the reader's pain, then introduce ${p.name} as the answer. Single clear call to action.`;

  const draft = await compose({
    tenantId,
    intent,
    archetype,
    audience,
    featureProductIds: [product.id],
    actor,
    ip
  }, emailAdaptor);

  // Render exactly as the app does: hydrate offer sections (no-op here), then
  // render to HTML with the Travelgenix brand defaults.
  const { sections } = await prepareSections(draft.sections || []);
  const brand = getBrand(null);
  const rendered = renderEmail({
    sections,
    previewText: draft.previewText || "",
    title: draft.subject || p.name,
    brand
  });

  const fields = {
    "Subject": String(draft.subject || `${p.name}`).slice(0, 200),
    "Preview Text": String(draft.previewText || "").slice(0, 200),
    "Body HTML": sanitiseHTML(rendered.html || ""),
    "Body Plain": String(rendered.plainText || "").slice(0, 95000),
    "Status": "Draft",
    "Audience": audience,
    "Email Type": EMAIL_TYPE_BY_ARCHETYPE[archetype] || "Newsletter",
    "Send Result": "Pending",
    "Unsub URL Token": genUnsubToken(),
    "Sections JSON": JSON.stringify(draft.sections || []).slice(0, 190000),
    "Client": [tenantId],
    "Generated By": "Promote"
  };

  const created = await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${EMAIL_QUEUE_TABLE}`, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }], typecast: true })
  });

  return {
    emailId: created.records[0].id,
    subject: fields["Subject"],
    warnings: draft.warnings || [],
    validationErrors: draft.validationErrors || []
  };
}

// ─────────────────────────────────────────────────────────────────────
// SOCIAL
// ─────────────────────────────────────────────────────────────────────

// Promote uses its own multi-platform prompt rather than the cron's B2B prompt,
// which deliberately writes ONE channel per post (LinkedIn for Travelgenix). A
// product promo wants a caption for every connected platform on each post.
// Includes BRAND_GUARDRAILS so it carries the ANTI-FABRICATION sentinel the
// pipeline's callModel asserts on.
function buildPromoSocialSystemPrompt(client) {
  const businessName = client["Business Name"] || "Travelgenix";
  // The leading sentinel line is required: the pipeline's callModel asserts the
  // system prompt contains "ANTI-FABRICATION RULES" before any model call.
  return `ANTI-FABRICATION RULES — READ FIRST, APPLY ALWAYS. Never invent statistics, customer names, quotes, features, prices or claims not given to you below. If you do not have a fact, leave it out.

${BRAND_GUARDRAILS}

You are Luna, the social content engine for ${businessName}. You write posts that promote a single ${businessName} product across all major platforms at once. UK English. Warm, direct, knowledgeable. No hype, no buzzwords, no em dashes. Talk about what the product DOES for the reader (their time, their sanity, the booking saved), never the plumbing.

For EACH post you produce a DIFFERENT caption for every platform below, all about the same product but tuned to each platform:
- caption_facebook: 40-120 words, conversational, clear CTA.
- caption_instagram: 30-90 words, punchy and visual, 6-12 relevant hashtags at the end.
- caption_linkedin: 60-180 words, professional and insight-led.
- caption_twitter: max 240 characters, one sharp hook, include the CTA link.
- caption_pinterest: max 300 characters, search-friendly and descriptive.
- caption_tiktok: max 90 words, casual and hook-first, 3-5 hashtags.
- caption_gbp: max 100 words, local and direct, include a CTA.
Also include for each post: content_type ("Product Spotlight"), suggested_day (Mon-Sun), suggested_time (HH:MM), hashtags (string), and first_comment (a short LinkedIn first comment).

Respond with ONLY a JSON array of post objects using these exact snake_case keys. No markdown, no preamble.`;
}

function buildSocialFocusMessage(client, product, count) {
  const p = productFacts(product);
  const website = client["Website URL"] || "";
  const cta = p.ctaUrl || website;
  const lines = [];
  lines.push(`THIS WEEK'S SINGLE FOCUS: promote ${p.name}.`);
  lines.push(`Generate ${count} posts, EVERY one about ${p.name}, each with a caption for ALL platforms listed in your instructions. Vary the angle and hook across the posts. Do not promote any other product.`);
  lines.push("");
  lines.push(`USE ONLY THESE FACTS ABOUT ${p.name} (do not invent features, numbers or claims beyond them):`);
  if (p.oneLiner) lines.push(`- What it is: ${p.oneLiner}`);
  if (p.problem) lines.push(`- Problem it solves: ${p.problem}`);
  if (p.proof) lines.push(`- Proof point: ${p.proof}`);
  if (p.supplement) lines.push(`- Authoritative notes (trust over everything): ${p.supplement.replace(/\s+/g, " ").trim()}`);
  if (p.brain) lines.push(`- Latest from our site: ${p.brain.replace(/\s+/g, " ").trim().slice(0, 800)}`);
  lines.push("");
  lines.push(`The CTA URL for every post MUST be: ${cta}`);
  lines.push("Respond with ONLY the JSON array, one object per post, with a caption for every platform.");
  return lines.join("\n");
}

async function generateSocialDrafts({ client, clientId, product, count = 3, actor }) {
  const clientType = (client["Client Type"] || "b2b-saas").toLowerCase();
  const p = productFacts(product);

  // Resolve the post image WITHOUT generating one inline — a product mockup
  // takes ~2.5 minutes to render, far too long to block post creation. Use the
  // product's hero image if it has one, otherwise reuse the most recent mockup
  // already generated for this product (instant lookup). If neither exists,
  // posts save imageless and the user is told to run the Mockup output once.
  let imageUrl = p.heroImageUrl || "";
  let imageSource = imageUrl ? "hero" : "none";
  if (!imageUrl) {
    const reused = await latestMockupUrlForProduct(p.name).catch(() => "");
    if (reused) { imageUrl = reused; imageSource = "mockup"; }
  }

  // Build per-platform ratio variants so posts aren't a square in every network.
  // Use cover (fill the frame): the generated mockups already carry their own
  // navy background and margins, so padding them again shrank them to a dot.
  // Cover trims the dead margins and makes the content fill each ratio.
  let variants = null;
  if (imageUrl) {
    variants = await buildBrandedVariants(imageUrl, { tenantId: clientId, mode: "cover" });
  }

  const systemPrompt = buildPromoSocialSystemPrompt(client);
  const userMessage = buildSocialFocusMessage(client, product, count);

  const raw = await pipeline.callModel({ systemPrompt, userMessage, maxTokens: 8000, model: SOCIAL_MODEL });
  let posts = pipeline.parsePostsJson(raw);

  // Second-pass voice editor, then the hard validator gate (same order as cron).
  try {
    const polished = await pipeline.polishPostsThroughEditor(posts);
    if (polished && Array.isArray(polished.posts) && polished.posts.length) posts = polished.posts;
  } catch (e) { /* editor never blocks — originals pass through */ }

  const tagged = pipeline.validateAndTagPosts(posts);
  const isB2B = clientType === "b2b-saas";
  const cta = p.ctaUrl || client["Website URL"] || "";
  const week = isoWeekLabel();
  // Scheduled Dates across the client's Posting Days so posts hit the calendar.
  const schedDates = nextPostingDates(client, tagged.length);

  const records = tagged.map(({ post, statusOverride, qualityIssues }, idx) => {
    const fields = {
      [PQ.title]: post.post_title || `${p.name} promo`,
      [PQ.client]: [clientId],
      [PQ.contentType]: post.content_type || "Product Spotlight",
      [PQ.fb]: post.caption_facebook || "",
      [PQ.ig]: post.caption_instagram || "",
      [PQ.li]: post.caption_linkedin || "",
      [PQ.tw]: post.caption_twitter || "",
      [PQ.pin]: post.caption_pinterest || "",
      [PQ.tt]: post.caption_tiktok || "",
      [PQ.gbp]: post.caption_gbp || "",
      [PQ.hashtags]: post.hashtags || "",
      [PQ.ctaUrl]: cta,
      [PQ.status]: statusOverride || "Queued",
      [PQ.week]: week,
      // Scheduled across the client's posting days, so posts land on the calendar.
      [PQ.scheduledDate]: schedDates[idx] || schedDates[schedDates.length - 1] || "",
      [PQ.scheduledTime]: validTime(post.suggested_time, ["09:00", "12:00", "15:00", "10:00", "16:00"][idx % 5]),
      [PQ.promotedProduct]: [product.id],
      [PQ.generatedBy]: "Promote"
    };
    if (variants) {
      // Ratio-correct per platform.
      fields[PQ.imageUrl] = variants.square;
      fields[PQ.imgLandscape] = variants.landscape;
      fields[PQ.imgSquare] = variants.square;
      fields[PQ.imgWide] = variants.wide;
      fields[PQ.imgPortrait] = variants.portrait;
    } else if (imageUrl) {
      // Fallback: same image in every bucket (still posts everywhere).
      fields[PQ.imageUrl] = imageUrl;
      fields[PQ.imgLandscape] = imageUrl;
      fields[PQ.imgSquare] = imageUrl;
      fields[PQ.imgWide] = imageUrl;
      fields[PQ.imgPortrait] = imageUrl;
    }
    if (post.destination) fields[PQ.destination] = post.destination;
    if (isB2B) {
      if (post.target_channel) fields[PQ.targetChannel] = post.target_channel;
      fields[PQ.contentPillar] = post.content_pillar || "Product";
      if (post.first_comment) fields[PQ.firstComment] = post.first_comment;
    }
    if (qualityIssues) fields["Quality Issues"] = qualityIssues;
    return { fields };
  });

  // Airtable create caps at 10 records/request; we generate few, but batch anyway.
  const createdIds = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const created = await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${POST_QUEUE_TABLE}`, {
      method: "POST",
      body: JSON.stringify({ records: batch, typecast: true })
    });
    (created.records || []).forEach(r => createdIds.push(r.id));
  }

  const held = tagged.filter(t => t.statusOverride === "Quality Hold").length;
  return { count: createdIds.length, held, postIds: createdIds, image: !!imageUrl, imageSource };
}

// ─────────────────────────────────────────────────────────────────────
// MOCKUP
// ─────────────────────────────────────────────────────────────────────

async function generateMockup({ tenantId, product }) {
  const p = productFacts(product);
  const result = await generateImage({
    tenantId,
    sectionType: "product-mockup",
    sectionContent: {
      headline: p.oneLiner || p.name,
      subhead: p.problem || "",
      productContext: p.name,           // brief-generator matches the visual spec by this
      facts: p.proof ? [p.proof] : [],
      cta: p.ctaText || ""
    },
    slot: "hero-square",
    outputContext: "web",
    source: "composer",
    name: `${p.name} — promo mockup`
  });
  if (!result || !result.ok) {
    return { ok: false, error: (result && result.error) || "image generation failed" };
  }
  return { ok: true, pngUrl: result.pngUrl, recordId: result.airtableRecordId, width: result.width, height: result.height };
}

// ─────────────────────────────────────────────────────────────────────
// BLOG
// ─────────────────────────────────────────────────────────────────────

function buildBlogSystemPrompt(client) {
  const businessName = client["Business Name"] || "Travelgenix";
  const sender = client["Sender Name"] || "Andy Speight";
  // Leading sentinel required by the shared anti-fabrication discipline.
  return `ANTI-FABRICATION RULES — READ FIRST, APPLY ALWAYS. Never invent statistics, customer names, quotes, features, prices, awards or claims not provided to you below. If you do not have a fact, leave it out.

${BRAND_GUARDRAILS}

You are writing a blog article for ${businessName}'s blog, as ${sender}. The article promotes ONE product but reads as genuinely useful advice, not an advert. UK English. Warm, direct, a little playful. Short sentences. No em dashes. No Oxford commas. No buzzwords (leverage, utilise, synergy, game-changer, innovative, cutting-edge, delve, seamless). Talk about what the product does for a travel business (their time, their bookings, their sanity), never the plumbing. Only use facts about the product provided below.

Structure: a real problem the reader feels, why it costs them, how the product quietly solves it, then 5 numbered practical tips. 600-800 words.

In the HTML body use ONLY these tags, with NO attributes (no href, class, id or style): <h2> <h3> <p> <ol> <li> <strong>. Do not include links or images. Do not use a <h1> (the title is added separately).

Return your answer in EXACTLY this labelled format and nothing else. Do not use JSON. Do not use markdown fences. Each label starts a line:

TITLE: the title, max 70 chars, no clickbait
DESCRIPTION: SEO meta description, max 155 chars
PILLAR: content pillar label
EXCERPT: a 2-3 sentence social excerpt on one line
CONTENT:
<the full HTML article here, using only the tags above>`;
}

// Parse the labelled blog response. Deliberately NOT JSON: the HTML body breaks
// JSON.parse too easily (unescaped quotes/newlines). Single-line fields are
// read by label; everything after the CONTENT: line is the HTML body.
function parseBlogResponse(raw) {
  const text = String(raw || "").replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "");
  function field(label) {
    const m = text.match(new RegExp("^" + label + ":[ \\t]*(.*)$", "mi"));
    return m ? m[1].trim() : "";
  }
  let content = "";
  const m = text.match(/^CONTENT:[ \t]*\r?\n?([\s\S]*)$/mi);
  if (m) content = m[1].trim();
  return {
    title: field("TITLE"),
    description: field("DESCRIPTION"),
    pillar: field("PILLAR"),
    excerpt: field("EXCERPT"),
    content
  };
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/**
 * Write a product-focused blog article and publish it live to Duda.
 * Validator-gated: anything that fails the anti-fabrication checks is saved as
 * Quality Hold and NOT published. Records a Post Queue row (Content Type
 * "Blog Article", Generated By "Promote") either way.
 */
async function generateBlogPost({ tenantId, product, client }) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const p = productFacts(product);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const system = buildBlogSystemPrompt(client);
  const userMsg = [
    `Write the blog article promoting ${p.name}.`,
    p.oneLiner ? `What it is: ${p.oneLiner}` : "",
    p.problem ? `Problem it solves: ${p.problem}` : "",
    p.proof ? `Proof point (use only if accurate, do not embellish): ${p.proof}` : "",
    p.supplement ? `Authoritative notes (trust over all else): ${p.supplement}` : "",
    p.brain ? `Latest from our site: ${p.brain.slice(0, 1200)}` : "",
    `Primary call to action: ${p.ctaText || "Book a demo"}${p.ctaUrl ? " → " + p.ctaUrl : ""}`,
    "Return your answer in the labelled format specified (TITLE/DESCRIPTION/PILLAR/EXCERPT/CONTENT). Not JSON."
  ].filter(Boolean).join("\n");

  const response = await anthropic.messages.create({
    model: BLOG_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: userMsg }]
  });
  let raw = "";
  for (const b of response.content) if (b.type === "text") raw += b.text;

  const blog = parseBlogResponse(raw);
  const title = String(blog.title || p.name).slice(0, 200);
  const content = String(blog.content || "");
  if (!content.trim()) throw new Error("Blog returned no content. Raw start: " + raw.slice(0, 200));

  // Validator gate — same as the cron blog. Stats tolerated (allowBenchmarkStats);
  // fabricated clients/quotes/awards/competitors still fail hard.
  const v = validateContent(content, { allowBenchmarkStats: true });
  const heldByValidator = v.severity === "fail";

  // Hero image: the product's hero, else the most recent mockup.
  let imageUrl = p.heroImageUrl || "";
  if (!imageUrl) imageUrl = await latestMockupUrlForProduct(p.name).catch(() => "");

  let published = false, liveUrl = "", dudaError = "";
  if (!heldByValidator) {
    try {
      const duda = await importAndPublishBlog(DUDA_SITE_ID, {
        title, content,
        description: String(blog.description || "").slice(0, 155),
        author: client["Sender Name"] || "Andy Speight",
        imageUrl: imageUrl || undefined
      });
      const slug = (duda && (duda.slug || duda.post_slug)) || slugify(title);
      liveUrl = slug ? `https://travelgenix.io/blog/${slug}` : "";
      published = true;
    } catch (e) {
      dudaError = e.message || String(e);
      console.error("[promo] Duda publish failed (non-fatal):", dudaError);
    }
  }

  const fields = {
    [PQ.title]: `Blog: ${title}`,
    [PQ.client]: [tenantId],
    [PQ.contentType]: "Blog Article",
    [PQ.li]: blog.excerpt || "",
    [PQ.ctaUrl]: liveUrl || p.ctaUrl || "",
    [PQ.status]: heldByValidator ? "Quality Hold" : (published ? "Published" : "Queued"),
    [PQ.week]: isoWeekLabel(),
    [PQ.contentPillar]: blog.pillar || "Product",
    [PQ.promotedProduct]: [product.id],
    [PQ.generatedBy]: "Promote",
    "Blog Content": content.slice(0, 95000)
  };
  if (imageUrl) fields[PQ.imageUrl] = imageUrl;
  if (heldByValidator) {
    // validateContent returns { issues, severity, summary } — no formattedReport
    // (that's validatePost). Build the held-reason text from the issues.
    const report = (v.issues || []).map(i => `[${i.code}] ${i.detail}`).join("\n");
    fields["Quality Issues"] = (report || v.summary || "Content validation failed").slice(0, 50000);
  } else if (dudaError) {
    // Surface the exact Duda error so it's visible in Campaigns, not silent.
    fields["Quality Issues"] = ("Duda publish failed: " + dudaError).slice(0, 50000);
  }

  await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${POST_QUEUE_TABLE}`, {
    method: "POST", body: JSON.stringify({ records: [{ fields }], typecast: true })
  });

  return { ok: true, title, published, held: heldByValidator, url: liveUrl, dudaError };
}

module.exports = {
  generateEmailDraft,
  generateSocialDrafts,
  generateMockup,
  generateBlogPost,
  _internals: { isoWeekLabel, buildSocialFocusMessage, buildBlogSystemPrompt, productFacts, EMAIL_TYPE_BY_ARCHETYPE }
};

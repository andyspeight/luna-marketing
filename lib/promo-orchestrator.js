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

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const EMAIL_QUEUE_TABLE = "tblzM5FsiLiriVLT1";
const POST_QUEUE_TABLE = "tblbhyiuULvedva0K";

// Social generation model. The pipeline's callModel default
// ("claude-sonnet-4-20250514") is no longer available on this account and 404s,
// so we pass a current model explicitly. Override with PROMO_SOCIAL_MODEL.
const SOCIAL_MODEL = process.env.PROMO_SOCIAL_MODEL || "claude-sonnet-4-6";

// Post Queue field IDs (mirrors cron-generate.js — IDs survive renames).
const PQ = {
  title: "fldGRsU5pWRoAN34s", client: "fldVteQRAcqE2n1lV", contentType: "fldrDRwNKnOQrl5lx",
  fb: "fldWe3d6ec4pu9jcZ", ig: "fldpAenBNwgJMFs7k", li: "fldJKPHgL0U9ZZAuX", tw: "fldYQsiw65rcd2X2B",
  pin: "fldCfdS6ByrofDtkE", tt: "fldyVawF0JrCLb9n5", gbp: "fld39pPTqpajLLpnX",
  hashtags: "fld1cSSlrKuA1SXp5", ctaUrl: "fld8s5QVemJ4plhzs", status: "fldDmTOSTSlkObab7",
  week: "fldFWP2Zkppxipo9U", promotedProduct: "fldHBV7kTHHOQ1MfQ", destination: "flduL1WMpt4do8C4I",
  targetChannel: "fldYHX5rR7f0Dgsnu", contentPillar: "fldZyrr9DTA6mQvxH", firstComment: "fldkOeFJLYsjhZ9KZ",
  generatedBy: "fldR41kUibucfy7Dk",
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

function buildSocialFocusMessage(client, product, count) {
  const p = productFacts(product);
  const website = client["Website URL"] || "";
  const cta = p.ctaUrl || website;
  const lines = [];
  lines.push(`THIS WEEK'S SINGLE FOCUS: promote ${p.name}.`);
  lines.push(`Generate ${count} social posts, EVERY one about ${p.name}. Vary the angle and the hook across the week. Do not promote any other product.`);
  lines.push("");
  lines.push(`USE ONLY THESE FACTS ABOUT ${p.name} (do not invent features, numbers or claims beyond them):`);
  if (p.oneLiner) lines.push(`- What it is: ${p.oneLiner}`);
  if (p.problem) lines.push(`- Problem it solves: ${p.problem}`);
  if (p.proof) lines.push(`- Proof point: ${p.proof}`);
  if (p.supplement) lines.push(`- Authoritative notes (trust over everything): ${p.supplement.replace(/\s+/g, " ").trim()}`);
  if (p.brain) lines.push(`- Latest from our site: ${p.brain.replace(/\s+/g, " ").trim().slice(0, 800)}`);
  lines.push("");
  lines.push(`The CTA URL for every post MUST be: ${cta}`);
  lines.push("Respond with ONLY the JSON array of post objects in the format specified above.");
  return lines.join("\n");
}

async function generateSocialDrafts({ client, clientId, product, count = 3, actor }) {
  const clientType = (client["Client Type"] || "b2b-saas").toLowerCase();
  const p = productFacts(product);

  // Resolve the post image IN PARALLEL with the text generation so it doesn't
  // add to the latency. The product's hero image (instant) if it has one,
  // otherwise a single generated product mockup, reused across the posts.
  // Best-effort and bounded — if it overruns, posts just save imageless.
  const imagePromise = (async () => {
    if (p.heroImageUrl) return p.heroImageUrl;
    try {
      const mk = await Promise.race([
        generateMockup({ tenantId: clientId, product }),
        new Promise(resolve => setTimeout(() => resolve({ ok: false, error: "timeout" }), 90000))
      ]);
      return (mk && mk.ok && mk.pngUrl) ? mk.pngUrl : "";
    } catch (e) {
      console.warn("[promo] social image generation failed (non-fatal):", e.message);
      return "";
    }
  })();

  const systemPrompt = pipeline.buildSystemPrompt({ clientFields: client, clientType });
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

  // Image was started in parallel above; collect it now (usually already done).
  const imageUrl = await imagePromise;

  const records = tagged.map(({ post, statusOverride, qualityIssues }) => {
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
      [PQ.promotedProduct]: [product.id],
      [PQ.generatedBy]: "Promote"
    };
    if (imageUrl) {
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
  return { count: createdIds.length, held, postIds: createdIds, image: !!imageUrl };
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

module.exports = {
  generateEmailDraft,
  generateSocialDrafts,
  generateMockup,
  _internals: { isoWeekLabel, buildSocialFocusMessage, productFacts, EMAIL_TYPE_BY_ARCHETYPE }
};

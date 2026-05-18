// lib/content-composer-core.js
//
// Channel-agnostic content composer core.
//
// What this does:
//   - Authenticates the request (caller provides session details)
//   - Loads tenant context (brand voice, Product Library, Topic Mappings, recent history)
//   - Builds a 6-layer system prompt by delegating channel-specific bits to the adaptor
//   - Calls the Anthropic API with structured input
//   - Validates the output against the 5 non-negotiable laws
//   - Writes an audit log entry
//   - Returns the draft + warnings
//
// What this does NOT do:
//   - HTTP request handling (that's the api/ wrapper)
//   - Channel-specific output shaping (that's the channel adaptor)
//   - Sending the result (Brevo/social/sms gateways live elsewhere)
//
// Adaptor contract: each channel adaptor exports:
//   - buildOutputSchemaLayer(context) → string — the "RETURN this exact JSON" block
//   - buildChannelContextLayer(context) → string — channel-specific facts (e.g. section catalogue)
//   - validateOutput(draft, context) → { errors, warnings }
//   - normaliseOutput(raw) → { draft, parseError } — turn AI response into structured shape
//
// Author: Travelgenix
// Date:   18 May 2026

const Anthropic = require("@anthropic-ai/sdk").default;

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const PRODUCTS_TABLE = "tblGBl8X3RIVnCwDM";
const TOPICS_TABLE = "tblBHXi2TVGQ5ke3W";
const EMAIL_QUEUE_TABLE = "tblzM5FsiLiriVLT1";
const POST_QUEUE_TABLE = "tblbhyiuULvedva0K";
const EVENTS_TABLE = "Events Calendar";
const AUDIT_LOG_TABLE = "Audit Log";

const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

// Model — opus for quality, can be tuned later
const COMPOSER_MODEL = "claude-opus-4-7";
const COMPOSER_MAX_TOKENS = 6000;

// Note: temperature parameter was removed when Anthropic deprecated it for
// the opus-4-7 family. The model uses its default sampling, which is fine
// for our use case (creative but bounded by the strict prompt rules).

// ─────────────────────────────────────────────────────────────────────
// AIRTABLE HELPERS
// ─────────────────────────────────────────────────────────────────────

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Airtable ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function airtableList(tableId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
  if (opts.maxRecords) params.set("maxRecords", String(opts.maxRecords));
  if (opts.fields) opts.fields.forEach(f => params.append("fields[]", f));
  if (opts.sort) {
    opts.sort.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction || "asc");
    });
  }
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}?${params.toString()}`;
  const data = await airtableFetch(url);
  return data.records || [];
}

// ─────────────────────────────────────────────────────────────────────
// CONTEXT LOADING
// ─────────────────────────────────────────────────────────────────────

/**
 * Load all the context the composer needs for a given tenant.
 */
async function loadTenantContext(tenantId) {
  // Brand profile
  const brandUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${tenantId}`;
  const brandRecord = await airtableFetch(brandUrl);
  const brand = brandRecord.fields || {};

  // Product Library (Active products only — for awareness)
  const allProducts = await airtableList(PRODUCTS_TABLE, { maxRecords: 200 });
  const products = allProducts.filter(rec => {
    const tenants = (rec.fields && rec.fields["Tenant"]) || [];
    return tenants.includes(tenantId);
  });
  const activeProducts = products.filter(p => (p.fields.Status || "Active") === "Active");

  // Topic Mappings
  const allTopics = await airtableList(TOPICS_TABLE, { maxRecords: 500 });
  const topics = allTopics
    .filter(rec => {
      const tenants = (rec.fields && rec.fields["Tenant"]) || [];
      return tenants.includes(tenantId);
    })
    .map(rec => ({
      keyword: rec.fields["Topic keyword"],
      productId: ((rec.fields["Linked product"] || [])[0]) || null,
      weight: rec.fields["Weight"] || 0
    }));

  // Recent emails (last 5 sent for this tenant)
  let recentEmails = [];
  try {
    const allEmails = await airtableList(EMAIL_QUEUE_TABLE, {
      maxRecords: 30,
      sort: [{ field: "Created Time", direction: "desc" }]
    });
    recentEmails = allEmails
      .filter(rec => {
        const clients = (rec.fields && rec.fields["Client"]) || [];
        return clients.includes(tenantId);
      })
      .slice(0, 5)
      .map(rec => ({
        subject: rec.fields["Subject"] || "",
        audience: rec.fields["Audience"] || "",
        sentDate: rec.fields["Sent At"] || rec.fields["Created Time"] || ""
      }));
  } catch (e) {
    // Email Queue read isn't critical — continue without
    console.warn("[composer] Couldn't load recent emails:", e.message);
  }

  // Events Calendar (next 6 weeks)
  let upcomingEvents = [];
  try {
    const sixWeeksOut = new Date(Date.now() + 42 * 86400000).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    const eventsFormula = `AND(IS_AFTER({Date Start}, '${today}'), IS_BEFORE({Date Start}, '${sixWeeksOut}'))`;
    const events = await airtableList(EVENTS_TABLE, {
      filterByFormula: eventsFormula,
      maxRecords: 20,
      sort: [{ field: "Date Start", direction: "asc" }]
    });
    upcomingEvents = events.map(rec => ({
      name: rec.fields["Event Name"] || rec.fields["Name"] || "",
      dateStart: rec.fields["Date Start"] || "",
      location: rec.fields["Location"] || "",
      category: rec.fields["Category"] || ""
    })).filter(e => e.name);
  } catch (e) {
    console.warn("[composer] Couldn't load events:", e.message);
  }

  return {
    tenantId,
    brand,
    products: activeProducts,
    allProducts: products, // includes Coming Soon, for awareness
    topics,
    recentEmails,
    upcomingEvents,
    isOwner: tenantId === OWNER_CLIENT_ID
  };
}

// ─────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT CONSTRUCTION — 6 layers
// ─────────────────────────────────────────────────────────────────────

const LAYER_1_IDENTITY = `You are Luna, the Travelgenix content composer. Your job is to produce on-brand, factually grounded content for Travelgenix and its clients. You are a junior copywriter with perfect brand discipline and zero invention.

You output structured JSON. You never invent facts. You never drift from voice. You never hide uncertainty. When you don't know something, you flag it explicitly rather than making it up.

You write like a knowledgeable friend, not a marketing consultant. Direct, warm, confident, never showing off. UK English. Short sentences. Contractions used naturally. You skip filler. You name things bluntly.`;

const LAYER_2_HARD_RULES = `# CRITICAL: THE EM DASH PROHIBITION

THIS IS THE SINGLE MOST IMPORTANT RULE IN THIS DOCUMENT. READ IT TWICE.

You MUST NOT use the em dash character (the long horizontal dash) ANYWHERE in your output. Not in subject lines, not in preview text, not in section content, not in CTAs, not in your reasoning, not in your warnings, NOWHERE. Use a comma, a full stop, or restructure the sentence.

The en dash (a shorter horizontal dash) is also banned. Use a hyphen for compound words only.

Where you would naturally write:
- "Most chat tools take a message [DASH] Luna Chat books holidays" → REJECTED. Write "Most chat tools take a message. Luna Chat books holidays."
- "The team [DASH] all 12 of them [DASH] is ready" → REJECTED. Write "The team, all 12 of them, is ready"
- "X [DASH] and Y" → REJECTED. Write "X. And Y" or "X, and Y" (but watch the Oxford comma below).

Every dash is an automatic failure. The validator will reject your output and force a re-prompt. Do not let this rule break here.

# THE FIVE NON-NEGOTIABLE LAWS

## Law 1: Never invent facts
You NEVER fabricate:
- Statistics, percentages, numbers
- Quotes, testimonials, customer names
- Company names of clients, partners, suppliers not provided in context
- Product features not in the Product Library proof point
- Awards, certifications, accreditations
- Dates of events not in the Events Calendar
- Prices, discounts, offers not provided in input

If you don't have a fact, omit it. Do not estimate. Do not sound like you know something you don't.
Do not use placeholder facts like "[insert stat here]". Restructure the sentence to not need a fact.

## Law 2: Never drift from voice
HARD BANS (zero tolerance, one slip = total failure):
- Em dashes and en dashes. See the CRITICAL rule at the top of this document. HARD REJECT.
- Oxford commas. "X, Y and Z" never "X, Y, and Z".
- These words and phrases: leverage, utilise, synergy, game-changer, innovative, cutting-edge, delve, seamlessly, robust, best-in-class, world-class, next-generation, revolutionary, supercharge, "in today's digital landscape", "navigate the complexities", "unlock the potential", "elevate your business", "transform your".
- Defensive italicised emphasis like "I *genuinely*" or "what I *can* do is".
- Telling the user what they "actually need".

VOICE PROFILE:
- Warm, direct, knowledgeable friend
- UK English (colour, favourite, travelling, not color, favorite, traveling)
- Short sentences, punchy rhythm
- Contractions natural (it's, you're, won't, can't)
- Confident without arrogance
- Names things bluntly ("admin overhead", not "operational complexities")

## Law 3: Never break the design contract
Your output JSON shape is dictated by the channel adaptor. See the OUTPUT SCHEMA below. Adhere exactly:
- Every section type must be in the registered catalogue
- Every prop must match the section's documented schema
- Image URLs are null when no asset is provided. The system handles placeholders.
- URLs must come from input data, not invented

## Law 4: Never bypass safety rails
You NEVER:
- Name competitors: TProfile, Top Dog, Inspiretec, Dolphin Dynamics, Traveltek, Moonstride, Travelsoft, Juniper, T1 Profile
- Include personal data of real individuals unless explicitly provided
- Add tracking pixels, hidden text, dark patterns, fake urgency, fake scarcity
- Promise specific outcomes ("save 10 hours/week") unless the Product Library proof says so

## Law 5: Never hide uncertainty
When you don't have enough information, surface it in the "warnings" or "imagesNeeded" array. Don't paper over gaps.

Acceptable: "Audience hasn't been emailed in 4 months. Opening acknowledges that."
Unacceptable: making up the missing piece so the output looks complete.

# FINAL REMINDER ON DASHES

Before you write anything, internalise this: you are NOT allowed to use any horizontal dash character beyond the standard hyphen for compound words. Every time you would naturally reach for an em dash or en dash, replace it with a full stop or a comma. This is the rule that breaks most often. Do not let it break here.`;

function buildBrandContextLayer(context) {
  const b = context.brand || {};
  const lines = [];
  lines.push("# TENANT BRAND PROFILE");
  lines.push(`- Business: ${b["Business Name"] || "Unknown"}`);
  if (b["Trading Name"] && b["Trading Name"] !== b["Business Name"]) lines.push(`- Trading as: ${b["Trading Name"]}`);
  if (b["Sender Name"]) lines.push(`- Sender Name: ${b["Sender Name"]}`);
  if (b["Tone Keywords"]) lines.push(`- Voice tone: ${b["Tone Keywords"]}`);
  if (b["Formality"]) lines.push(`- Formality: ${typeof b["Formality"] === "object" ? b["Formality"].name : b["Formality"]}`);
  if (b["Sentence Style"]) lines.push(`- Sentence style: ${typeof b["Sentence Style"] === "object" ? b["Sentence Style"].name : b["Sentence Style"]}`);
  if (b["CTA Style"]) lines.push(`- CTA style: ${typeof b["CTA Style"] === "object" ? b["CTA Style"].name : b["CTA Style"]}`);
  if (b["Example Phrases"]) {
    lines.push("");
    lines.push("EXAMPLE BRAND PHRASES (mimic this voice exactly):");
    String(b["Example Phrases"]).split("\n").slice(0, 5).forEach(p => {
      if (p.trim()) lines.push(`  - "${p.trim()}"`);
    });
  }

  // Brand assets — logos and brand colours. The composer should USE these
  // whenever it builds a section that has a logo slot (header, top-bar,
  // footer-light, footer-dark, footer-meta).
  const logoUrl = b["Logo URL"] || (Array.isArray(b["Logo"]) && b["Logo"][0] && b["Logo"][0].url);
  const logoDarkUrl = b["Logo Dark Variant URL"] || b["Logo Dark URL"];
  const logoMarkUrl = b["Logo Mark URL"];
  if (logoUrl || logoDarkUrl || logoMarkUrl) {
    lines.push("");
    lines.push("BRAND ASSETS (use these in section props):");
    if (logoUrl) {
      lines.push(`  - Primary logo URL: ${logoUrl}`);
      lines.push(`    Use this for: header logoUrl, top-bar logoUrl, footer-light logoUrl`);
    }
    if (logoDarkUrl) {
      lines.push(`  - Dark-mode logo URL: ${logoDarkUrl}`);
      lines.push(`    Use this for: hero-dark logoUrl, cta-dark logoUrl, footer-dark logoUrl`);
    }
    if (logoMarkUrl) {
      lines.push(`  - Logo mark (icon only) URL: ${logoMarkUrl}`);
      lines.push(`    Use this for: confirmation-block icon, footer-meta brand mark`);
    }
    lines.push(`  - You MUST include showLogoImage: true on top-bar and header sections when a logo URL is available.`);
    lines.push(`  - The logo URL goes in the section's logoUrl prop.`);
  }

  if (b["Primary Colour"]) lines.push(`- Primary brand colour: ${b["Primary Colour"]}`);
  if (b["Secondary Colour"]) lines.push(`- Secondary brand colour: ${b["Secondary Colour"]}`);
  if (b["ATOL Number"]) lines.push(`- ATOL: ${b["ATOL Number"]}`);
  if (b["ABTA Number"]) lines.push(`- ABTA: ${b["ABTA Number"]}`);
  if (b["Company Address"]) lines.push(`- Address: ${b["Company Address"]}`);
  return lines.join("\n");
}

function buildDataContextLayer(context) {
  const lines = [];

  // Product Library
  lines.push("# PRODUCT LIBRARY");
  lines.push("These are the ONLY products you may reference. Do not invent or mention products not listed here.");
  lines.push("");

  // Sort: spotlight first, then by priority desc
  const thisMonth = new Date().getMonth();
  const thisYear = new Date().getFullYear();
  const sortedProducts = [...context.products].sort((a, b) => {
    const aSpot = a.fields["Spotlight month"] && new Date(a.fields["Spotlight month"]).getMonth() === thisMonth ? 1 : 0;
    const bSpot = b.fields["Spotlight month"] && new Date(b.fields["Spotlight month"]).getMonth() === thisMonth ? 1 : 0;
    if (aSpot !== bSpot) return bSpot - aSpot;
    return (b.fields.Priority || 0) - (a.fields.Priority || 0);
  });

  sortedProducts.forEach(p => {
    const f = p.fields;
    const isSpotlight = f["Spotlight month"] && new Date(f["Spotlight month"]).getMonth() === thisMonth && new Date(f["Spotlight month"]).getFullYear() === thisYear;
    lines.push(`## ${f.Name}${isSpotlight ? " ★ THIS MONTH'S SPOTLIGHT" : ""} [${p.id}]`);
    if (f["One-liner"]) lines.push(`- One-liner: ${f["One-liner"]}`);
    if (f["Problem solved"]) lines.push(`- Problem solved: ${f["Problem solved"]}`);
    if (f["Proof point"]) lines.push(`- Proof point: ${f["Proof point"]}`);
    if (f["Primary CTA text"]) lines.push(`- CTA: "${f["Primary CTA text"]}" → ${f["Primary CTA URL"] || "(no URL)"}`);
    if (f["Suitable archetypes"]) lines.push(`- Suitable archetypes: ${(f["Suitable archetypes"] || []).join(", ")}`);
    if (f["Tier match"]) lines.push(`- Tier match: ${(f["Tier match"] || []).join(", ")}`);
    lines.push(`- Priority: ${f.Priority || 5}`);
    lines.push("");
  });

  // Topic Mappings (compact form)
  if (context.topics.length > 0) {
    lines.push("# TOPIC MAPPINGS");
    lines.push("If user intent matches one of these keywords, the linked product is a natural fit:");
    const sortedTopics = [...context.topics].sort((a, b) => b.weight - a.weight);
    sortedTopics.slice(0, 30).forEach(t => {
      const product = context.products.find(p => p.id === t.productId);
      if (product) {
        lines.push(`  - "${t.keyword}" → ${product.fields.Name} (weight ${t.weight})`);
      }
    });
    lines.push("");
  }

  // Recent email history
  if (context.recentEmails && context.recentEmails.length > 0) {
    lines.push("# RECENT EMAILS (last 5 sent — avoid repeating these)");
    context.recentEmails.forEach(e => {
      const dateStr = e.sentDate ? new Date(e.sentDate).toISOString().split("T")[0] : "?";
      lines.push(`  - ${dateStr}: "${e.subject}" (${e.audience})`);
    });
    lines.push("");
  }

  // Upcoming events
  if (context.upcomingEvents && context.upcomingEvents.length > 0) {
    lines.push("# UPCOMING EVENTS (next 6 weeks)");
    lines.push("Reference these if relevant to the email topic:");
    context.upcomingEvents.slice(0, 10).forEach(e => {
      lines.push(`  - ${e.dateStart}: ${e.name}${e.location ? ` (${e.location})` : ""}`);
    });
    lines.push("");
  }

  // What you MAY NOT claim
  lines.push("# YOU MAY NOT CLAIM");
  lines.push("- Specific customer names (e.g. real client agencies) unless I provide them above");
  lines.push("- Specific revenue/conversion stats unless I provide them above");
  lines.push("- Specific testimonials unless I provide them above");
  lines.push("- Competitor names: TProfile, Top Dog, Inspiretec, Dolphin Dynamics, Traveltek, Moonstride, Travelsoft, Juniper, T1 Profile");
  lines.push("- Awards, certifications, or accreditations not in the brand profile above");
  lines.push("");

  return lines.join("\n");
}

/**
 * Build the complete system prompt for a composer call.
 *
 * @param {Object} context — loaded by loadTenantContext()
 * @param {Object} adaptor — channel-specific adaptor (must export buildChannelContextLayer, buildOutputSchemaLayer)
 * @returns {string}
 */
function buildSystemPrompt(context, adaptor) {
  return [
    LAYER_1_IDENTITY,
    "",
    LAYER_2_HARD_RULES,
    "",
    buildBrandContextLayer(context),
    "",
    buildDataContextLayer(context),
    "",
    adaptor.buildChannelContextLayer(context),
    "",
    adaptor.buildOutputSchemaLayer(context),
  ].join("\n");
}

/**
 * Build the USER message — the actual intent + structured inputs.
 */
function buildUserMessage(input, archetypeKey) {
  const lines = [];
  lines.push(`USER INTENT: ${input.intent || "(no intent provided)"}`);
  if (archetypeKey) lines.push(`ARCHETYPE: ${archetypeKey}`);
  if (input.audience) lines.push(`AUDIENCE: ${input.audience}`);
  if (input.audienceSegment) lines.push(`AUDIENCE SEGMENT: ${input.audienceSegment}`);
  if (input.audienceContext) lines.push(`AUDIENCE CONTEXT: ${input.audienceContext}`);
  if (Array.isArray(input.featureProductIds) && input.featureProductIds.length > 0) {
    lines.push(`FEATURED PRODUCTS (must include): ${input.featureProductIds.join(", ")}`);
  }
  if (input.toneOverrides) lines.push(`TONE OVERRIDES: ${input.toneOverrides}`);
  lines.push("");
  lines.push("Produce the JSON output now. Output ONLY the JSON — no markdown fences, no preamble, no explanation outside the JSON.");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// VALIDATION (channel-agnostic checks — the adaptor adds channel-specific ones)
// ─────────────────────────────────────────────────────────────────────

const BANNED_PHRASES = [
  "leverage", "utilise", "synergy", "game-changer", "innovative",
  "cutting-edge", "delve", "seamlessly", "robust", "best-in-class",
  "world-class", "next-generation", "revolutionary", "supercharge",
  "in today's digital landscape", "navigate the complexities",
  "unlock the potential", "elevate your business", "transform your"
];

const COMPETITOR_NAMES = [
  "TProfile", "Top Dog", "Inspiretec", "Dolphin Dynamics",
  "Traveltek", "Moonstride", "Travelsoft", "Juniper", "T1 Profile"
];

/**
 * Extract only the recipient-facing text from a draft.
 *
 * The validator must check what the RECIPIENT will see (subject, previewText,
 * section props that render to HTML) — NOT the composer's metadata
 * (reasoning, warnings, imagesNeeded). Those fields are for human reviewers
 * and never reach an inbox.
 *
 * Returns a single concatenated string suitable for regex scanning.
 */
function extractRecipientFacingText(draft) {
  if (!draft || typeof draft !== "object") return "";

  const chunks = [];
  if (typeof draft.subject === "string") chunks.push(draft.subject);
  if (typeof draft.previewText === "string") chunks.push(draft.previewText);

  if (Array.isArray(draft.sections)) {
    draft.sections.forEach(section => {
      if (!section || !section.props) return;
      // Walk every prop in the section. Strings get scanned. Nested objects
      // (like cta: {text, url}) get their strings extracted. Arrays of cards
      // (like destination-grid.cards) recurse.
      const walk = (val) => {
        if (typeof val === "string") chunks.push(val);
        else if (Array.isArray(val)) val.forEach(walk);
        else if (val && typeof val === "object") Object.values(val).forEach(walk);
      };
      Object.values(section.props).forEach(walk);
    });
  }

  return chunks.join("\n");
}

/**
 * Run the channel-agnostic checks. Returns { warnings: [], hardErrors: [] }
 * Hard errors fail the draft. Warnings surface to user for review.
 */
function runCoreValidation(text) {
  const warnings = [];
  const hardErrors = [];

  if (!text || typeof text !== "string") {
    return { warnings, hardErrors };
  }

  // Em dash AND en dash — HARD BAN. Both are banned by Travelgenix brand voice.
  // Hyphen-minus (-) is allowed for compound words.
  const dashMatch = text.match(/[\u2013\u2014]/);
  if (dashMatch) {
    const dashChar = dashMatch[0];
    const dashName = dashChar === "\u2014" ? "em dash" : "en dash";
    hardErrors.push(`${dashName} detected in recipient-facing text. Composer output rejected. Re-prompt required.`);
  }

  // Oxford comma
  const oxfordMatches = text.match(/,\s+(and|or)\s+\w+/gi);
  if (oxfordMatches) {
    warnings.push(`Possible Oxford comma usage: "${oxfordMatches[0]}". Review manually.`);
  }

  // Banned phrases
  const lowerText = text.toLowerCase();
  BANNED_PHRASES.forEach(phrase => {
    if (lowerText.includes(phrase.toLowerCase())) {
      warnings.push(`Banned phrase detected: "${phrase}"`);
    }
  });

  // Competitor names — HARD BAN
  COMPETITOR_NAMES.forEach(name => {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      hardErrors.push(`Competitor name detected: "${name}". Composer output rejected.`);
    }
  });

  // Number-like claims that look hallucinated (percentages and "Nx faster" patterns)
  const numericClaims = text.match(/\b(\d{1,3})\s*%|\b(\d+)\s*x\s+(faster|more|better|less)/gi);
  if (numericClaims && numericClaims.length > 0) {
    warnings.push(`Numeric claims detected (${numericClaims.length}). Verify each is from the data: ${numericClaims.slice(0, 3).join(", ")}`);
  }

  return { warnings, hardErrors };
}

// ─────────────────────────────────────────────────────────────────────
// AUDIT LOGGING
// ─────────────────────────────────────────────────────────────────────

async function writeAuditLog(entry) {
  try {
    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`;
    await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        records: [{
          fields: {
            "Event ID": eventId,
            "Timestamp": new Date().toISOString(),
            "Actor": entry.actor || "composer",
            "Action": entry.action || "compose",
            "Subject Type": entry.subjectType || "draft",
            "Subject ID": entry.subjectId || "",
            "Details": typeof entry.details === "string" ? entry.details : JSON.stringify(entry.details).slice(0, 5000),
            "IP": entry.ip || ""
          }
        }],
        typecast: true
      })
    });
  } catch (e) {
    console.error("[composer] Audit log write failed (non-fatal):", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// MAIN COMPOSE FUNCTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Run a compose call.
 *
 * @param {Object} input
 * @param {string} input.tenantId
 * @param {string} input.intent
 * @param {string} [input.archetype]
 * @param {string} [input.audience]
 * @param {string} [input.audienceSegment]
 * @param {Array<string>} [input.featureProductIds]
 * @param {string} [input.toneOverrides]
 * @param {string} [input.actor]
 * @param {string} [input.ip]
 *
 * @param {Object} adaptor — channel-specific adaptor module
 *
 * @returns {Promise<Object>} Draft response
 */
async function compose(input, adaptor) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!input || !input.tenantId) {
    throw new Error("tenantId is required");
  }
  if (!input.intent || typeof input.intent !== "string" || input.intent.trim().length === 0) {
    throw new Error("intent is required and must be a non-empty string");
  }
  if (input.intent.length > 2000) {
    throw new Error("intent must be under 2000 characters");
  }

  // 1. Load tenant context
  const context = await loadTenantContext(input.tenantId);

  // 2. Build prompts
  const systemPrompt = buildSystemPrompt(context, adaptor);
  const userMessage = buildUserMessage(input, input.archetype);

  // 3. Call Anthropic
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const startedAt = Date.now();

  const response = await client.messages.create({
    model: COMPOSER_MODEL,
    max_tokens: COMPOSER_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }]
  });

  const elapsedMs = Date.now() - startedAt;

  // Extract text from response
  let rawText = "";
  for (const block of response.content) {
    if (block.type === "text") rawText += block.text;
  }

  // 4. Parse and normalise (adaptor-specific)
  const { draft, parseError } = adaptor.normaliseOutput(rawText);
  if (parseError || !draft) {
    await writeAuditLog({
      actor: input.actor || "composer",
      action: "edit",
      subjectType: "draft",
      details: {
        type: "compose-parse-error",
        tenantId: input.tenantId,
        intent: input.intent,
        parseError: parseError || "Empty draft",
        rawTextSnippet: rawText.slice(0, 500),
        elapsedMs,
        usage: response.usage
      },
      ip: input.ip
    });
    throw new Error(`Composer output failed to parse: ${parseError || "empty draft"}`);
  }

  // 5. Validate — only the recipient-facing text gets the strict regex checks
  // (subject, previewText, section props). Metadata fields (reasoning,
  // warnings, imagesNeeded) are human-only and never reach an inbox, so they
  // shouldn't trigger hard errors.
  const recipientText = extractRecipientFacingText(draft);
  const coreValidation = runCoreValidation(recipientText);
  const channelValidation = adaptor.validateOutput(draft, context);

  const warnings = [
    ...(draft.warnings || []),
    ...coreValidation.warnings,
    ...channelValidation.warnings
  ];
  const hardErrors = [
    ...coreValidation.hardErrors,
    ...channelValidation.hardErrors
  ];

  // Attach validation results to draft
  draft.warnings = warnings;
  draft.validationErrors = hardErrors;

  // 6. Audit log
  await writeAuditLog({
    actor: input.actor || "composer",
    action: "edit",
    subjectType: "draft",
    subjectId: draft.draftId || "",
    details: {
      type: "compose",
      tenantId: input.tenantId,
      intent: input.intent.slice(0, 200),
      archetype: input.archetype,
      audience: input.audience,
      featuredProducts: draft.featuredProducts || [],
      warningCount: warnings.length,
      hardErrorCount: hardErrors.length,
      elapsedMs,
      usage: response.usage,
      model: COMPOSER_MODEL
    },
    ip: input.ip
  });

  return draft;
}

/**
 * Refine an existing draft.
 *
 * @param {Object} input
 * @param {string} input.tenantId
 * @param {string} input.refinementPrompt
 * @param {Object} input.currentDraft — the draft to refine
 * @param {Array<Object>} [input.refinementHistory] — previous refinements
 * @param {Object} adaptor
 */
async function refine(input, adaptor) {
  if (!input.refinementPrompt || typeof input.refinementPrompt !== "string") {
    throw new Error("refinementPrompt is required");
  }
  if (!input.currentDraft) {
    throw new Error("currentDraft is required");
  }
  if (input.refinementHistory && input.refinementHistory.length >= 10) {
    throw new Error("Refinement limit reached (10) — start a new draft");
  }

  const context = await loadTenantContext(input.tenantId);
  const systemPrompt = buildSystemPrompt(context, adaptor);

  // Build refinement message with conversation history
  const messages = [];
  // First turn: original intent (synthesised)
  messages.push({
    role: "user",
    content: `Produce a draft based on the requirements I'll describe. Output ONLY the JSON.`
  });
  messages.push({
    role: "assistant",
    content: JSON.stringify(input.currentDraft, null, 2)
  });
  // Prior refinements (if any)
  if (Array.isArray(input.refinementHistory)) {
    input.refinementHistory.forEach(r => {
      messages.push({ role: "user", content: r.prompt });
      messages.push({ role: "assistant", content: JSON.stringify(r.result, null, 2) });
    });
  }
  // The new refinement
  messages.push({
    role: "user",
    content: `Refine the previous draft: ${input.refinementPrompt}\n\nReturn the FULL new draft as JSON — not a diff, not a partial update. Output ONLY the JSON.`
  });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const startedAt = Date.now();

  const response = await client.messages.create({
    model: COMPOSER_MODEL,
    max_tokens: COMPOSER_MAX_TOKENS,
    system: systemPrompt,
    messages
  });

  const elapsedMs = Date.now() - startedAt;

  let rawText = "";
  for (const block of response.content) {
    if (block.type === "text") rawText += block.text;
  }

  const { draft, parseError } = adaptor.normaliseOutput(rawText);
  if (parseError || !draft) {
    throw new Error(`Refinement output failed to parse: ${parseError || "empty"}`);
  }

  const recipientText = extractRecipientFacingText(draft);
  const coreValidation = runCoreValidation(recipientText);
  const channelValidation = adaptor.validateOutput(draft, context);

  draft.warnings = [
    ...(draft.warnings || []),
    ...coreValidation.warnings,
    ...channelValidation.warnings
  ];
  draft.validationErrors = [
    ...coreValidation.hardErrors,
    ...channelValidation.hardErrors
  ];

  await writeAuditLog({
    actor: input.actor || "composer",
    action: "edit",
    subjectType: "draft",
    details: {
      type: "refine",
      tenantId: input.tenantId,
      refinementPrompt: input.refinementPrompt.slice(0, 200),
      refinementIndex: (input.refinementHistory || []).length,
      warningCount: draft.warnings.length,
      hardErrorCount: draft.validationErrors.length,
      elapsedMs,
      usage: response.usage
    },
    ip: input.ip
  });

  return draft;
}

module.exports = {
  compose,
  refine,
  loadTenantContext,
  runCoreValidation,
  extractRecipientFacingText,
  // Exported for testing
  _internals: {
    buildSystemPrompt,
    buildUserMessage,
    buildBrandContextLayer,
    buildDataContextLayer,
    BANNED_PHRASES,
    COMPETITOR_NAMES
  }
};

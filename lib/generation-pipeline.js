// lib/generation-pipeline.js
//
// Single source of truth for AI content generation.
//
// Every endpoint that asks an LLM to produce client-facing Travelgenix content
// MUST call generateContent() from this module. Direct anthropic.messages.create
// calls from generation endpoints are forbidden — see the assertions below for
// why. The on-demand path (api/generate.js, api/prompt-post.js, api/generate-blog.js)
// and the scheduled path (api/cron-generate.js) both go through here.
//
// This file enforces three layers of protection against the failure mode that
// happened on 21 May 2026 — the on-demand "Generate Posts" button used a
// different, unhardened prompt than the cron, and produced a batch of posts
// inventing client names, statistics, and quoted testimonials. The cron path
// had been hardened in Day 6.5 (1 May 2026); the on-demand path was missed.
//
// LAYER 1 — Single prompt source
//   buildSystemPrompt() is the only function that builds a system prompt. It
//   imports BRAND_GUARDRAILS and buildB2BSystemPrompt / buildB2CSystemPrompt
//   from the canonical files. No endpoint may build its own prompt.
//
// LAYER 2 — Runtime assertion
//   Before any model call, assertGuardrailsPresent() throws if the system
//   prompt is missing the ANTI-FABRICATION RULES sentinel string. This means
//   that even a future buggy edit that bypasses buildSystemPrompt() cannot
//   silently produce hallucinated content — generation hard-fails instead.
//
// LAYER 3 — Output validation
//   validateAndTagPosts() runs validatePost() on every generated post BEFORE
//   any caller writes to Airtable. Posts that fail validation get tagged with
//   status "Quality Hold" and the issue list; callers must respect this and
//   never override to Queued/Approved/Published.
//
// LAYER 4 — Auto-publish kill switch (lives in api/publish.js, not here)
//   While the validator is the gate, the auto-publish kill switch is the
//   second padlock. process.env.AUTO_PUBLISH_ENABLED must be the string "true"
//   for publish.js to honour any client.auto_publish flag.

const Anthropic = require("@anthropic-ai/sdk").default;

const { BRAND_GUARDRAILS } = require("../api/brand-guardrails.js");
const { buildB2BSystemPrompt } = require("../api/b2b-prompt.js");
const { validatePost } = require("../api/validate-content.js");

const GUARDRAIL_SENTINEL = "ANTI-FABRICATION RULES";

// ─────────────────────────────────────────────────────────────
// B2C system prompt — promoted into this module from cron-generate.js so
// every B2C entry point uses the same hardened prompt. Anti-fabrication
// rules at the top, just like B2B. No client invention, no statistics
// without source, no fake testimonials.
// ─────────────────────────────────────────────────────────────

function getNextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
  return d.toISOString().split("T")[0];
}

function buildB2CSystemPrompt(fields) {
  const f = fields || {};
  const website = f["Website URL"] || "";
  const businessName = f["Business Name"] || "";
  const tradingName = f["Trading Name"] || businessName;

  return `You are Luna, the automated social media content engine for travel agents. You generate social media posts for 7 platforms simultaneously: Facebook, Instagram, LinkedIn, Twitter/X, Pinterest, TikTok and Google Business Profile.

═══════════════════════════════════════════════════════════
${GUARDRAIL_SENTINEL} — READ FIRST, APPLY ALWAYS
═══════════════════════════════════════════════════════════

These rules OVERRIDE every other instruction in this prompt. If anything later
contradicts these rules, follow these rules.

1. NEVER invent client names, customer names, traveller names, or testimonial
   quotes. Do NOT write "Sarah just got back from Mykonos and said..." or any
   variant. If you do not have a real, named customer story provided to you,
   do not write one. Use generic language instead ("travellers we work with",
   "many of our customers", "guests this season") or skip the angle entirely.

2. NEVER invent statistics, percentages, customer counts, satisfaction scores,
   or "X% of travellers" numbers. The only numeric claims allowed are ones
   given to you in this prompt or trivially verifiable facts (year, month,
   destination distances). If a stat would be persuasive but is not in this
   prompt, omit it.

3. NEVER invent quotes attributed to real or fictional people, including the
   agency owner, named travellers, or "one of our customers". Quotes require
   real source material.

4. NEVER invent destinations, hotels, tours, or itineraries that the agency
   does not sell. The "What This Agent Sells" section below is the only
   product/destination basis you have.

5. When in doubt, GENERIC beats SPECIFIC. "A family we sent to Crete last
   month" is fine. "The Hendersons from Bristol said our service was 5 star"
   is forbidden.

If you find yourself reaching for a specific name, number, quote or claim
that you cannot trace back to this prompt, REMOVE IT before responding.

═══════════════════════════════════════════════════════════

## Agency Profile (the ONLY facts you can use)

Business Name: ${businessName}
Trading Name: ${tradingName}
Website: ${website}
Phone: ${f["Phone"] || "(not provided)"}

## Brand Voice

Tone: ${f["Tone Keywords"] || "warm, professional"}
Emoji usage: ${f["Emoji Usage"] || "Light"}
Formality: ${f["Formality"] || "Balanced"}
Sentence style: ${f["Sentence Style"] || "Short and punchy"}
CTA style: ${f["CTA Style"] || "Question-based"}
Example phrases: ${f["Example Phrases"] || "(none provided)"}

## What This Agent Sells

Destinations: ${f["Destinations"] || "(not specified)"}
Specialisms: ${Array.isArray(f["Specialisms"]) ? f["Specialisms"].map(s => typeof s === "object" ? s.name : s).join(", ") : (f["Specialisms"] || "(not specified)")}

## Content Request

Generate ${f["Posting Frequency"] || 3} social media posts for the week beginning ${getNextMonday()}.

Each post needs DIFFERENT captions for each platform:
- **caption_facebook**: 50-200 words. Conversational, storytelling. Include a clear CTA.
- **caption_instagram**: 50-150 words. Emoji-friendly, aspirational. Include 8-15 relevant hashtags at the end.
- **caption_linkedin**: 50-250 words. Professional, insight-driven. Good for travel industry professionals.
- **caption_twitter**: Max 200 characters. Punchy, conversational. No hashtags. Include CTA link.
- **caption_pinterest**: Max 300 characters. SEO-rich, keyword-heavy, inspirational. Search-optimised.
- **caption_tiktok**: Max 100 words. Casual, trend-aware, hook-first. Use 3-5 trending hashtags.
- **caption_gbp**: Max 100 words. Local SEO focused. Include business name and phone. Clear CTA.

Each post must also have: destination, content_type (one of: Destination Spotlight, Deal Alert, Travel Tip, Customer Story, Seasonal, Event-Based, Behind the Scenes), suggested_day (Mon-Sun), suggested_time (HH:MM), image_search_query (a specific Pexels search query for finding a great image).

CRITICAL: The CTA URL for every post MUST be: ${website}

Mix content types across the week. Don't repeat the same destination twice.

IMPORTANT — Customer Story content type: ONLY use this content type if you can write a fully generic, anonymous story with no invented names, no invented numbers, and no invented quotes. If you cannot write a Customer Story without inventing details, do NOT use that content type — pick a different one.

Respond with ONLY a JSON array of post objects. No markdown, no explanation.`;
}

// ─────────────────────────────────────────────────────────────
// Prompt assembly
// ─────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a generation request. Always returns the
 * canonical, guardrail-prefixed prompt. There is no path through this
 * function that produces an unhardened prompt.
 *
 * @param {object} args
 * @param {object} args.clientFields - Airtable fields from the Clients table
 * @param {string} args.clientType - "b2b-saas" or "b2c-travel"
 * @param {object[]} [args.events] - Events context (optional, B2B only)
 * @param {object[]} [args.sparks] - Research sparks (optional, B2B only)
 * @returns {string} The full system prompt
 */
function buildSystemPrompt({ clientFields, clientType, events, sparks }) {
  const isB2B = clientType === "b2b-saas";

  const basePrompt = isB2B
    ? buildB2BSystemPrompt(clientFields, events || [], sparks || [])
    : buildB2CSystemPrompt(clientFields);

  // Prepend BRAND_GUARDRAILS for B2B (Travelgenix). B2C clients get the
  // anti-fabrication block built into buildB2CSystemPrompt above.
  const systemPrompt = isB2B
    ? BRAND_GUARDRAILS + "\n\n" + basePrompt
    : basePrompt;

  return systemPrompt;
}

/**
 * Hard runtime assertion. The model is NEVER called without the guardrail
 * sentinel string present in the system prompt. If a future change ever
 * accidentally constructs a prompt without it, this throws and the caller
 * gets a 500 — better than silently producing hallucinated content.
 *
 * @param {string} systemPrompt
 * @throws {Error} if the sentinel is missing
 */
function assertGuardrailsPresent(systemPrompt) {
  if (typeof systemPrompt !== "string" || !systemPrompt.includes(GUARDRAIL_SENTINEL)) {
    throw new Error(
      "GUARDRAILS_MISSING: system prompt does not contain '" + GUARDRAIL_SENTINEL + "'. " +
      "Refusing to call the model. Use lib/generation-pipeline.js#buildSystemPrompt() " +
      "to construct prompts — direct prompt strings are not permitted."
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Model call
// ─────────────────────────────────────────────────────────────

let _anthropicClient = null;
function getAnthropicClient() {
  if (!_anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

/**
 * Call the model with the given system prompt and user message. Guardrails
 * are asserted before the call. Returns the raw text content.
 *
 * @param {object} args
 * @param {string} args.systemPrompt
 * @param {string} args.userMessage
 * @param {object[]} [args.tools] - optional Anthropic tools (e.g. web_search)
 * @param {number} [args.maxTokens]
 * @param {number} [args.temperature]
 * @param {string} [args.model]
 * @returns {Promise<string>} concatenated text content from the response
 */
async function callModel({ systemPrompt, userMessage, tools, maxTokens, temperature, model }) {
  assertGuardrailsPresent(systemPrompt);

  const client = getAnthropicClient();
  const apiParams = {
    model: model || "claude-sonnet-4-20250514",
    max_tokens: maxTokens || 8000,
    temperature: temperature == null ? 0.7 : temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  if (tools && tools.length > 0) apiParams.tools = tools;

  const response = await client.messages.create(apiParams);

  let textContent = "";
  for (const block of response.content) {
    if (block.type === "text") textContent += block.text;
  }
  return textContent;
}

// ─────────────────────────────────────────────────────────────
// Output validation
// ─────────────────────────────────────────────────────────────

/**
 * Validate every generated post and return them annotated with the
 * validation result. Callers MUST respect the returned status:
 *
 *   - validation.severity === "fail" → save with Status="Quality Hold"
 *     and never let it reach Approved/Published.
 *   - validation.severity === "warn" → save with Status="Queued" but include
 *     the warning text in Quality Issues for human review.
 *   - validation.severity === "pass" → save with Status="Queued" as normal.
 *
 * @param {object[]} posts - array of post objects with caption_facebook etc.
 * @returns {object[]} array of { post, validation, statusOverride } items
 */
function validateAndTagPosts(posts) {
  if (!Array.isArray(posts)) return [];

  return posts.map((post) => {
    // Map the post's caption fields to the field names validatePost expects.
    const validationFields = {
      "Caption - Facebook":  post.caption_facebook  || post.captionFacebook  || "",
      "Caption - Instagram": post.caption_instagram || post.captionInstagram || "",
      "Caption - LinkedIn":  post.caption_linkedin  || post.captionLinkedIn  || "",
      "Caption - Twitter":   post.caption_twitter   || post.captionTwitter   || "",
      "Caption - Pinterest": post.caption_pinterest || post.captionPinterest || "",
      "Caption - TikTok":    post.caption_tiktok    || post.captionTikTok    || "",
      "Caption - GBP":       post.caption_gbp       || post.captionGBP       || "",
      "Blog Content":        post.blog_content      || post.blogContent      || "",
      "First Comment":       post.first_comment     || post.firstComment     || "",
    };

    const validation = validatePost(validationFields);

    let statusOverride = null;
    let qualityIssues = "";
    if (validation.severity === "fail") {
      statusOverride = "Quality Hold";
      qualityIssues = validation.formattedReport.slice(0, 50000);
    } else if (validation.severity === "warn") {
      qualityIssues = "WARNINGS:\n" + validation.formattedReport.slice(0, 50000);
    }

    return { post, validation, statusOverride, qualityIssues };
  });
}

// ─────────────────────────────────────────────────────────────
// Output normalization
// ─────────────────────────────────────────────────────────────

/**
 * Normalize a post from either field-name convention to a single canonical
 * snake_case shape. The B2B prompt (api/b2b-prompt.js) instructs the model
 * to emit camelCase fields (captionFacebook, targetChannel, etc.); the B2C
 * prompt in this file emits snake_case (caption_facebook, target_channel).
 * Downstream code should never have to deal with that ambiguity, so we
 * collapse to ONE shape here at the pipeline boundary.
 *
 * Returns a new object — does not mutate the input.
 */
function normalizePost(post) {
  if (!post || typeof post !== "object") return {};
  // Helper — pick the first defined non-empty key from a list of aliases.
  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      var k = arguments[i];
      if (post[k] !== undefined && post[k] !== null && post[k] !== "") return post[k];
    }
    return "";
  }
  return {
    // Title / channel routing
    post_title:        pick("post_title", "postTitle", "title"),
    target_channel:    pick("target_channel", "targetChannel"),
    content_pillar:    pick("content_pillar", "pillar", "contentPillar"),
    content_type:      pick("content_type", "contentType"),
    destination:       pick("destination") || "General",
    // Captions — accept either shape
    caption_facebook:  pick("caption_facebook",  "captionFacebook"),
    caption_instagram: pick("caption_instagram", "captionInstagram"),
    caption_linkedin:  pick("caption_linkedin",  "captionLinkedIn"),
    caption_twitter:   pick("caption_twitter",   "captionTwitter"),
    caption_pinterest: pick("caption_pinterest", "captionPinterest"),
    caption_tiktok:    pick("caption_tiktok",    "captionTikTok"),
    caption_gbp:       pick("caption_gbp",       "captionGBP", "captionGbp"),
    // First comment (LinkedIn)
    first_comment:     pick("first_comment", "firstComment"),
    // Scheduling
    suggested_day:     pick("suggested_day", "day"),
    suggested_time:    pick("suggested_time", "time"),
    // Media / CTA
    image_search_query: pick("image_search_query", "imagePrompt", "imageQuery"),
    image_orientation: pick("image_orientation", "imageOrientation"),
    image_tags:        post.image_tags || post.imageTags || [],
    cta_url:           pick("cta_url", "ctaUrl", "cta_url_facebook"),
    hashtags:          post.hashtags || "",
    // Blog body if present
    blog_content:      pick("blog_content", "blogContent", "content"),
    // Research provenance (B2B only)
    spark_ref:         post.spark_ref !== undefined ? post.spark_ref : post.sparkRef,
    // Preserve anything else by spreading the original — but the normalized
    // keys above take precedence for downstream readers.
    _raw: post,
  };
}

function parsePostsJson(rawText) {
  if (typeof rawText !== "string") throw new Error("Model returned non-string content");
  const jsonStr = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new Error("Model did not return a JSON array — got " + typeof parsed);
  }
  // Normalize once here so downstream readers (validators, queue mappers,
  // promotion engine, etc.) all see the same snake_case shape regardless of
  // which prompt (B2B camelCase or B2C snake_case) the model was given.
  return parsed.map(normalizePost);
}

module.exports = {
  buildSystemPrompt,
  assertGuardrailsPresent,
  callModel,
  validateAndTagPosts,
  parsePostsJson,
  normalizePost,
  GUARDRAIL_SENTINEL,
  // Exposed for tests
  _buildB2CSystemPrompt: buildB2CSystemPrompt,
};

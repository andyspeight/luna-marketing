// lib/brief-generator.js
//
// Generates image briefs for the Luna Marketing image pipeline.
//
// Takes structured input from the composer (section type, headline, subhead,
// product context, optional style reference) and produces a written brief
// in the style of the four lab library briefs (Santorini, Luna Chat mockup,
// pricing comparison, feature grid).
//
// Output flows directly into the HTML pipeline as the brief input. The
// brief generator NEVER writes the HTML renderer prompt — that is baked
// into lib/image-generator-v2.js. This separation is deliberate:
//   - Renderer prompt = "how Travelgenix builds things" (locked, rarely edited)
//   - Brief          = "what to make this time" (varies per image)
//
// Model: Opus 4.7. Briefs are upstream of every image. Quality compounds.
// Five extra seconds once per image is nothing compared to the cost of
// a flat brief producing a flat image.
//
// Forward-looking note: the input shape accepts an optional `styleReference`
// for Stage E (upload-screenshot-to-template). When set, the brief generator
// will incorporate the extracted style (layout, typography, palette) into
// the brief without copying the original. Today this field is unused.
//
// Author: Travelgenix
// Date:   18 May 2026

const Anthropic = require("@anthropic-ai/sdk").default;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PRODUCT_VISUALS_TABLE = "tblZJzVjkh61ItPs8";
const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 1500;

// Field IDs for the Product Visuals table. Captured 19 May 2026.
// Keep in sync with the Airtable schema; renaming fields keeps the IDs.
const PV_FIELDS = {
  name:                 "fldRvOcD05yNCGyDV",
  status:               "fldl6qBVKmhnPcjtz",
  oneLiner:             "fldI1zCALelKpd869",
  dimensions:           "fldy4YQ3ErwnVRDxV",
  header:               "fldQsGP3xWxGEU39p",
  body:                 "fldWSBe5U1UkwRaLh",
  interactive:          "fldbUqMrWx78bZpnd",
  footer:               "fldM9Geh8JNDncqBB",
  colourSignatures:     "fldgDys9a7fYiucoI",
  typographySignatures: "fldcSSSTPbKro3O7k",
  variations:           "fld5vO31mApc4cubN",
  antiPatterns:         "fldRLWJY0U4cdDkKV",
  aliases:              "fld7dOkgGzIGFYqNc",
  referenceScreenshot:  "fldyLJvfAqcNwIvDQ"
};

// In-memory cache for Product Visuals. Specs change rarely; 5-minute
// TTL keeps Airtable load low without serving truly stale specs after
// an update. Cache survives between invocations of the same Vercel
// lambda instance but resets on a cold start, which is fine.
const PV_CACHE_TTL_MS = 5 * 60 * 1000;
let pvCache = { fetchedAt: 0, records: null };

/**
 * Fetch all Active product visuals from Airtable. Cached.
 * Returns an array of normalised records. Each record has name (string),
 * aliases (array of lowercase strings), and the spec fields. On any
 * failure (Airtable down, no key, etc) returns an empty array — never
 * throws — so brief generation degrades gracefully to "no product spec".
 */
async function fetchProductVisuals() {
  const now = Date.now();
  if (pvCache.records && (now - pvCache.fetchedAt) < PV_CACHE_TTL_MS) {
    return pvCache.records;
  }
  if (!AIRTABLE_KEY) {
    // Without a key we can't fetch; behave as if there are no specs.
    pvCache = { fetchedAt: now, records: [] };
    return [];
  }
  try {
    // Filter to Status = "Active" only. Use the field ID, not the name,
    // so renames don't break this.
    const formula = encodeURIComponent(`{${PV_FIELDS.status}}='Active'`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCT_VISUALS_TABLE}?filterByFormula=${formula}&maxRecords=100`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` }
    });
    if (!r.ok) {
      console.warn("[brief-generator] Product Visuals fetch failed:", r.status);
      pvCache = { fetchedAt: now, records: [] };
      return [];
    }
    const data = await r.json();
    const records = ((data && data.records) || []).map(rec => {
      const f = rec.fields || {};
      const aliasesRaw = f["Aliases"] || f[PV_FIELDS.aliases] || "";
      const aliases = String(aliasesRaw)
        .toLowerCase()
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      // Reference Screenshot is a multipleAttachments field. We take the
      // first attachment only — per Andy's direction, don't overconfuse the
      // engine by passing multiple states. Later attachments can be wired
      // through if needed by changing this to .map() over the array.
      const screenshotsRaw = f["Reference Screenshot"] || f[PV_FIELDS.referenceScreenshot] || [];
      const firstAttachment = Array.isArray(screenshotsRaw) && screenshotsRaw.length > 0
        ? screenshotsRaw[0]
        : null;
      const screenshotUrl = firstAttachment ? firstAttachment.url : null;
      const screenshotMediaType = firstAttachment ? (firstAttachment.type || "image/png") : null;

      return {
        id: rec.id,
        name: f["Name"] || f[PV_FIELDS.name] || "",
        aliases,
        oneLiner: f["One Liner"] || f[PV_FIELDS.oneLiner] || "",
        dimensions: f["Dimensions And Shape"] || f[PV_FIELDS.dimensions] || "",
        header: f["Header Spec"] || f[PV_FIELDS.header] || "",
        body: f["Body Spec"] || f[PV_FIELDS.body] || "",
        interactive: f["Interactive Elements Spec"] || f[PV_FIELDS.interactive] || "",
        footer: f["Footer Spec"] || f[PV_FIELDS.footer] || "",
        colourSignatures: f["Colour Signatures"] || f[PV_FIELDS.colourSignatures] || "",
        typographySignatures: f["Typography Signatures"] || f[PV_FIELDS.typographySignatures] || "",
        variations: f["Variations"] || f[PV_FIELDS.variations] || "",
        antiPatterns: f["Anti Patterns"] || f[PV_FIELDS.antiPatterns] || "",
        screenshotUrl,
        screenshotMediaType
      };
    });
    pvCache = { fetchedAt: now, records };
    return records;
  } catch (e) {
    console.warn("[brief-generator] Product Visuals fetch error:", e.message);
    pvCache = { fetchedAt: now, records: [] };
    return [];
  }
}

/**
 * Match brief input text against known product visuals. Returns the
 * matched record or null. Matching is case-insensitive substring on the
 * combined headline + subhead + bodyText + productContext, against each
 * product's name and aliases. First match wins; products are scanned in
 * Airtable order so put canonical products first if a brief might match
 * multiple.
 */
function matchProductVisual(input, records) {
  if (!records || records.length === 0) return null;
  const sc = input.sectionContent || {};
  const haystack = [
    sc.headline, sc.subhead, sc.bodyText,
    sc.productContext, input.sectionType
  ].filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return null;
  for (const rec of records) {
    const candidates = [rec.name.toLowerCase(), ...rec.aliases].filter(Boolean);
    for (const c of candidates) {
      if (c.length < 3) continue; // avoid noise matches on short aliases
      if (haystack.includes(c)) return rec;
    }
  }
  return null;
}

// In-memory cache for downloaded screenshot bytes. Keyed by URL. Same 5-min
// TTL as the spec cache. The Airtable signed URL changes when the
// attachment is replaced, so a stale cache entry from a deleted URL is
// harmless (we just re-download on next generation). Lives at module scope
// so warm lambdas reuse bytes across invocations.
const SCREENSHOT_CACHE_TTL_MS = 5 * 60 * 1000;
const screenshotCache = new Map(); // url -> { fetchedAt, mediaType, data }

/**
 * Download a screenshot from an Airtable signed URL and return it as
 * base64-encoded bytes in the format Anthropic's multimodal API expects:
 * { mediaType: "image/png", data: "<base64 string>" }.
 *
 * Returns null on any failure (network error, non-200 response, empty
 * body, etc). Callers must handle null by degrading to text-only spec
 * injection. This function never throws.
 */
async function downloadScreenshotAsBase64(url, mediaTypeHint) {
  if (!url) return null;
  const now = Date.now();
  const cached = screenshotCache.get(url);
  if (cached && (now - cached.fetchedAt) < SCREENSHOT_CACHE_TTL_MS) {
    return { mediaType: cached.mediaType, data: cached.data };
  }
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.warn("[brief-generator] Screenshot download failed:", r.status, url.slice(0, 100));
      return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf || buf.length === 0) {
      console.warn("[brief-generator] Screenshot download returned empty body");
      return null;
    }
    const mediaType = mediaTypeHint || r.headers.get("content-type") || "image/png";
    const data = buf.toString("base64");
    screenshotCache.set(url, { fetchedAt: now, mediaType, data });
    return { mediaType, data };
  } catch (e) {
    console.warn("[brief-generator] Screenshot download error:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// ANTI-PATTERN VALIDATION
// ─────────────────────────────────────────────────────────────────────
// Parses the Anti Patterns text from a product spec into a structured
// list of forbidden phrases (with optional corrective replacements), then
// scans a brief for any of those phrases. This catches Opus drift where
// it writes the right structure but emits a forbidden literal string —
// e.g. "Online · responds instantly" when the spec explicitly bans it.

/**
 * Parse the Anti Patterns multiline text from a product spec into a
 * list of structured violations to check for.
 *
 * The Luna Chat spec uses lines like:
 *   Do NOT use a sparkle, star, or asterisk icon for the avatar...
 *   Do NOT use the status line "Online · replies instantly" or "Online · responds instantly".
 *   Do NOT label the header simply "Luna". The correct title is "Luna AI".
 *
 * Extraction rules (deliberately CONSERVATIVE — false positives are
 * worse than false negatives here, because a false positive corrupts a
 * clean brief):
 *
 *   1. Only consider paragraphs that start with "Do NOT".
 *   2. Extract quoted strings that appear directly after a "forbidding
 *      verb" — use, label, write, employ, add, include — possibly with
 *      a few words between (e.g. "Do NOT use the status line X"). These
 *      are the FORBIDDEN literals.
 *   3. When the paragraph also contains "the correct X is Y" or similar,
 *      Y is captured as the CORRECTIVE replacement.
 *   4. Quoted strings that appear inside a sub-clause like "when the
 *      brief says X" or "stands alone with X" are NOT forbidden — they
 *      are references, not literals to scrub. Skip them.
 *
 * @param {string} antiPatternsText
 * @returns {Array<{forbidden: string, correct: string | null, context: string}>}
 */
function parseAntiPatterns(antiPatternsText) {
  if (!antiPatternsText || typeof antiPatternsText !== "string") return [];

  const violations = [];
  const paragraphs = antiPatternsText.split(/\n\s*\n/);

  // Verbs that signal "the next quoted thing is forbidden". Conservative
  // list — easy to extend if a new product's anti-patterns use a verb we
  // didn't anticipate.
  const FORBIDDING_VERBS = "(?:use|label|write|employ|add|include|name|call|describe|render(?:\\s+as)?|put|set|show|caption|title|prefix|suffix|annotate|tag)";
  // Match `Do NOT <verb> [short connector] "QUOTED" [optional " or "QUOTED2"]`
  // The connector window is INTENTIONALLY TIGHT (≤15 chars) so that
  // sub-clauses like "when the brief says X" can't slip through and
  // misidentify a referenced condition as a forbidden literal.
  // Examples that should match:
  //   Do NOT use "X"
  //   Do NOT use the status line "X"
  //   Do NOT label the header simply "X"
  //   Do NOT use a "X"
  const forbiddenRegex = new RegExp(
    `Do\\s+NOT\\s+${FORBIDDING_VERBS}(?:\\s+(?:the|a|an|any|simply|just|either|like|as))?\\s+(?:[a-zA-Z\\s-]{0,15})?["\\u201C]([^"\\u201D\\u201C]{2,200})["\\u201D]\\s*(?:(?:or|and|nor|and not|or not|or even)\\s+["\\u201C]([^"\\u201D\\u201C]{2,200})["\\u201D])?`,
    "i"
  );
  // Match correctives: `(The )?correct X is "Y"` or `should be "Y"` or
  // `use "Y" instead`.
  const correctiveRegex = new RegExp(
    `(?:(?:the\\s+)?correct\\s+(?:title|status|label|placeholder|name|version|wording|phrasing|icon|copy|status\\s+line|input\\s+placeholder|spelling)\\s+is|should\\s+be|use\\s+["\\u201C][^"\\u201D\\u201C]+["\\u201D]\\s+instead|use\\s+(?:instead|rather))[^"\\u201C]*?["\\u201C]([^"\\u201D\\u201C]+)["\\u201D]`,
    "i"
  );

  for (const para of paragraphs) {
    if (!/^\s*Do\s+NOT\b/i.test(para)) continue;

    // Try to extract the corrective FIRST so we can exclude it from
    // the forbidden list later.
    let correct = null;
    const cm = para.match(correctiveRegex);
    if (cm && cm[1]) {
      correct = cm[1].trim();
    }

    // Now extract forbidden literals from the "Do NOT use ..." opening.
    const fm = para.match(forbiddenRegex);
    const forbiddenList = [];
    if (fm) {
      // Reject single-word common forbidden literals (e.g. "Luna", "Help",
      // "Click") — these are too ambiguous to safely scrub without false
      // positives, because they often appear inside larger valid phrases
      // (e.g. "Luna" inside "Luna AI" or "Luna Chat"). A literal must be
      // either ≥6 characters AND contain a space/punctuation, OR ≥10
      // characters total, to be considered safely scrubbable.
      const isSafelyScrubable = (s) => {
        if (!s) return false;
        const trimmed = s.trim();
        if (trimmed.length >= 10) return true;
        if (trimmed.length >= 6 && /[\s\u00B7·•/\-,()]/.test(trimmed)) return true;
        return false;
      };
      if (fm[1] && fm[1].trim() !== correct && isSafelyScrubable(fm[1])) {
        forbiddenList.push(fm[1].trim());
      }
      if (fm[2] && fm[2].trim() !== correct && isSafelyScrubable(fm[2])) {
        forbiddenList.push(fm[2].trim());
      }
    }

    if (forbiddenList.length === 0) {
      // No literal forbidden string found — this is a CONCEPT-only
      // anti-pattern (e.g. "Do NOT use a sparkle icon for the avatar").
      // Record it so callers can surface it for visual review, but
      // there's nothing to auto-detect in the brief text.
      const firstSentence = para.split(/\.[\s\n]/)[0].trim();
      violations.push({
        forbidden: null,
        forbiddenConcept: firstSentence.slice(0, 200),
        correct: null,
        context: para.trim().slice(0, 300)
      });
      continue;
    }

    for (const f of forbiddenList) {
      violations.push({
        forbidden: f,
        forbiddenConcept: null,
        correct,
        context: para.trim().slice(0, 300)
      });
    }
  }

  return violations;
}

/**
 * Scan a brief for anti-pattern violations and optionally auto-fix.
 *
 * Returns:
 *   {
 *     fixed: string,         // brief with auto-fixable violations corrected
 *     violations: Array,     // ALL violations found (including ones we fixed)
 *     hardViolations: Array, // violations that COULDN'T be auto-fixed
 *     fixedCount: number
 *   }
 *
 * Matching uses word boundaries for SHORT forbidden strings (under 15
 * characters) to avoid false positives like "Luna" matching inside
 * "Luna AI". Long forbidden strings (the typical case, e.g. "Online ·
 * responds instantly") are matched as substrings because they don't
 * appear in valid contexts.
 */
function validateBriefAgainstAntiPatterns(brief, antiPatternsText) {
  const violations = parseAntiPatterns(antiPatternsText);
  let fixed = brief;
  let fixedCount = 0;
  const found = [];
  const hardViolations = [];

  for (const v of violations) {
    if (!v.forbidden) continue;
    const escaped = v.forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-boundary anchoring for short strings (≤14 chars) to avoid
    // matching inside larger valid phrases. Use \b on both sides for
    // alphanumeric boundaries; for strings that contain punctuation
    // (like "Online · X") we don't need word boundaries because the
    // punctuation itself disambiguates.
    const hasPunctuation = /[·•\-,.()/]/.test(v.forbidden);
    const useWordBoundary = v.forbidden.length <= 14 && !hasPunctuation;

    // CRITICAL: when the forbidden string is a substring of its own
    // corrective (e.g. forbidden "Luna" → correct "Luna AI"), word
    // boundaries alone are not enough because "Luna<space>AI" contains
    // a word boundary after "Luna". We need a negative lookahead that
    // refuses to match "Luna" when it's followed by the rest of the
    // corrective ("AI"). Symmetric logic for prefix overlap (forbidden
    // is a suffix of corrective, rare but possible).
    let pattern = useWordBoundary ? `\\b${escaped}\\b` : escaped;
    if (v.correct && v.correct.toLowerCase().includes(v.forbidden.toLowerCase())) {
      const correctLower = v.correct.toLowerCase();
      const forbiddenLower = v.forbidden.toLowerCase();
      const idx = correctLower.indexOf(forbiddenLower);
      // suffix part of corrective AFTER the forbidden substring
      const suffix = v.correct.slice(idx + v.forbidden.length);
      // prefix part of corrective BEFORE the forbidden substring
      const prefix = v.correct.slice(0, idx);
      if (suffix.length > 0) {
        const escSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Negative lookahead: don't match if the corrective's suffix follows
        pattern = pattern + `(?!${escSuffix})`;
      }
      if (prefix.length > 0) {
        const escPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Negative lookbehind: don't match if the corrective's prefix precedes
        pattern = `(?<!${escPrefix})` + pattern;
      }
    }

    const detector = new RegExp(pattern, "gi");
    if (detector.test(fixed)) {
      found.push(v);
      if (v.correct) {
        const replacer = new RegExp(pattern, "gi");
        fixed = fixed.replace(replacer, v.correct);
        fixedCount++;
      } else {
        hardViolations.push(v);
      }
    }
  }

  return { fixed, violations: found, hardViolations, fixedCount };
}

// ─────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────
// The brief generator's intelligence lives here. Distilled from the four
// lab briefs that produced magazine-quality output: Santorini destination
// spotlight, Luna Chat product mockup, Pricing comparison, Why Travelgenix
// feature grid. Plus the Travelgenix brand voice.

const BRIEF_GENERATOR_SYSTEM_PROMPT = `You are a senior creative director writing image briefs for the Luna Marketing engine. Your briefs are read by a downstream AI that writes magazine-quality HTML/CSS, which is then rendered as a PNG in Google Chrome and used in marketing emails, blog posts, and landing pages.

YOUR JOB

Read the structured section content provided. Output ONE detailed image brief, 150 to 400 words, that describes exactly what to render. The brief should be specific enough that two different designers would produce visually similar work from it.

NEVER output anything except the brief. No preamble. No explanation. No markdown. No headings. Just the brief text.

WHAT MAKES A GREAT BRIEF

1. Specific subject and composition
   Open with the subject and the overall composition (single card, three-column comparison, hero with floating widget, 2x3 feature grid, etc).

2. Use provided facts EXACTLY. Invent only what is missing.
   This is the most important rule in this prompt. The input has two parts: structured content (headline, subhead, body) and a "key facts" list. Read both carefully before writing.

   If the input provides a number, price, date, percentage, statistic, name, or quote: reproduce it word for word in the brief. Do NOT round, paraphrase, "improve", substitute, or rewrite it. If the input says "£159/mo", the brief says "£159/mo", not "£149" or "from £159" or "£159+". If the input says "setup £2,995", the brief says "setup £2,995", not "Setup · £499 one-off".

   If a category of detail is genuinely missing from the input (no price was provided, no date was provided, no proof-point was provided), THEN you may invent plausible specifics. For Travelgenix, plausible looks like "247 verified properties", "12,847 trips analysed", "Last analysed 3h ago", "Powered by Travelgenix Luna AI", "Trusted by 300+ UK agencies". Mark invented details as supporting flavour, never as core pricing or product claims.

   Never override input data with your own intuition. If the input data looks wrong to you, still use it. The user owns the facts.

3. Typography direction
   Specify which elements should be italic serif (major headlines), which sans (body, UI labels), which monospace (technical metadata, source attributions, timestamps, ref IDs). Travelgenix uses Source Serif 4 italic for editorial headlines, Inter for everything else, JetBrains Mono for metadata.

4. Brand colour direction
   Brief should reinforce Travelgenix navy (#1B2B5B) and teal (#00B4D8) as primary palette. Mention specific colours where useful (e.g. "navy header", "teal CTA button"). The downstream system already knows the full token set, so do not list every CSS variable.

5. Editorial polish anchors
   Great Travelgenix imagery always has: source attributions (e.g. "open-meteo.com · Live"), status pills with subtle borders, multi-layer card shadows, and small monospace metadata strips. Mention these where they would land.

6. Composition cues
   Use spatial language ("top-left", "anchored to the top edge of the navy card", "floating in the bottom-right corner"). The downstream system needs concrete spatial reasoning to lay things out.

7. Quality bar reference
   End with a one-line aspirational reference. Examples: "Linear product launch quality", "Bloomberg data card editorial", "Stripe documentation polish", "Notion marketing site quality". Pick the one that fits the section type.

UNIVERSAL COMPOSITION RULES — APPLY TO EVERY BRIEF

A. EVERY ELEMENT IN SHARP FOCUS.
   Never write a brief that asks for "soft", "blurred", "out of focus", "muted background", "faded", "depth of field", "background blur", "bokeh", "hazy", or any variant. Marketing imagery renders at small sizes (600px for email, smaller for mobile and social) and any deliberately blurred area looks broken, not deliberate, at that scale.

   Achieve focal hierarchy through other means: scale (make the subject bigger), elevation (multi-layer shadow), colour contrast (saturated subject against muted surroundings of the SAME sharpness), or positioning (centred with generous breathing room). Never through blur or softening.

   Also banned: gradient overlays on top of content, vignettes, darkening shrouds, fade-to-black or fade-to-colour treatments, semi-transparent panels laid over a website mockup, any tonal treatment that obscures or veils content underneath. If you want a host-website mockup to recede behind a focal widget, do it by muting the website's colour saturation, simplifying its element count, or making the focal widget physically larger — never by laying a translucent panel over it.

   If a brief calls for a product mockup over a website background, the website background must be clearly drawn, in focus, at full opacity, with simplified shapes if needed — just less visually weighty than the focal subject. Reduce visual weight by drawing fewer elements, not by blurring or shrouding the ones you draw.

B. CENTRE-HALF SUBJECT PLACEMENT (STRONG PREFERENCE).
   Prefer compositions where the single most important element sits horizontally between 25% and 75% of the canvas width. Side-anchored compositions (chat widget pinned to the right edge, headline pinned to the left) tend to fail on mobile because the focal subject either crops out or shrinks to near-invisibility when the image is scaled to ~380px wide.

   Three-column layouts (like pricing comparisons) are an exception: each column is itself a focal element and the eye is meant to scan all three. The rule applies to single-focal compositions.

   If the brief genuinely demands an asymmetric composition for editorial reasons, you may break this rule — but bias toward centring. If in doubt, centre.

EMAIL OUTPUT RULES — APPLY ONLY WHEN OUTPUT CONTEXT IS "email"

When the input declares OUTPUT CONTEXT: email, design for legibility at 600px (desktop inbox) and 380px (mobile inbox). The downstream PNG is generated at 2x for retina sharpness, but the displayed size in the inbox is small. Briefs that work at 1200×600 on a landing page do NOT survive scaling to 600px in an inbox unless they obey these rules:

E1. Minimum on-canvas type sizes:
    - Body text: 16px or larger
    - Eyebrows and captions: 13px or larger
    - Chart labels and pill text: 11px or larger
    - Metadata strips ("Last analysed 3h ago", "ref: a3f9b1", source attributions): OMIT ENTIRELY for email output. They vanish at email display size and add visual noise.

E2. Single-layer shadows only.
    Multi-layer shadow stacks (a Travelgenix editorial signature) are a landing-page treatment. For email, one clean shadow per card is enough. Anything more disappears at downscale and just adds file weight.

E3. Bolder shapes, less density.
    A landing-page pricing card has 6 to 8 features per column. An email pricing card has 3 to 4. A landing-page feature grid is 3x3. An email feature grid is 2x2 or even 1x4. Reduce element count by 30 to 50% versus what you would put on a landing page. Density that reads as "considered editorial" at large size reads as "cluttered postage stamp" at email size.

E4. No micro-detail.
    Skip the small "live" pulse dots, tiny status indicators under 8px, hairline 1px borders that anti-alias to nothing. These reward close-reading on a landing page and disappear in email.

PRODUCT VISUAL RULE — APPLY WHEN A PRODUCT VISUAL SPEC IS INJECTED

If the input contains a "PRODUCT VISUAL SPEC" block, the brief MUST follow that spec exactly when describing how the product looks. The spec is the source of truth, not your memory or imagination, and not the brief generator's reference briefs.

P0. WHEN A SCREENSHOT IS ATTACHED, IT IS THE PRIMARY VISUAL REFERENCE.
    If the user message contains an attached image (a screenshot of the actual product), examine it carefully BEFORE writing anything. The screenshot shows the product as it actually exists in production. Match the brief to what you SEE in the screenshot:
    - Read text labels off the screenshot character by character — the brief should specify the exact strings shown
    - Sample colours from what you observe — even when the text spec lists hex codes, the screenshot tells you which areas use which colours and at what relative weight
    - Note the exact proportions, padding, spacing, alignment — the brief should describe these accurately
    - Observe the icon shapes — describe them as they appear, not as you might imagine them
    - Pay attention to corner radii, shadow weight, border thickness — these subtle details are what separate a faithful render from a generic approximation

    The brief becomes a description of WHAT YOU SEE plus the compositional framing (canvas size, background, lighting, position). You are essentially writing a description that, if read by another designer with the same screenshot, would produce the same visual.

    The text spec below the screenshot provides supporting detail the image can't show: anti-patterns (things to avoid), alternate states (welcome vs mid-conversation), brand role assignments, typography signatures. Use the spec to fill gaps the screenshot leaves and to enforce non-negotiable rules. When screenshot and spec agree: follow both. When they appear to disagree: the SCREENSHOT wins for visual reproduction, the SPEC wins for anti-patterns and rules.

P1. Reproduce visual details from the spec verbatim. Hex codes, font sizes, weights, padding values, corner radii, icon shapes, exact wording on UI labels — all of these come from the spec, not from inference. If the spec says the avatar is a teal rounded square with a serif "L", do not write a brief that calls for a sparkle icon, a circular avatar, or a different letter.

P2. The spec's "Anti Patterns" section is non-negotiable. Every "Do NOT" in there is a hard prohibition. Read the anti-patterns BEFORE writing the brief and avoid every one of them.

P3. The spec contains multiple states (welcome, mid-conversation, collapsed). Pick the right state based on the brief's intent:
    - If the brief is about "the product" or "introducing the product" with no scenario, render the welcome / default state.
    - If the brief explicitly mentions a customer asking, a conversation happening, a search in progress, or showing a result — render the mid-conversation state.
    - If the brief calls for the product as a small element on a host site (a website mockup with the widget pinned in the corner), render the collapsed launcher OR the expanded welcome state per what the composition needs.

P4. When the spec specifies a position (e.g. "bottom-right corner of the host site"), respect it. Do not centre a corner widget. Do not full-screen a panel that is meant to float.

P5. Treat the spec's "Colour Signatures" and "Typography Signatures" as a closed list. Do not invent additional brand colours or fonts for this product. If you need a colour that is not listed, fall back to the standard Travelgenix brand tokens — never invent.

P6. When you reference the product in the brief, write the visual instructions as if you are dictating to a designer who has the spec open in front of them. You are not paraphrasing the spec — you are using it. The brief should say "Render the Luna Chat widget as specified, in its welcome state, anchored to the bottom-right of the website mockup" and then describe the EXTERNAL composition (everything around the widget), trusting the spec to define the widget's internal anatomy.

P7. If the user input's facts contradict the spec (e.g. the brief says "Luna Chat with a sparkle icon" but the spec says "no sparkle icon"), the spec wins. Mention this in the brief if needed: "Render the Luna Chat widget per spec — note the spec calls for a serif L, not a sparkle icon."

P8. PRODUCT-CENTRED COMPOSITION FOR EMAIL OUTPUT.
    When OUTPUT CONTEXT is "email" and a product visual spec is injected, the image is a PRODUCT PHOTO, not a website mockup. The product is the entire subject. There is no host website behind it, no browser chrome around it, no marketing copy beside it.

    Compose as follows: the product (Luna Chat widget, whichever product the spec describes) rendered at its full natural proportions, sized so it occupies between 60% and 75% of the canvas height. Centred horizontally on the canvas. The background is a clean brand-tinted surface — a soft navy gradient running diagonally from #1B2B5B at one corner to #0F1F4E at the opposite corner is the default Travelgenix treatment, but a flat #0F1F4E or a subtle teal-to-navy gradient also work. Choose ONE clean background, no overlays, no patterns, no textures.

    Around the product, leave generous negative space (15-20% of canvas height as breathing room top and bottom). Add a single multi-layer drop shadow under the product (0 24px 60px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.2)) to lift it off the background.

    Do NOT add: a browser frame, a website behind the product, marketing copy beside the product, eyebrow labels, headlines, feature bullets, social proof, captions, watermarks, "as seen on" strips. Nothing on the canvas except the product, its shadow, and the background. The image IS the product portrait.

    Think Apple keynote product photo. Think Stripe documentation hero. Think Linear feature announcement. The product is the subject, centred, beautifully lit, on a brand-coloured studio background.

    This rule supersedes any composition the brief content might suggest. If the section content says "Luna Chat on a travel website" — render the Luna Chat widget centred on a clean navy background instead. The "on a travel website" part is editorial framing; the IMAGE is the product itself. The email's text sections (which wrap this image) carry the narrative of "on a website" through words.

    When OUTPUT CONTEXT is "web" or "social", you may use the wider product-mockup-over-website composition (the product anchored in its natural position on a host site). Email is the constraint that demands the product-centred treatment.

P9. NO HAZE, NO GRADIENT OVERLAYS, NO FADE EFFECTS ON THE PRODUCT.
    For any product mockup brief, the product and its background must be at FULL opacity, FULL saturation, and FULL focus across the entire canvas. The bottom of the canvas has identical visual treatment to the top. The left edge has identical treatment to the right edge.

    Specifically forbidden:
    - Gradient overlays laid on top of the product or background that fade to a different colour at one edge
    - Vignettes (darkening at the canvas corners or edges)
    - Fade-to-navy or fade-to-black treatments at the bottom of the image
    - Translucent panels of any kind placed over the product or background
    - "Atmospheric haze" or "depth-of-field" treatments that blur or veil any portion of the canvas
    - Anti-pattern: the lower 30% of the image being a different opacity or saturation from the upper 30%

    The background can be a clean gradient (corner-to-corner navy is fine), but a gradient as a BACKGROUND is different from an overlay ON TOP of content. If in doubt: every pixel in the image is intentionally drawn at full clarity. There are no "atmospheric" effects.

ANTI-PATTERNS

- Substituting different numbers, prices, dates, or statistics for ones the input provides. This is a critical failure mode. If the input says "£159", the brief says "£159".
- Generic descriptions ("a nice card with some text"). Always specific.
- Brand voice violations. NO em dashes, NO en dashes, NO Oxford commas. Use commas, full stops, or middle-dots (·).
- Listing every element with bullet points. Brief should read as a paragraph, not a checklist.
- Mentioning the canvas size, output format, or technical rendering. The downstream pipeline handles all that.
- Copying any uploaded style reference exactly. If a style reference is provided, extract its structural pattern (layout, typographic feel, density) and apply it to the Travelgenix content. Never reproduce another brand's content, copy, or specific visual elements.
- UK English at all times (colour, favourite, organisation, recognise).
- ZERO banned words: leverage, utilise, synergy, game-changer, innovative, cutting-edge, delve, seamlessly, robust, best-in-class.
- ZERO competitor names: TProfile, Top Dog, Inspiretec, Dolphin Dynamics, Traveltek, Moonstride, Travelsoft, Juniper.

THE FOUR REFERENCE BRIEFS

When in doubt, your brief should sit alongside these four as a sibling:

(A) Destination spotlight card. Place name in italic serif. Live weather card with glassmorphic surface. 12-month climate chart with seasonal colours and BEST badges on the shoulder-season months. Rainfall strip. Luna AI recommendation card on the right with sparkle icon, italic serif "Late May to early June" headline, data bars, confidence line. Footer with italic serif CTA and two buttons. Thin monospace bottom strip with breadcrumbs and ref ID. Navy header with orange radial glow. Editorial magazine quality.

(B) Luna Chat product mockup. Browser frame with traffic-light dots and address bar. Travel agency homepage in the background with hero banner, search bar, destination cards. Luna Chat widget floating bottom-right, fully expanded. Sparkle icon, "Luna · Online" header. Customer message asking for trip help, Luna replying, inline recommendation card with price. Typing indicator. Input field and teal send button. Linear screenshot reveal polish.

(C) Pricing comparison, three columns. SPARK, BOOST, IGNITE. Middle column elevated with navy background, white text, "MOST POPULAR" pill anchored to top edge. Eyebrows in letter-spaced caps. Plan name in sans-serif. Price treatment with large numbers, setup fee in monospace. Feature list with teal tick icons. CTA buttons follow hierarchy. Monthly/Annual toggle above. Trust signal strip below. Linear or Vercel SaaS pricing quality.

(D) Why Travelgenix feature grid. Eyebrow "WHY TRAVELGENIX" in letter-spaced teal caps. Serif italic display headline. 3 column by 2 row grid of six feature tiles, each tile a white card with unique colour-coded icon and 2-line description. One tile elevated to suggest hover state. Below grid, social proof line in italic serif with gold star icons. Stripe product page editorial.

Now read the input and write the brief.`;

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an image brief.
 *
 * Behaviour: when the input mentions a known Travelgenix product (by name
 * or alias, matched in lib/brief-generator's product-visuals cache), the
 * full visual spec for that product is injected into the user message and
 * the system prompt's PRODUCT VISUAL RULE kicks in. The brief generator
 * then writes a brief that follows the spec verbatim (hex codes, type
 * sizes, exact UI labels, icon shapes) instead of inventing visual details
 * from imagination. The Airtable Product Visuals table is the source of
 * truth; specs are cached in-memory for 5 minutes.
 *
 * @param {Object} input
 * @param {string} input.sectionType       e.g. "hero", "feature-card", "pricing-card", "data-card", "product-mockup", "destination-spotlight"
 * @param {Object} input.sectionContent    Structured content from the composer
 * @param {string} [input.sectionContent.headline]
 * @param {string} [input.sectionContent.subhead]
 * @param {string} [input.sectionContent.bodyText]
 * @param {string} [input.sectionContent.productContext]
 * @param {Array}  [input.sectionContent.facts]              List of plausible specifics (prices, dates, stats)
 * @param {string} [input.sectionContent.cta]
 * @param {Object} [input.brandTokens]     Optional override; defaults to Travelgenix
 * @param {Object} [input.styleReference]  Stage E placeholder. Today: null
 * @param {string} [input.outputContext]   "email" | "web" | "social". Default "web".
 *                                         When "email", Opus applies the E1-E4 email rules in the
 *                                         system prompt (minimum on-canvas type sizes, single-layer
 *                                         shadows, lower density, no micro-detail). When "web" or
 *                                         "social", standard editorial density applies.
 *
 * @returns {Promise<{ok, brief, model, elapsedMs, usage, error?}>}
 */
async function generateBrief(input) {
  if (!input || !input.sectionType) {
    return { ok: false, error: "sectionType is required" };
  }
  if (!input.sectionContent || typeof input.sectionContent !== "object") {
    return { ok: false, error: "sectionContent object is required" };
  }
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured" };
  }

  const startedAt = Date.now();
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Try to match a known product against the brief input. Best-effort:
  // fetchProductVisuals never throws, returns [] on any failure, so
  // brief generation continues even if Airtable is unavailable.
  const productVisuals = await fetchProductVisuals();
  const matchedProduct = matchProductVisual(input, productVisuals);

  // If we matched a product AND it has a Reference Screenshot, download
  // the bytes so we can pass them as multimodal input to Opus. Same bytes
  // are returned to the caller so the HTML renderer can reuse them
  // without a second download. Graceful degradation: if the download
  // fails, screenshotImage stays null and we fall back to text-only.
  let screenshotImage = null;
  if (matchedProduct && matchedProduct.screenshotUrl) {
    screenshotImage = await downloadScreenshotAsBase64(
      matchedProduct.screenshotUrl,
      matchedProduct.screenshotMediaType
    );
  }

  // Build the user-message input for the brief generator. We pass the
  // section content as readable structured text so Opus can reason about
  // it naturally rather than parsing JSON.
  const userMessageText = buildUserMessage(input, matchedProduct, !!screenshotImage);

  // When we have a screenshot, pass it as multimodal content. The image
  // block goes FIRST so the model anchors on what it sees before reading
  // the text spec. The text then references "the attached screenshot"
  // explicitly.
  const userContent = screenshotImage
    ? [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: screenshotImage.mediaType,
            data: screenshotImage.data
          }
        },
        { type: "text", text: userMessageText }
      ]
    : userMessageText;

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: BRIEF_GENERATOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }]
    });
  } catch (e) {
    const detail = e && e.message ? e.message : String(e);
    return {
      ok: false,
      error: "Brief generator failed: " + detail.slice(0, 300),
      stage: "claude"
    };
  }

  if (!response || !response.content || !Array.isArray(response.content)) {
    return { ok: false, error: "Brief generator returned unexpected response shape", stage: "shape" };
  }

  let brief = "";
  for (const block of response.content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      brief += block.text;
    }
  }
  brief = brief.trim();

  // Defensive cleanup: strip em/en dashes if Opus slipped any in despite
  // the prompt. The brief flows into the renderer prompt which also bans
  // them — but cleaning at this layer too is cheap defence in depth.
  brief = brief.replace(/[\u2013\u2014]/g, ",");

  // Strip any leading prefix Opus might add ("Brief:", "Here is the brief:", etc)
  brief = brief.replace(/^(brief|here is the brief|here's the brief|image brief)[:\s]+/i, "").trim();

  if (brief.length < 80) {
    return {
      ok: false,
      error: "Brief generator returned suspiciously short output (" + brief.length + " chars)",
      stage: "validate",
      brief
    };
  }

  // ─── POST-PROCESS: Anti-pattern validation ──────────────────────
  // Scan the brief for forbidden literal strings from the product's
  // anti-patterns. Auto-fix any we have a corrective for. Re-run Opus
  // with explicit feedback if hard violations remain.
  let validationReport = null;
  let rerunOccurred = false;
  if (matchedProduct && matchedProduct.antiPatterns) {
    const initial = validateBriefAgainstAntiPatterns(brief, matchedProduct.antiPatterns);
    validationReport = {
      totalViolations: initial.violations.length,
      autoFixed: initial.fixedCount,
      hardViolations: initial.hardViolations.length,
      details: initial.violations.map(v => ({
        forbidden: v.forbidden,
        correctedTo: v.correct || null
      }))
    };

    if (initial.fixedCount > 0) {
      console.log(`[brief-generator] auto-fixed ${initial.fixedCount} anti-pattern violation(s)`);
      brief = initial.fixed;
    }

    // If there are violations we COULDN'T auto-fix (no corrective in the
    // spec), re-run Opus once with feedback. Cap at one re-run to avoid
    // runaway loops. The feedback message tells Opus exactly what it
    // violated and asks for a corrected brief.
    if (initial.hardViolations.length > 0) {
      console.log(`[brief-generator] ${initial.hardViolations.length} hard violation(s) — re-running Opus with feedback`);
      const violationFeedback = initial.hardViolations
        .map(v => `- You wrote or implied "${v.forbidden}", which is forbidden by the spec. Context: ${v.context.slice(0, 200)}`)
        .join("\n");

      // Build re-run user content. Image (if any) stays; text gets a
      // feedback addendum.
      const rerunUserText = `Your previous brief contained the following anti-pattern violations:

${violationFeedback}

Re-write the brief, keeping the same overall composition and intent, but EXPLICITLY avoiding the violations above. Do not use any of the forbidden phrases. Re-read the ANTI PATTERNS section at the top of the spec before writing.

Previous brief (for reference, with violations):
${brief}

Write the corrected brief now. Output ONLY the brief text, no preamble.`;

      const rerunUserContent = screenshotImage
        ? [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: screenshotImage.mediaType,
                data: screenshotImage.data
              }
            },
            { type: "text", text: userMessageText + "\n\n" + rerunUserText }
          ]
        : userMessageText + "\n\n" + rerunUserText;

      try {
        const rerunResponse = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: BRIEF_GENERATOR_SYSTEM_PROMPT,
          messages: [{ role: "user", content: rerunUserContent }]
        });
        let rerunBrief = "";
        for (const block of rerunResponse.content) {
          if (block && block.type === "text" && typeof block.text === "string") {
            rerunBrief += block.text;
          }
        }
        rerunBrief = rerunBrief
          .trim()
          .replace(/[\u2013\u2014]/g, ",")
          .replace(/^(brief|here is the brief|here's the brief|image brief)[:\s]+/i, "")
          .trim();

        if (rerunBrief.length >= 80) {
          // Validate the re-run output. Even if hard violations remain,
          // we keep the re-run version because it's been through one
          // more pass of intentional avoidance.
          const rerunValidation = validateBriefAgainstAntiPatterns(rerunBrief, matchedProduct.antiPatterns);
          brief = rerunValidation.fixed; // includes any auto-fix on re-run output
          rerunOccurred = true;
          validationReport.rerunResult = {
            stillViolating: rerunValidation.hardViolations.length,
            autoFixedOnRerun: rerunValidation.fixedCount
          };
          console.log(`[brief-generator] re-run complete. Remaining hard violations: ${rerunValidation.hardViolations.length}`);
        } else {
          console.warn("[brief-generator] re-run returned short brief, keeping auto-fixed original");
        }
      } catch (e) {
        // Re-run failed — keep the auto-fixed original. Log and continue.
        console.warn("[brief-generator] re-run error, keeping auto-fixed original:", e.message);
      }
    }
  }

  return {
    ok: true,
    brief,
    model: MODEL,
    elapsedMs: Date.now() - startedAt,
    usage: response.usage,
    // Pass the matched product's screenshot bytes (if any) up to the
    // caller. The HTML renderer (image-generator-v2) uses these bytes
    // to pass the same image to Sonnet as multimodal input, so Sonnet
    // renders HTML that visually matches the source rather than from
    // imagination. Cached at this module's URL-keyed map so a second
    // call within 5 minutes is free.
    screenshotImage,
    matchedProductName: matchedProduct ? matchedProduct.name : null,
    // Validation telemetry — useful for telling the caller whether the
    // brief had to be auto-fixed or re-run. Null when no product was
    // matched (so no anti-patterns to validate against).
    validation: validationReport,
    rerunOccurred
  };
}

// ─────────────────────────────────────────────────────────────────────
// USER MESSAGE BUILDER
// ─────────────────────────────────────────────────────────────────────

function buildUserMessage(input, matchedProduct, hasScreenshot) {
  const lines = [];

  // Output context up top — it gates rule application (the E1-E4 email
  // rules in the system prompt). Default "web" preserves existing
  // behaviour for any caller (e.g. the lab) that doesn't pass it.
  const outputContext = (input.outputContext === "email" || input.outputContext === "social")
    ? input.outputContext
    : "web";
  lines.push(`OUTPUT CONTEXT: ${outputContext}`);
  if (outputContext === "email") {
    lines.push("(This image will display at ~600px in an inbox, ~380px on mobile. Apply email rules E1-E4 from the system prompt.)");
  } else if (outputContext === "social") {
    lines.push("(Standard editorial density — same rules as web.)");
  }
  lines.push("");

  lines.push(`SECTION TYPE: ${input.sectionType}`);
  lines.push("");
  lines.push("SECTION CONTENT:");

  const sc = input.sectionContent;
  if (sc.headline) lines.push(`- Headline: "${sc.headline}"`);
  if (sc.subhead) lines.push(`- Subhead: "${sc.subhead}"`);
  if (sc.bodyText) lines.push(`- Body text: ${sc.bodyText}`);
  if (sc.productContext) lines.push(`- Product context: ${sc.productContext}`);
  if (sc.cta) lines.push(`- CTA: "${sc.cta}"`);

  if (Array.isArray(sc.facts) && sc.facts.length > 0) {
    lines.push("");
    lines.push("FACTS — USE EVERY ONE OF THESE EXACTLY AS WRITTEN.");
    lines.push("Reproduce numbers, prices, names, and dates verbatim. Do not paraphrase or substitute.");
    sc.facts.forEach(fact => {
      lines.push(`  - ${fact}`);
    });
  }

  // Brand tokens (default Travelgenix; pass explicit values for multi-tenant later)
  const tokens = input.brandTokens || {};
  lines.push("");
  lines.push("BRAND CONTEXT:");
  lines.push(`- Brand: ${tokens.brandName || "Travelgenix"}`);
  lines.push(`- Primary navy: ${tokens.navy || "#1B2B5B"}`);
  lines.push(`- Accent teal: ${tokens.teal || "#00B4D8"}`);
  if (tokens.audience) lines.push(`- Audience: ${tokens.audience}`);
  if (tokens.tone) lines.push(`- Tone: ${tokens.tone}`);

  // Stage E hook: style reference. Currently unused.
  if (input.styleReference) {
    lines.push("");
    lines.push("STYLE REFERENCE (apply structural pattern, do NOT copy content):");
    if (input.styleReference.layoutPattern) {
      lines.push(`- Layout pattern: ${input.styleReference.layoutPattern}`);
    }
    if (input.styleReference.typographyFeel) {
      lines.push(`- Typography feel: ${input.styleReference.typographyFeel}`);
    }
    if (input.styleReference.density) {
      lines.push(`- Density: ${input.styleReference.density}`);
    }
    if (input.styleReference.mood) {
      lines.push(`- Mood: ${input.styleReference.mood}`);
    }
  }

  // Inject the matched product visual spec, if any. This is the source
  // of truth for HOW the product looks — Opus must follow it verbatim
  // when describing the product in the brief. Without this block, Opus
  // renders the product from its own imagination, which produces
  // generic chat-widget / generic-card output instead of the actual
  // Travelgenix product.
  //
  // Section ORDER matters. Anti patterns first because they're what
  // Opus has been drifting on (e.g. emitting "Online · responds
  // instantly" as a status line despite the anti-patterns explicitly
  // forbidding it). Putting them at the top, with strong framing, and
  // requiring Opus to acknowledge them before writing, addresses
  // instruction-following drift observed in production runs.
  if (matchedProduct) {
    lines.push("");
    lines.push(`PRODUCT VISUAL SPEC — ${matchedProduct.name.toUpperCase()}`);
    if (hasScreenshot) {
      lines.push("");
      lines.push("AN ACTUAL SCREENSHOT OF THIS PRODUCT IS ATTACHED ABOVE THIS TEXT.");
      lines.push("The screenshot is the PRIMARY visual reference. Look at it carefully.");
      lines.push("Match the brief to what you SEE in the screenshot:");
      lines.push("- Exact text labels (read them off the screenshot)");
      lines.push("- Exact colours (sample from the screenshot)");
      lines.push("- Exact icon shapes and positions");
      lines.push("- Exact spacing and proportions");
      lines.push("- Exact corner radii and shadow weight");
      lines.push("The text spec below is supporting context that adds details the screenshot can't show (anti-patterns, alternate states, brand role assignments). When the screenshot and the spec agree, follow both. If they ever appear to disagree, the SCREENSHOT wins for visuals and the SPEC wins for anti-patterns.");
      lines.push("");
    }

    // ANTI PATTERNS FIRST — promoted from the bottom because Opus was
    // skipping them when they sat at the end of a long spec.
    if (matchedProduct.antiPatterns) {
      lines.push("════════════════════════════════════════════════════════");
      lines.push("## ANTI PATTERNS — READ FIRST, FOLLOW WITHOUT EXCEPTION");
      lines.push("════════════════════════════════════════════════════════");
      lines.push("");
      lines.push("These are NON-NEGOTIABLE. Every \"Do NOT\" below is a hard rule.");
      lines.push("If your brief emits any phrase or visual detail listed here, the brief is INVALID and will be regenerated. Read each line carefully BEFORE writing any part of the brief.");
      lines.push("");
      lines.push(matchedProduct.antiPatterns);
      lines.push("");
      lines.push("════════════════════════════════════════════════════════");
      lines.push("");
    }

    lines.push("## SPEC DETAILS");
    lines.push("This spec describes EXACTLY how to render the product in the brief.");
    lines.push("Reproduce hex codes, type sizes, exact UI text, icon shapes, and corner radii verbatim.");
    lines.push("");
    if (matchedProduct.oneLiner) {
      lines.push(`> ${matchedProduct.oneLiner}`);
      lines.push("");
    }
    if (matchedProduct.dimensions) {
      lines.push("## Dimensions and shape");
      lines.push(matchedProduct.dimensions);
      lines.push("");
    }
    if (matchedProduct.header) {
      lines.push("## Header");
      lines.push(matchedProduct.header);
      lines.push("");
    }
    if (matchedProduct.body) {
      lines.push("## Body (default / welcome state)");
      lines.push(matchedProduct.body);
      lines.push("");
    }
    if (matchedProduct.interactive) {
      lines.push("## Interactive elements");
      lines.push(matchedProduct.interactive);
      lines.push("");
    }
    if (matchedProduct.footer) {
      lines.push("## Footer / input bar");
      lines.push(matchedProduct.footer);
      lines.push("");
    }
    if (matchedProduct.colourSignatures) {
      lines.push("## Colour signatures");
      lines.push(matchedProduct.colourSignatures);
      lines.push("");
    }
    if (matchedProduct.typographySignatures) {
      lines.push("## Typography signatures");
      lines.push(matchedProduct.typographySignatures);
      lines.push("");
    }
    if (matchedProduct.variations) {
      lines.push("## Variations / alternate states");
      lines.push(matchedProduct.variations);
      lines.push("");
    }

    // PRE-FLIGHT — restate the anti-patterns one more time, just before
    // "Write the brief." This is the last thing Opus reads. By the time
    // it starts writing, anti-patterns are top of mind.
    if (matchedProduct.antiPatterns) {
      lines.push("════════════════════════════════════════════════════════");
      lines.push("## PRE-FLIGHT CHECK BEFORE WRITING THE BRIEF");
      lines.push("════════════════════════════════════════════════════════");
      lines.push("");
      lines.push("Before you write the brief, re-read the ANTI PATTERNS above.");
      lines.push("If you find yourself about to write any of these phrases or describe any of these visual details — STOP and use the correct version instead.");
      lines.push("");
      lines.push("Common drifts on this product (these have failed validation in past runs — do not repeat them):");
      lines.push(matchedProduct.antiPatterns);
      lines.push("");
      lines.push("════════════════════════════════════════════════════════");
      lines.push("");
    }
  }

  lines.push("");
  lines.push("Write the brief.");

  return lines.join("\n");
}

module.exports = {
  generateBrief,
  fetchProductVisuals,
  matchProductVisual,
  downloadScreenshotAsBase64,
  parseAntiPatterns,
  validateBriefAgainstAntiPatterns,
  _internals: { buildUserMessage, BRIEF_GENERATOR_SYSTEM_PROMPT, PV_FIELDS }
};

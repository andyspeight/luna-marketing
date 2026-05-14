// lib/promotion-client.js
//
// Promotion Engine client wrapper + channel-specific renderers.
//
// This module is the ONLY place other parts of Luna Marketing should touch the
// Promotion Engine. Don't call /api/promotion-decide directly from anywhere
// else — call promotionDecide() from here.
//
// What lives here:
//   - promotionDecide(input)            — calls the engine, returns a decision
//   - renderSocialCloser(decision, platform)  — short text closer for social posts
//   - renderEmailCalloutSection(decision)     — section JSON for email-render engine
//   - renderBlogSolutionsBlock(decision)      — HTML block for blog post footer
//
// Author: Travelgenix
// Date:   14 May 2026

const ENGINE_URL = process.env.PROMOTION_ENGINE_URL ||
  "https://luna-marketing.vercel.app/api/promotion-decide";

const DEFAULT_TIMEOUT_MS = 8000;

// ============================================================================
// THE CLIENT
// ============================================================================

/**
 * Call the Promotion Engine and return a decision.
 *
 * Failures (network errors, timeouts, 5xx responses) are caught and return
 * a "no promotion" decision rather than throwing. This means a Promotion Engine
 * outage NEVER blocks content from being drafted — content still ships, just
 * without a product mention.
 *
 * @param {Object} input
 * @param {string} input.tenantId
 * @param {string} input.channel
 * @param {string} input.contentTopic
 * @param {string} [input.contentArchetype]
 * @returns {Promise<Object>} Decision (always returns shouldPromote: bool, etc)
 */
async function promotionDecide(input) {
  const secret = process.env.PROMOTION_ENGINE_SECRET;
  if (!secret) {
    console.error("[promotion-client] PROMOTION_ENGINE_SECRET not configured");
    return failClosed("Engine secret not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-promotion-secret": secret
      },
      body: JSON.stringify(input),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error(`[promotion-client] Engine returned ${res.status}`);
      return failClosed(`Engine returned ${res.status}`);
    }

    const data = await res.json();
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[promotion-client] Engine call failed:", err.message || err);
    return failClosed(err.message || "Engine call failed");
  }
}

function failClosed(reason) {
  return {
    shouldPromote: false,
    product: null,
    prominence: "none",
    asset: null,
    reasoning: `[promotion-client] Fail-closed: ${reason}`
  };
}

// ============================================================================
// SOCIAL CLOSER RENDERER
// ============================================================================

/**
 * Render a short product closer to append to a social post caption.
 *
 * Platform-aware:
 *   - LinkedIn / Facebook / GBP: full sentence with link
 *   - Twitter:           short hook with link (char-budget aware)
 *   - Instagram / TikTok: "link in bio" note (no inline links allowed)
 *   - Pinterest:         keyword-rich description with link
 *
 * Returns null if the decision says don't promote.
 *
 * @param {Object} decision  Output of promotionDecide()
 * @param {string} platform  linkedin-personal | linkedin-company | facebook | instagram | twitter | tiktok | pinterest | gbp
 * @returns {string|null}    Text to append, or null
 */
function renderSocialCloser(decision, platform) {
  if (!decision || !decision.shouldPromote || !decision.product) return null;

  const p = decision.product;
  const cta = p.cta || {};
  const prom = decision.prominence;

  // Different prominence levels = different wording.
  // SOFT:    one sentence, almost an aside
  // CALLOUT: two sentences, named pitch + CTA
  // SPOTLIGHT: same as callout for social (the prominence upgrade matters
  //           more for email where there's room for a full section)

  const isLink = ["linkedin-personal", "linkedin-company", "facebook", "gbp"].includes(platform);
  const isTwitter = platform === "twitter";
  const isPinterest = platform === "pinterest";
  const isLinkInBio = ["instagram", "tiktok"].includes(platform);

  // ─── LinkedIn, Facebook, GBP ───
  if (isLink) {
    if (prom === "soft") {
      return `\n\n${p.oneLiner} ${cta.url || ""}`.trim();
    }
    // callout / spotlight
    return `\n\n${p.name}: ${p.oneLiner}\n\n${cta.text || "Learn more"} → ${cta.url || ""}`.trim();
  }

  // ─── Twitter — strict character budget, word-boundary truncation ───
  if (isTwitter) {
    // Aim for under 80 chars so the caller can fit a 200-char post + closer
    // under the 280-char limit comfortably. Truncate at word boundary so we
    // never chop mid-word.
    let short = p.oneLiner;
    if (short.length > 70) {
      const cut = short.slice(0, 70);
      const lastSpace = cut.lastIndexOf(" ");
      short = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:]$/, "") + "...";
    }
    return `\n\n${short} ${cta.url || ""}`.trim();
  }

  // ─── Pinterest — keyword-rich, single-thought ───
  if (isPinterest) {
    // Build as one flowing description, no stacked clauses, no em dashes.
    // Lead with product name, then pitch, then proof if available.
    const parts = [`${p.name}. ${p.oneLiner}`];
    if (p.proof) parts.push(p.proof);
    parts.push(`${cta.text || "Learn more"}: ${cta.url || ""}`);
    return "\n\n" + parts.join(" ").trim();
  }

  // ─── Instagram / TikTok — no inline links allowed ───
  if (isLinkInBio) {
    // Strip trailing punctuation from oneLiner so we don't end up with ".."
    const cleanLiner = p.oneLiner.replace(/[.!?]+\s*$/, "");
    return `\n\n${p.name}: ${cleanLiner}. Link in bio.`;
  }

  // Unknown platform — return null rather than guessing
  console.warn(`[promotion-client] Unknown platform '${platform}', returning null`);
  return null;
}

// ============================================================================
// EMAIL CALLOUT SECTION RENDERER
// ============================================================================

/**
 * Render a section JSON object compatible with the email-render engine.
 * Drops in at the end of an email (just before footer) when shouldPromote is true.
 *
 * Section type: "cta" (existing renderer) — we reuse the existing CTA section
 * type so we don't need to add a new section type to the renderer. Phase 2.5
 * may introduce a dedicated "product-callout" section for richer layout.
 *
 * Returns null if no promotion.
 *
 * @param {Object} decision  Output of promotionDecide()
 * @returns {Object|null}    Section JSON object or null
 */
function renderEmailCalloutSection(decision) {
  if (!decision || !decision.shouldPromote || !decision.product) return null;

  const p = decision.product;
  const cta = p.cta || {};
  const prom = decision.prominence;

  // SOFT:      simple CTA section
  // CALLOUT:   heading + pitch + CTA
  // SPOTLIGHT: heading + pitch + proof + CTA (full deal)

  let heading, body;

  if (prom === "soft") {
    heading = p.name;
    body = p.oneLiner;
  } else if (prom === "callout") {
    heading = p.name;
    body = `${p.oneLiner}\n\n${p.problem || ""}`.trim();
  } else { // spotlight or dedicated
    heading = `Spotlight: ${p.name}`;
    body = `${p.oneLiner}\n\n${p.problem || ""}\n\n${p.proof || ""}`.trim();
  }

  return {
    type: "cta",
    props: {
      heading: heading,
      body: body,
      buttonText: cta.text || "Learn more",
      buttonUrl: cta.url || "",
      // The email renderer's CTA section already supports these props.
      // No new section type needed for v1.
      _promotionSource: {
        productId: p.id,
        productName: p.name,
        prominence: prom,
        reasoning: decision.reasoning
      }
    }
  };
}

// ============================================================================
// BLOG SOLUTIONS BLOCK RENDERER
// ============================================================================

/**
 * Render an HTML block to append at the end of a blog article, before the
 * five actionable tips (per the Travelgenix blog skill).
 *
 * Used by api/generate-blog.js. The HTML is Duda-compatible — uses inline
 * styles only (no classes that might collide with the client's theme).
 *
 * Returns an empty string if no promotion.
 *
 * @param {Object} decision  Output of promotionDecide()
 * @returns {string}         HTML block (or empty string)
 */
function renderBlogSolutionsBlock(decision) {
  if (!decision || !decision.shouldPromote || !decision.product) return "";

  const p = decision.product;
  const cta = p.cta || {};
  const prom = decision.prominence;

  // Brand colours from travelgenix-design skill
  const navy = "#1B2B5B";
  const teal = "#00B4D8";

  // Escape any HTML in product content
  const esc = (s) => String(s || "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));

  const showProof = prom === "spotlight" || prom === "callout";

  return `
<div style="margin: 32px 0; padding: 24px; background-color: #F8FAFC; border-left: 4px solid ${teal}; border-radius: 4px; font-family: Inter, system-ui, sans-serif;">
  <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: ${teal}; text-transform: uppercase; letter-spacing: 0.5px;">How Travelgenix helps</p>
  <h3 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: ${navy};">${esc(p.name)}</h3>
  <p style="margin: 0 0 ${showProof ? "12" : "16"}px 0; font-size: 16px; line-height: 1.6; color: #334155;">${esc(p.oneLiner)}</p>
  ${showProof ? `<p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #64748B;">${esc(p.proof)}</p>` : ""}
  <p style="margin: 0;"><a href="${esc(cta.url)}" style="display: inline-block; padding: 10px 20px; background-color: ${navy}; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">${esc(cta.text || "Learn more")} →</a></p>
</div>
  `.trim();
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  promotionDecide,
  renderSocialCloser,
  renderEmailCalloutSection,
  renderBlogSolutionsBlock,
  // For testing
  _internals: { failClosed }
};

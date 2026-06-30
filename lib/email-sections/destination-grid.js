// lib/email-sections/destination-grid.js
// Archetype B (Marketing Newsletter): three destination cards.
// Manual data (admin types in destination, price, image URL) — not pulled
// from Travelify. For the live-data version, see offers-three-up.
//
// Visual treatment matches offers-three-up so a marketing newsletter
// blending manual destinations and live offers feels consistent. Wraps
// the same imageCell helper from _offer-helpers for image fallback handling.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.2.

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont } = require("./_helpers");

// Local imageCell — simpler version of the offers helper, taking a manual
// image URL. Falls back to a deterministic gradient if the URL is missing
// or fails the https check.
function imageCell(imageUrl, alt, height) {
  const url = (imageUrl && /^https:\/\//i.test(String(imageUrl).trim())) ? safeUrl(imageUrl) : "";
  const altSafe = escHtml(alt || "");

  // Deterministic gradient seed based on alt text so different cards get
  // different placeholder colours
  const seed = (alt || "T").charCodeAt(0) || 84;
  const hue = (seed * 37) % 360;
  const gradient = `linear-gradient(135deg, hsl(${hue},65%,55%), hsl(${(hue + 60) % 360},65%,45%))`;

  if (!url) {
    return `<div style="background:${gradient};height:${height}px;width:100%;display:block;"></div>`;
  }

  // URL present — wrap in a coloured div so if the image fails the cell
  // still has a visual presence (matches offers helper logic)
  return `
<div style="background:${gradient};height:${height}px;width:100%;line-height:0;font-size:0;">
  <img src="${url}" alt="${altSafe}" width="200" height="${height}" style="display:block;width:100%;height:${height}px;border:0;outline:none;text-decoration:none;object-fit:cover;"/>
</div>`;
}

function renderCard(card, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!card || !card.name) return "";
  const url = safeUrl(card.url);
  const tag = card.tag ? escHtml(card.tag) : "";
  const name = escHtml(card.name);
  const meta = card.meta ? escHtml(card.meta) : "";
  const priceFrom = card.price_from ? escHtml(card.price_from) : "From";
  const priceAmount = card.price_amount ? escHtml(card.price_amount) : "";
  const priceUnit = card.price_unit ? escHtml(card.price_unit) : "pp";
  const imageUrl = card.image_url || "";

  // The whole card is a link if a URL is supplied
  const cardOpen = url
    ? `<a href="${url}" style="display:block;text-decoration:none;color:inherit;">`
    : "";
  const cardClose = url ? `</a>` : "";

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border:1px solid ${DESIGN_TOKENS.border};border-radius:12px;overflow:hidden;background:${DESIGN_TOKENS.bgPrimary};">
  <tr>
    <td style="padding:0;font-size:0;line-height:0;">
      ${cardOpen}${imageCell(imageUrl, name, 180)}${cardClose}
    </td>
  </tr>
  <tr>
    <td style="padding:20px;">
      ${cardOpen}
      ${tag ? `<div style="font-family:${FONTS.body};font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:14px;margin:0 0 8px 0;">${tag}</div>` : ""}
      <div style="font-family:${FONTS.heading};font-size:18px;font-weight:600;letter-spacing:-0.015em;color:${DESIGN_TOKENS.textPrimary};line-height:24px;margin:0 0 6px 0;">${name}</div>
      ${meta ? `<div style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:19px;margin:0;">${meta}</div>` : ""}
      ${priceAmount ? `
      <div style="margin:12px 0 0 0;">
        <span style="font-family:${FONTS.body};font-size:11px;font-weight:500;color:${DESIGN_TOKENS.textTertiary};text-transform:uppercase;letter-spacing:0.05em;line-height:16px;">${priceFrom}</span>
        <span style="font-family:${FONTS.heading};font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${DESIGN_TOKENS.primary};line-height:24px;margin-left:6px;">${priceAmount}</span>
        <span style="font-family:${FONTS.body};font-size:11px;font-weight:500;color:${DESIGN_TOKENS.textTertiary};text-transform:uppercase;letter-spacing:0.05em;line-height:16px;margin-left:4px;">${priceUnit}</span>
      </div>` : ""}
      ${cardClose}
    </td>
  </tr>
</table>`;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const eyebrow = escHtml(fallback(props.eyebrow, "Trending now"));
  const title = escHtml(fallback(props.title, "Three destinations worth a closer look"));
  const lede = props.lede ? escHtml(props.lede) : "";
  const cards = Array.isArray(props.cards) ? props.cards.slice(0, 3) : [];

  if (cards.length === 0) return "";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const eyebrowSize = scaleFont(11, props.eyebrow_size);
  const titleSize = scaleFont(26, props.title_size);
  const ledeSize = scaleFont(15, props.lede_size);

  // Build the three-column row. Each cell stacks on mobile via tg-stack-narrow.
  const cells = cards
    .map((c) => `<td valign="top" width="33.33%" class="tg-stack-narrow" style="vertical-align:top;padding:0 8px;">${renderCard(c, brand)}</td>`)
    .join("");

  // Pad with empty cells if fewer than 3 to preserve layout
  const filler = `<td width="33.33%" class="tg-stack-narrow" style="display:none;"></td>`.repeat(Math.max(0, 3 - cards.length));

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:56px 32px 16px;">
  <div style="font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};margin:0 0 12px 0;line-height:${Math.round(eyebrowSize * (18 / 11))}px;">${eyebrow}</div>
  <div style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;line-height:${Math.round(titleSize * (32 / 26))}px;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};margin:0 0 8px 0;">${title}</div>
  ${lede ? `<div style="font-family:${FONTS.body};font-size:${ledeSize}px;line-height:${Math.round(ledeSize * (24 / 15))}px;color:${DESIGN_TOKENS.textSecondary};margin:0 0 32px 0;max-width:520px;">${lede}</div>` : `<div style="height:32px;line-height:32px;font-size:32px;">&nbsp;</div>`}
</td></tr>

<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:0 24px 40px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
    <tr>${cells}${filler}</tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "destination-grid",
  label: "Destination grid (manual)",
  description: "Three destination cards with manual content (image, name, meta, price). For live-data offers, use offers-three-up instead.",
  fields: [
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40, default: "Trending now" },
    { key: "eyebrow_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "title", label: "Section title", type: "text", required: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "lede", label: "Section lede", type: "longText", optional: true, maxLength: 200 },
    { key: "lede_size", label: "Lede text size", type: "fontSize", optional: true },
    { key: "cards", label: "Cards (max 3)", type: "array", required: true, max: 3, itemSchema: {
      image_url: { type: "url", optional: true },
      tag: { type: "text", optional: true, maxLength: 30 },
      name: { type: "text", required: true, maxLength: 60 },
      meta: { type: "text", optional: true, maxLength: 100 },
      price_from: { type: "text", optional: true, default: "From", maxLength: 10 },
      price_amount: { type: "text", optional: true, maxLength: 20 },
      price_unit: { type: "text", optional: true, default: "pp", maxLength: 10 },
      url: { type: "url", optional: true },
    }},
  ],
};

module.exports = { render, schema };

// lib/email-sections/product-cards-3up.js
//
// Three rounded cards in a row, each with an image, a title, and an
// optional short body line. Daily Beacon style — light grey card
// backgrounds, generous internal padding, image centred at the top of
// each card. Useful for: product feature showcase ("Three new features"),
// destination spotlight grids, package comparison cards.
//
// What it accepts:
//   cards             — array of { image_url, image_alt, title, body }
//                       up to 3 entries. Fewer renders fewer cards.
//   card_colour       — card fill colour (default #F5F5F7 soft grey)
//   text_colour       — title + body colour (default #1B2B5B navy)
//   background_colour — outer section bg colour (default transparent)
//
// Layout:
//   [Card 1] [12px gap] [Card 2] [12px gap] [Card 3]
//
// Each card:
//   ┌───────────────┐
//   │  [image]      │
//   │  Title        │
//   │  Body line    │  ← optional
//   └───────────────┘
//
// Mobile: cards stack vertically via `.tg-stack-narrow`.

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback } = require("./_helpers");

function safeHex(value) {
  if (typeof value !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const cardColour = safeHex(props.card_colour) || "#F5F5F7";
  const textColour = safeHex(props.text_colour) || DESIGN_TOKENS.textPrimary || "#1B2B5B";
  const bgColour = safeHex(props.background_colour);

  // Normalise cards array — accept up to 3, ignore rest. Each card needs
  // at least an image OR a title to be rendered (skip totally empty entries).
  const cardsRaw = Array.isArray(props.cards) ? props.cards : [];
  const cards = cardsRaw
    .slice(0, 3)
    .filter(c => c && (c.image_url || c.title));

  if (cards.length === 0) return "";

  // Width per card depends on how many cards we're rendering. With gaps
  // of 12px between cards, available card-width = (528 - 12*(n-1)) / n.
  // n=1: 528, n=2: 258, n=3: 168.
  const cardWidth = cards.length === 1 ? 528 : (cards.length === 2 ? 258 : 168);

  // Render a single card cell.
  const renderCard = (card) => {
    const imgUrl = safeUrl(card.image_url);
    const imgAlt = card.image_alt ? escAttr(card.image_alt) : "";
    const title = card.title ? escHtml(card.title) : "";
    const body = card.body ? escHtml(card.body) : "";

    const imageHtml = imgUrl
      ? `<img src="${imgUrl}" alt="${imgAlt}" width="${cardWidth - 32}" class="tg-img-fluid" style="display:block;width:100%;max-width:${cardWidth - 32}px;height:auto;border:0;border-radius:4px;outline:none;text-decoration:none;margin:0 auto;">`
      : `<div style="width:100%;max-width:${cardWidth - 32}px;height:100px;background-color:#FFFFFF;border-radius:4px;margin:0 auto;"></div>`;

    const titleHtml = title
      ? `<p style="font-family:${FONTS.heading};font-size:14px;font-weight:600;color:${textColour};line-height:1.3;margin:14px 0 0 0;text-align:center;">${title}</p>`
      : "";

    const bodyHtml = body
      ? `<p style="font-family:${FONTS.body};font-size:12px;color:${textColour};line-height:1.5;margin:6px 0 0 0;text-align:center;opacity:0.75;">${body}</p>`
      : "";

    return `
      <td width="${cardWidth}" valign="top" bgcolor="${cardColour}" class="tg-stack-narrow" style="width:${cardWidth}px;background-color:${cardColour};border-radius:8px;padding:16px;">
        ${imageHtml}
        ${titleHtml}
        ${bodyHtml}
      </td>`;
  };

  // Build row with gap spacers between cards.
  const gapCell = `<td width="12" class="tg-stack-narrow" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>`;
  const cardCells = cards.map(renderCard).join(gapCell);

  const outerBg = bgColour ? `bgcolor="${bgColour}"` : "";
  const outerStyle = bgColour
    ? `background-color:${bgColour};padding:24px 36px;`
    : `padding:24px 36px;`;

  return `
<tr><td ${outerBg} class="tg-pad-mobile" style="${outerStyle}">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      ${cardCells}
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "product-cards-3up",
  label: "Product cards (3-up)",
  description: "Three rounded cards in a row, each with an image, title, and optional body. Daily Beacon style — soft grey card backgrounds. Useful for product showcases, three-package comparisons, feature highlights. Stacks vertically on mobile.",
  fields: [
    { key: "cards", label: "Cards (up to 3)", type: "array", itemLabel: "card", itemFields: [
      { key: "image_url", label: "Card image URL", type: "url", required: true },
      { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 120 },
      { key: "title", label: "Card title", type: "text", required: true, maxLength: 60 },
      { key: "body", label: "Card body (optional, short)", type: "text", optional: true, maxLength: 120 },
    ]},
    { key: "card_colour", label: "Card background colour", type: "colour", optional: true, defaultPreview: "#F5F5F7", placeholder: "#F5F5F7", help: "Soft grey by default. Try a tint of your brand colour." },
    { key: "text_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#1B2B5B", placeholder: "#1B2B5B", help: "Card title and body colour." },
    { key: "background_colour", label: "Section background colour (optional)", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for transparent", help: "Apply a tinted background behind the cards." },
  ],
};

module.exports = { render, schema };

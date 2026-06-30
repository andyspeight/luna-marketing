// lib/email-sections/lead-story.js
// Archetype A (B2B Weekly): the editorial centrepiece.
// Teal "kicker" label with a leading em-dash (Outlook-safe Unicode, not
// a CSS pseudo-element), large bold headline, larger deck paragraph,
// 16:9 lead image, byline row (gradient-fallback avatar + name + meta),
// body paragraphs with inline markdown, and a "read full piece" link
// with a teal underline.
//
// See travelgenix-email-design SKILL.md §4, §12.3 (Archetype A checklist),
// and Appendix A.1.
//
// Outlook patterns used:
//   - P5 (image without overlay) for the lead image
//   - P6 (two-column) for the byline avatar / name+meta row
//   - Unicode em-dash before "Lead story" instead of ::before pseudo-element
//   - Avatar uses bgcolor fallback (no gradient text fill); accent text
//     for the avatar initials is the teal accent which still reads on navy

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback, renderBody, scaleFont, safeHex } = require("./_helpers");

function renderByline(byline, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!byline) return "";
  const name = escHtml(fallback(byline.name, ""));
  const meta = escHtml(fallback(byline.meta, ""));
  if (!name && !meta) return "";

  // Build avatar initials. Use first letters of up to two name words.
  // If no name, no avatar — just the meta line.
  let initials = "";
  if (byline.name) {
    const parts = String(byline.name).trim().split(/\s+/).slice(0, 2);
    initials = parts.map((p) => p[0] || "").join("").toUpperCase();
  }
  const avatarHtml = initials
    ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="36"><tr><td bgcolor="${DESIGN_TOKENS.primary}" align="center" valign="middle" width="36" height="36" style="background-color:${DESIGN_TOKENS.primary};border-radius:18px;font-family:${FONTS.body};font-size:13px;font-weight:700;color:#ffffff;line-height:36px;width:36px;height:36px;mso-line-height-rule:exactly;">${escHtml(initials)}</td></tr></table>`
    : "";

  return `
<tr>
  <td style="padding:14px 0;border-top:1px solid ${DESIGN_TOKENS.borderLight};border-bottom:1px solid ${DESIGN_TOKENS.borderLight};">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        ${avatarHtml ? `<td width="48" valign="middle" style="padding-right:12px;">${avatarHtml}</td>` : ""}
        <td valign="middle">
          ${name ? `<div style="font-family:${FONTS.body};font-size:13px;font-weight:600;color:${DESIGN_TOKENS.textPrimary};line-height:18px;margin:0;">${name}</div>` : ""}
          ${meta ? `<div style="font-family:${FONTS.body};font-size:12px;color:${DESIGN_TOKENS.textSecondary};line-height:18px;margin:0;">${meta}</div>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const kickerText = escHtml(fallback(props.kicker, "Lead story"));
  const headline = escHtml(fallback(props.headline, ""));
  const deck = props.deck ? escHtml(props.deck) : "";
  const imageUrl = safeUrl(props.image_url);
  const imageAlt = escAttr(fallback(props.image_alt, headline));
  const byline = props.byline || null;
  const body = props.body ? renderBody(props.body) : "";
  const linkText = escHtml(fallback(props.link_text, "Read the full analysis →"));
  const linkUrl = safeUrl(props.link_url);

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const kickerSize = scaleFont(11, props.kicker_size);
  const headlineSize = scaleFont(30, props.headline_size);
  const deckSize = scaleFont(17, props.deck_size);
  const bodySize = scaleFont(15, props.body_size);

  // Read-more link colours. Defaults keep the original treatment (label =
  // brand primary, underline = brand accent); either can be overridden.
  const ctaFg = safeHex(props.cta_text_colour) || DESIGN_TOKENS.primary;
  const ctaBg = safeHex(props.cta_colour) || DESIGN_TOKENS.accent;

  if (!headline) return "";

  // Image block — P5. We use a plain image (no overlay) since lead-story
  // images carry no text. 568px = 640 wrapper minus 36px L/R padding.
  const imageHtml = imageUrl ? `
    <tr>
      <td style="padding:0 0 24px 0;">
        <img src="${imageUrl}" alt="${imageAlt}" width="568" style="display:block;width:100%;max-width:568px;height:auto;border-radius:8px;border:0;outline:none;text-decoration:none;"/>
      </td>
    </tr>` : "";

  // Read-more link with teal underline. Use border-bottom on a span
  // wrapper so the underline thickness is controllable; fallback in
  // Outlook is just text-decoration:underline.
  const linkHtml = linkUrl ? `
    <tr>
      <td style="padding:8px 0 0 0;">
        <a href="${linkUrl}" style="display:inline-block;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${ctaFg};text-decoration:none;border-bottom:2px solid ${ctaBg};padding-bottom:2px;line-height:20px;">${linkText}</a>
      </td>
    </tr>` : "";

  // Kicker uses Unicode em-dash before the word — bulletproof in Outlook
  // (no ::before required). The spacing inside the dash + space is
  // controlled by a non-breaking space between dash and label.
  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:40px 36px 36px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      <td style="padding:0 0 12px 0;">
        <span style="font-family:${FONTS.body};font-size:${kickerSize}px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:${Math.round(kickerSize * (14 / 11))}px;">— ${kickerText}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 14px 0;">
        <h2 style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;line-height:1.2;letter-spacing:-0.025em;color:${DESIGN_TOKENS.textPrimary};margin:0;">${headline}</h2>
      </td>
    </tr>
    ${deck ? `
    <tr>
      <td style="padding:0 0 24px 0;">
        <p style="font-family:${FONTS.body};font-size:${deckSize}px;line-height:1.55;color:${DESIGN_TOKENS.textSecondary};font-weight:400;margin:0;letter-spacing:-0.005em;">${deck}</p>
      </td>
    </tr>` : ""}
    ${imageHtml}
    ${renderByline(byline, brand)}
    ${body ? `
    <tr>
      <td style="padding:24px 0 0 0;">
        <div style="font-family:${FONTS.body};font-size:${bodySize}px;line-height:1.7;color:${DESIGN_TOKENS.textSecondary};">${body}</div>
      </td>
    </tr>` : ""}
    ${linkHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "lead-story",
  label: "Lead story",
  description: "Editorial centrepiece for the B2B Weekly — kicker, headline, deck, image, byline, body, and a read-more link. Body supports paragraph breaks (blank line) and inline markdown.",
  fields: [
    { key: "kicker", label: "Kicker label", type: "text", optional: true, maxLength: 30, default: "Lead story" },
    { key: "kicker_size", label: "Kicker text size", type: "fontSize", optional: true },
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 120 },
    { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "deck", label: "Deck (large lede paragraph)", type: "longText", optional: true, maxLength: 280 },
    { key: "deck_size", label: "Deck text size", type: "fontSize", optional: true },
    { key: "image_url", label: "Lead image URL", type: "url", optional: true },
    { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "byline", label: "Byline", type: "group", optional: true, fields: [
      { key: "name", label: "Author name", type: "text", maxLength: 60 },
      { key: "meta", label: "Meta (e.g. \"4 min read · Strategy\")", type: "text", maxLength: 80 },
    ]},
    { key: "body", label: "Article body", type: "longText", optional: true, maxLength: 4000, help: "Blank line = paragraph break. **bold**, *italic*, and [text](url) work inline." },
    { key: "body_size", label: "Body text size", type: "fontSize", optional: true },
    { key: "link_text", label: "Read-more link text", type: "text", optional: true, maxLength: 60, default: "Read the full piece →" },
    { key: "link_url", label: "Read-more link URL", type: "url", optional: true },
    { key: "cta_colour", label: "Button colour", type: "colour", optional: true, defaultPreview: "#00B4D8", placeholder: "Defaults to current button colour", help: "Background colour of the button. Leave empty to keep the default." },
    { key: "cta_text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#1B2B5B", placeholder: "Defaults to current label colour", help: "Colour of the button label. Leave empty to keep the default." },
  ],
};

module.exports = { render, schema };

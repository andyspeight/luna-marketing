// lib/email-sections/customer-story.js
//
// A customer story card: who the customer is, the result in one line, a
// quote, up to three proof numbers and a link to the full story. The B2B
// SaaS "case study snippet" for nurture emails and the B2B Weekly.
// Sister to `testimonial` (quote only, centred) and `stats-strip` (numbers
// only). Every name, quote and number must come from the brief — the
// composer never invents customers.
//
// Props:
//   eyebrow          — default "Customer story"
//   client_name      — required
//   client_meta      — e.g. "Independent agency, Bournemouth"
//   logo_url         — optional logo or photo (rendered 44px square)
//   headline         — the result, e.g. "Quotes out in minutes, not hours"
//   quote            — optional
//   attribution_name, attribution_role
//   stats            — array, max 3, of { number, label }
//   link_text, link_url
//   heading_colour, body_colour, background_colour (card tint)

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback, scaleFont, safeHex, editAttr, richAttr, richInline } = require("./_helpers");

function initialsFor(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const clientName = escHtml(fallback(props.client_name, "")).trim();
  if (!clientName) return "";

  const eyebrow = props.eyebrow !== undefined && props.eyebrow !== null ? escHtml(props.eyebrow) : "Customer story";
  const clientMeta = props.client_meta ? escHtml(props.client_meta) : "";
  const logoUrl = safeUrl(props.logo_url);
  const headline = props.headline ? escHtml(props.headline) : "";
  const quote = props.quote ? richInline(props.quote) : "";
  const attrName = props.attribution_name ? escHtml(props.attribution_name) : "";
  const attrRole = props.attribution_role ? escHtml(props.attribution_role) : "";
  const linkText = props.link_text ? escHtml(props.link_text) : "";
  const linkUrl = safeUrl(props.link_url);
  const stats = (Array.isArray(props.stats) ? props.stats : [])
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s && s.number)
    .slice(0, 3);

  const headlineSize = scaleFont(22, props.headline_size);
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const cardBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgSecondary;

  const avatar = logoUrl
    ? `<img src="${logoUrl}" alt="${escAttr(props.client_name)}" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:8px;border:0;outline:none;text-decoration:none;">`
    : `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="44"><tr><td bgcolor="${DESIGN_TOKENS.primary}" align="center" valign="middle" width="44" height="44" style="background-color:${DESIGN_TOKENS.primary};border-radius:8px;font-family:${FONTS.body};font-size:15px;font-weight:700;color:#ffffff;line-height:44px;width:44px;height:44px;mso-line-height-rule:exactly;">${escHtml(initialsFor(props.client_name))}</td></tr></table>`;

  const whoRow = `<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>
      <td width="44" valign="middle" style="width:44px;padding:0 12px 0 0;">${avatar}</td>
      <td valign="middle">
        <div${editAttr(editable, "client_name")} style="font-family:${FONTS.heading};font-size:15px;font-weight:700;color:${headingColour};line-height:20px;margin:0;">${clientName}</div>
        ${clientMeta ? `<div${editAttr(editable, "client_meta")} style="font-family:${FONTS.body};font-size:13px;color:${bodyColour};line-height:18px;margin:2px 0 0 0;">${clientMeta}</div>` : ""}
      </td>
    </tr></table>`;

  const statsHtml = stats.length
    ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="margin:20px 0 0 0;border-top:1px solid ${DESIGN_TOKENS.border};"><tr>${stats.map(({ s, idx }) => `<td width="${Math.floor(100 / stats.length)}%" valign="top" style="padding:16px 12px 0 0;">
        <div${editAttr(editable, `stats.${idx}.number`)} style="font-family:${FONTS.heading};font-size:24px;font-weight:800;letter-spacing:-0.03em;color:${DESIGN_TOKENS.primary};line-height:28px;margin:0 0 4px 0;">${escHtml(s.number)}</div>
        ${s.label ? `<div${editAttr(editable, `stats.${idx}.label`)} style="font-family:${FONTS.body};font-size:12px;color:${bodyColour};line-height:17px;margin:0;">${escHtml(s.label)}</div>` : ""}
      </td>`).join("")}</tr></table>`
    : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:24px 32px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="${cardBg}" style="width:100%;background-color:${cardBg};border:1px solid ${DESIGN_TOKENS.border};border-radius:16px;">
    <tr><td style="padding:28px;">
      ${eyebrow ? `<div${editAttr(editable, "eyebrow")} style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:16px;margin:0 0 16px 0;">${eyebrow}</div>` : ""}
      ${whoRow}
      ${headline ? `<div${editAttr(editable, "headline")} style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;letter-spacing:-0.02em;color:${headingColour};line-height:${Math.round(headlineSize * (28 / 22))}px;margin:18px 0 0 0;">${headline}</div>` : ""}
      ${quote ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="margin:16px 0 0 0;"><tr>
        <td width="3" bgcolor="${DESIGN_TOKENS.accent}" style="width:3px;background-color:${DESIGN_TOKENS.accent};font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding:0 0 0 16px;">
          <div${editAttr(editable, "quote")}${richAttr(editable)} style="font-family:${FONTS.heading};font-size:16px;font-style:italic;font-weight:500;letter-spacing:-0.01em;color:${headingColour};line-height:24px;margin:0;">&ldquo;${quote}&rdquo;</div>
          ${attrName || attrRole ? `<div style="font-family:${FONTS.body};font-size:13px;color:${bodyColour};line-height:18px;margin:8px 0 0 0;">${attrName ? `<span${editAttr(editable, "attribution_name")} style="font-weight:600;color:${headingColour};">${attrName}</span>` : ""}${attrName && attrRole ? " &middot; " : ""}${attrRole ? `<span${editAttr(editable, "attribution_role")}>${attrRole}</span>` : ""}</div>` : ""}
        </td>
      </tr></table>` : ""}
      ${statsHtml}
      ${linkText && linkUrl ? `<div style="margin:20px 0 0 0;"><a href="${linkUrl}"${editAttr(editable, "link_text")} style="display:inline-block;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${DESIGN_TOKENS.primary};text-decoration:none;border-bottom:2px solid ${DESIGN_TOKENS.accent};padding-bottom:2px;line-height:20px;">${linkText} &rarr;</a></div>` : ""}
    </td></tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "customer-story",
  label: "Customer story",
  description: "A case-study card: customer name and meta, the result as a headline, an optional quote with attribution, up to three proof numbers and a link to the full story. stats is an array of { number, label }. Every name, quote and number must come from the brief — never invent a customer.",
  fields: [
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40, default: "Customer story" },
    { key: "client_name", label: "Customer / company name", type: "text", required: true, maxLength: 80 },
    { key: "client_meta", label: "Meta line (e.g. \"Independent agency, Bournemouth\")", type: "text", optional: true, maxLength: 80 },
    { key: "logo_url", label: "Logo or photo URL (optional, 44px square)", type: "url", optional: true },
    { key: "headline", label: "The result in one line", type: "text", optional: true, maxLength: 120 },
    { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "quote", label: "Quote (optional)", type: "longText", optional: true, maxLength: 400 },
    { key: "attribution_name", label: "Quote attribution: name", type: "text", optional: true, maxLength: 60 },
    { key: "attribution_role", label: "Quote attribution: role", type: "text", optional: true, maxLength: 80 },
    { key: "stats", label: "Proof numbers (up to 3)", type: "array", optional: true, max: 3, itemLabel: "stat", itemFields: [
      { key: "number", label: "Number (e.g. 3x, 40%, £12k)", type: "text", required: true, maxLength: 12 },
      { key: "label", label: "Label", type: "text", optional: true, maxLength: 60 },
    ]},
    { key: "link_text", label: "Link text (optional)", type: "text", optional: true, maxLength: 40 },
    { key: "link_url", label: "Link URL", type: "url", optional: true },
    { key: "heading_colour", label: "Heading colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "body_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Leave empty to keep the default." },
    { key: "background_colour", label: "Card tint colour", type: "colour", optional: true, defaultPreview: "#F8FAFC", placeholder: "Leave empty for light grey" },
  ],
  composerHints: {
    whenToUse: [
      "Nurture and B2B Weekly emails when the brief includes a real customer, their result and, ideally, a quote",
      "Before the closing CTA as the proof beat",
    ],
    whenNotToUse: [
      "No named customer in the brief — use nothing, not a placeholder",
      "Product launches that already carry a testimonial (one proof beat per email)",
    ],
  },
};

module.exports = { render, schema };

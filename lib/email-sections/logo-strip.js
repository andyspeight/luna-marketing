// lib/email-sections/logo-strip.js
//
// A row of logos with a small label: "Trusted by", "Works with", "Suppliers
// on the platform", "As seen at". The social-proof strip every B2B SaaS
// email has under the hero or above the final CTA.
//
// Props:
//   label        — small caps line above the logos (default "Trusted by")
//   logos        — array, max 6, of { image_url, alt, link_url }
//   size         — 'small' | 'medium' (default) | 'large' — caps the logo width
//   background_colour, label_colour
//
// Logos are sized by width so Outlook keeps their proportions (it honours
// the width attribute and scales height). Each logo gets an equal share of
// the row up to the size cap; the row scales down on mobile.

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback, safeHex, editAttr } = require("./_helpers");

const INNER_WIDTH = 536;
const GAP = 16;
const MAX_WIDTH = { small: 88, medium: 112, large: 140 };

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const logosRaw = Array.isArray(props.logos) ? props.logos : [];
  const logos = logosRaw
    .map((logo, idx) => ({ logo, idx, url: logo ? safeUrl(logo.image_url) : "" }))
    .filter((l) => l.url)
    .slice(0, 6);
  // `editable` is the section index when the builder renders (0 is valid).
  const isEditable = editable !== undefined && editable !== null && editable !== false;
  if (!logos.length && !isEditable) return "";

  const label = props.label !== undefined && props.label !== null ? escHtml(props.label) : "Trusted by";
  const sizeKey = MAX_WIDTH[props.size] ? props.size : "medium";
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;
  const labelColour = safeHex(props.label_colour) || DESIGN_TOKENS.textTertiary;

  const share = Math.floor((INNER_WIDTH - GAP * (logos.length - 1)) / logos.length);
  const logoWidth = Math.min(MAX_WIDTH[sizeKey], share);

  if (!logos.length) {
    // Builder-only placeholder so the block is visible before logos are
    // added. Never emitted on the send path.
    return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" align="center" style="background-color:${sectionBg};padding:28px 32px;text-align:center;">
  ${label ? `<div${editAttr(editable, "label")} style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${labelColour};line-height:16px;margin:0 0 14px 0;text-align:center;">${label}</div>` : ""}
  <div style="border:1px dashed ${DESIGN_TOKENS.border};border-radius:8px;padding:18px;font-family:${FONTS.body};font-size:12px;font-weight:600;color:${DESIGN_TOKENS.textTertiary};line-height:18px;">Add logos in the panel on the right</div>
</td></tr>`;
  }

  const cells = logos.map(({ logo, idx, url }) => {
    const alt = logo.alt ? escAttr(logo.alt) : "";
    const link = safeUrl(logo.link_url);
    const img = `<img src="${url}" alt="${alt}" width="${logoWidth}" class="tg-img-fluid" style="display:block;width:${logoWidth}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;">`;
    return `<td align="center" valign="middle" style="padding:0 ${Math.round(GAP / 2)}px;">${link ? `<a href="${link}" style="display:block;text-decoration:none;">${img}</a>` : img}</td>`;
  }).join("");

  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" align="center" style="background-color:${sectionBg};padding:28px 32px;text-align:center;">
  ${label ? `<div${editAttr(editable, "label")} style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${labelColour};line-height:16px;margin:0 0 18px 0;text-align:center;">${label}</div>` : ""}
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto;"><tr>${cells}</tr></table>
</td></tr>`;
}

const schema = {
  type: "logo-strip",
  label: "Logo strip",
  description: "A row of up to six logos under a small label: \"Trusted by\", \"Works with\", \"Suppliers on the platform\". logos is an array of { image_url, alt, link_url }. Only use logos the sender actually has the right to show — never invent clients or partners.",
  fields: [
    { key: "label", label: "Label (e.g. \"Trusted by\")", type: "text", optional: true, maxLength: 40, default: "Trusted by" },
    { key: "logos", label: "Logos (up to 6)", type: "array", required: true, max: 6, itemLabel: "logo", itemFields: [
      { key: "image_url", label: "Logo image URL", type: "url", required: true },
      { key: "alt", label: "Company name (alt text)", type: "text", optional: true, maxLength: 60 },
      { key: "link_url", label: "Link URL (optional)", type: "url", optional: true },
    ]},
    { key: "size", label: "Logo size (small | medium | large)", type: "select", options: ["small", "medium", "large"], default: "medium" },
    { key: "label_colour", label: "Label colour", type: "colour", optional: true, defaultPreview: "#94A3B8", help: "Leave empty to keep the default." },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "Social proof under the hero or just before the final CTA, when logo assets are provided in the brief or Asset Library",
      "Integration or supplier logos in a product launch",
    ],
    whenNotToUse: [
      "No logo URLs available — never fabricate a client list; leave the section out",
    ],
  },
};

module.exports = { render, schema };

// lib/email-sections/update-list.js
//
// "What's new" — a product update / changelog list. Each item carries a
// small tag (New, Improved, Fixed, Coming soon), a title, a one-liner and an
// optional link. The block for feature-release and monthly product-update
// emails. Sister to `feature-tiles` (icon tiles, evergreen features) and
// `numbered-list` (editorial, B2B Weekly).
//
// Props:
//   eyebrow (default "What's new"), title, intro
//   items — array of { tag, title, text, link_text, link_url }
//     tag: 'new' | 'improved' | 'fixed' | 'coming-soon' | '' (none)
//   heading_colour, body_colour, background_colour, title_size
//
// Outlook patterns used:
//   - Tags are inline spans with bgcolor-style padding (square corners in
//     Outlook, pills elsewhere)
//   - Rows separated by hairline borders, no <ul>

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont, safeHex, editAttr, richAttr, richInline } = require("./_helpers");

const TAG_LABELS = { new: "New", improved: "Improved", fixed: "Fixed", "coming-soon": "Coming soon" };

function tagStyle(tag, DESIGN_TOKENS) {
  switch (tag) {
    case "new": return { bg: DESIGN_TOKENS.accent, fg: DESIGN_TOKENS.textPrimary };
    case "improved": return { bg: DESIGN_TOKENS.primary, fg: "#FFFFFF" };
    case "fixed": return { bg: DESIGN_TOKENS.bgTertiary, fg: DESIGN_TOKENS.textSecondary };
    case "coming-soon": return { bg: "#FBE8C8", fg: "#B9740E" };
    default: return null;
  }
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const itemsRaw = Array.isArray(props.items) ? props.items : [];
  const items = itemsRaw
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item && (item.title || item.text));
  const eyebrow = props.eyebrow !== undefined && props.eyebrow !== null ? escHtml(props.eyebrow) : "What's new";
  const title = props.title ? escHtml(props.title) : "";
  const intro = props.intro ? richInline(props.intro) : "";
  if (!items.length && !title) return "";

  const titleSize = scaleFont(26, props.title_size);
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;

  const rows = items.map(({ item, idx }, i) => {
    const tagKey = TAG_LABELS[item.tag] ? item.tag : "";
    const tag = tagStyle(tagKey, DESIGN_TOKENS);
    const tagHtml = tag
      ? `<span style="display:inline-block;padding:3px 8px;background-color:${tag.bg};border-radius:999px;font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tag.fg};line-height:14px;margin:0 0 8px 0;">${TAG_LABELS[tagKey]}</span>`
      : "";
    const itemTitle = item.title ? escHtml(item.title) : "";
    const text = item.text ? richInline(item.text) : "";
    const linkText = item.link_text ? escHtml(item.link_text) : "";
    const linkUrl = safeUrl(item.link_url);
    const border = i === items.length - 1 ? "" : `border-bottom:1px solid ${DESIGN_TOKENS.borderLight};`;
    return `<tr><td style="padding:18px 0;${border}">
      ${tagHtml ? `<div>${tagHtml}</div>` : ""}
      ${itemTitle ? `<div${editAttr(editable, `items.${idx}.title`)} style="font-family:${FONTS.heading};font-size:17px;font-weight:700;letter-spacing:-0.015em;color:${headingColour};line-height:24px;margin:0 0 ${text ? 4 : 0}px 0;">${itemTitle}</div>` : ""}
      ${text ? `<div${editAttr(editable, `items.${idx}.text`)}${richAttr(editable)} style="font-family:${FONTS.body};font-size:14px;color:${bodyColour};line-height:22px;margin:0;">${text}</div>` : ""}
      ${linkText && linkUrl ? `<div style="margin:8px 0 0 0;"><a href="${linkUrl}"${editAttr(editable, `items.${idx}.link_text`)} style="font-family:${FONTS.body};font-size:13px;font-weight:600;color:${DESIGN_TOKENS.accentDark};text-decoration:none;line-height:18px;">${linkText} &rarr;</a></div>` : ""}
    </td></tr>`;
  }).join("");

  const headerHtml = (eyebrow || title || intro)
    ? `<div style="margin:0 0 ${items.length ? 6 : 0}px 0;">
      ${eyebrow ? `<div${editAttr(editable, "eyebrow")} style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:16px;margin:0 0 10px 0;">${eyebrow}</div>` : ""}
      ${title ? `<div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;color:${headingColour};line-height:${Math.round(titleSize * (32 / 26))}px;margin:0 0 ${intro ? 8 : 0}px 0;">${title}</div>` : ""}
      ${intro ? `<div${editAttr(editable, "intro")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:15px;color:${bodyColour};line-height:24px;margin:0;max-width:520px;">${intro}</div>` : ""}
    </div>`
    : "";

  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" style="background-color:${sectionBg};padding:36px 32px;">
  ${headerHtml}
  ${items.length ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${rows}</table>` : ""}
</td></tr>`;
}

const schema = {
  type: "update-list",
  label: "What's new (updates)",
  description: "Product update / changelog list. Each item has a tag (new | improved | fixed | coming-soon), a title, a one-line description and an optional link. items is an array of { tag, title, text, link_text, link_url }. For feature-release and monthly product-update emails; only list changes that are in the brief or Product Library.",
  fields: [
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40, default: "What's new" },
    { key: "title", label: "Section title", type: "text", optional: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "intro", label: "Intro line (optional)", type: "text", optional: true, maxLength: 200 },
    { key: "items", label: "Updates", type: "array", required: true, itemLabel: "update", itemFields: [
      { key: "tag", label: "Tag (new | improved | fixed | coming-soon)", type: "select", options: ["new", "improved", "fixed", "coming-soon"], optional: true },
      { key: "title", label: "Update title", type: "text", required: true, maxLength: 80 },
      { key: "text", label: "One-line description", type: "longText", optional: true, maxLength: 240 },
      { key: "link_text", label: "Link text (optional)", type: "text", optional: true, maxLength: 30 },
      { key: "link_url", label: "Link URL", type: "url", optional: true },
    ]},
    { key: "heading_colour", label: "Heading colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "body_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Leave empty to keep the default." },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "Feature-release and monthly product-update emails with two to six changes",
      "Tag honestly: 'coming-soon' for anything the Product Library marks as not yet launched",
    ],
    whenNotToUse: [
      "A single launch (use hero-dark + features-section or image-text rows)",
      "Evergreen feature lists (use feature-tiles)",
    ],
  },
};

module.exports = { render, schema };

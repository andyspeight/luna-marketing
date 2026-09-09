// lib/email-sections/faq.js
//
// Common questions: question in bold, answer underneath, hairline between
// items, optional link to the full FAQ. Onboarding, pre-demo and launch
// emails ("Will it work with my supplier?", "How long does setup take?").
//
// Props:
//   title (default "Common questions"), intro
//   items — array of { question, answer }; answers take inline markdown and
//           blank-line paragraphs
//   link_text, link_url — optional "See all questions" link
//   heading_colour, body_colour, background_colour, title_size
//
// Answers must come from the Product Library or the brief — the composer
// never invents policy, pricing or timelines.

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, renderBody, scaleFont, safeHex, editAttr, richAttr, richInline } = require("./_helpers");

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const items = (Array.isArray(props.items) ? props.items : [])
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item && item.question);
  const title = props.title !== undefined && props.title !== null ? escHtml(props.title) : "Common questions";
  const intro = props.intro ? richInline(props.intro) : "";
  if (!items.length) return "";

  const titleSize = scaleFont(22, props.title_size);
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;
  const linkText = props.link_text ? escHtml(props.link_text) : "";
  const linkUrl = safeUrl(props.link_url);

  const rows = items.map(({ item, idx }, i) => {
    const q = escHtml(item.question);
    const a = renderBody(item.answer || "");
    const border = i === items.length - 1 ? "" : `border-bottom:1px solid ${DESIGN_TOKENS.borderLight};`;
    return `<tr><td style="padding:16px 0;${border}">
      <div${editAttr(editable, `items.${idx}.question`)} style="font-family:${FONTS.heading};font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${headingColour};line-height:22px;margin:0 0 ${a ? 6 : 0}px 0;">${q}</div>
      ${a ? `<div${editAttr(editable, `items.${idx}.answer`)}${richAttr(editable)} style="font-family:${FONTS.body};font-size:14px;color:${bodyColour};line-height:22px;margin:0;">${a}</div>` : ""}
    </td></tr>`;
  }).join("");

  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" style="background-color:${sectionBg};padding:32px 32px;">
  ${title ? `<div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;color:${headingColour};line-height:${Math.round(titleSize * (28 / 22))}px;margin:0 0 ${intro ? 6 : 4}px 0;">${title}</div>` : ""}
  ${intro ? `<div${editAttr(editable, "intro")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:15px;color:${bodyColour};line-height:24px;margin:0 0 4px 0;max-width:520px;">${intro}</div>` : ""}
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${rows}</table>
  ${linkText && linkUrl ? `<div style="margin:16px 0 0 0;"><a href="${linkUrl}"${editAttr(editable, "link_text")} style="display:inline-block;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${DESIGN_TOKENS.primary};text-decoration:none;border-bottom:2px solid ${DESIGN_TOKENS.accent};padding-bottom:2px;line-height:20px;">${linkText} &rarr;</a></div>` : ""}
</td></tr>`;
}

const schema = {
  type: "faq",
  label: "FAQ",
  description: "Common questions with short answers, one under the other, plus an optional link to the full FAQ. items is an array of { question, answer }. Answers must come from the Product Library or the brief.",
  fields: [
    { key: "title", label: "Title", type: "text", optional: true, maxLength: 80, default: "Common questions" },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "intro", label: "Intro line (optional)", type: "text", optional: true, maxLength: 200 },
    { key: "items", label: "Questions", type: "array", required: true, itemLabel: "question", itemFields: [
      { key: "question", label: "Question", type: "text", required: true, maxLength: 120 },
      { key: "answer", label: "Answer", type: "longText", optional: true, maxLength: 600, help: "Blank line = paragraph. **bold**, *italic* and [text](url) work inline." },
    ]},
    { key: "link_text", label: "Link text (optional, e.g. \"See all questions\")", type: "text", optional: true, maxLength: 40 },
    { key: "link_url", label: "Link URL", type: "url", optional: true },
    { key: "heading_colour", label: "Heading colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "body_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Leave empty to keep the default." },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "Onboarding, pre-demo and launch emails with two to five questions the Product Library actually answers",
    ],
    whenNotToUse: [
      "Questions whose answers are not in the input — leave them out rather than guess",
      "Newsletters (an FAQ reads as support copy, not editorial)",
    ],
  },
};

module.exports = { render, schema };

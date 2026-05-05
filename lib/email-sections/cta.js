// lib/email-sections/cta.js
const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

function render(props = {}) {
  const headline = escHtml(fallback(props.headline, "Ready to get started?"));
  const body = props.body ? escHtml(props.body) : "";
  const ctaText = escHtml(fallback(props.ctaText, "Get in touch"));
  const ctaUrl = safeUrl(props.ctaUrl) || "https://travelgenix.io";

  const variant = ["tint", "solid", "plain"].includes(props.variant)
    ? props.variant
    : "tint";

  let bgColor, headlineColor, bodyColor, btnBg, btnColor;
  if (variant === "solid") {
    bgColor = BRAND.teal;
    headlineColor = BRAND.surface;
    bodyColor = BRAND.surface;
    btnBg = BRAND.surface;
    btnColor = BRAND.tealDeep;
  } else if (variant === "tint") {
    bgColor = BRAND.paper;
    headlineColor = BRAND.ink;
    bodyColor = BRAND.inkSoft;
    btnBg = BRAND.teal;
    btnColor = BRAND.surface;
  } else {
    bgColor = BRAND.surface;
    headlineColor = BRAND.ink;
    bodyColor = BRAND.inkSoft;
    btnBg = BRAND.teal;
    btnColor = BRAND.surface;
  }

  let inner = "";
  if (headline) {
    inner += `<div style="font-family:${FONTS.heading};font-size:24px;font-weight:700;color:${headlineColor};line-height:32px;text-align:center;margin:0 0 12px 0;">${headline}</div>`;
  }
  if (body) {
    inner += `<div style="font-family:${FONTS.body};font-size:15px;color:${bodyColor};line-height:24px;text-align:center;margin:0 0 24px 0;">${body}</div>`;
  } else {
    inner += `<div style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>`;
  }

  inner += `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" bgcolor="${btnBg}" style="background-color:${btnBg};border-radius:8px;">
<a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;font-family:${FONTS.body};font-size:15px;font-weight:600;color:${btnColor};text-decoration:none;border-radius:8px;">${ctaText}</a>
</td></tr></table>`;

  return `
<tr><td bgcolor="${bgColor}" class="tg-pad-mobile" align="center" style="background-color:${bgColor};padding:40px 32px;text-align:center;">${inner}</td></tr>`;
}

const schema = {
  type: "cta",
  label: "Call to action",
  description: "Big button with surrounding text",
  fields: [
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 80 },
    { key: "body", label: "Supporting copy", type: "longText", optional: true, maxLength: 200 },
    { key: "ctaText", label: "Button text", type: "text", required: true, maxLength: 40 },
    { key: "ctaUrl", label: "Button link", type: "url", required: true },
    { key: "variant", label: "Style", type: "select",
      options: ["tint", "solid", "plain"], default: "tint" },
  ],
};

module.exports = { render, schema };

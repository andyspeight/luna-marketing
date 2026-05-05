// lib/email-sections/hero.js
const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

function render(props = {}) {
  const headline = escHtml(fallback(props.headline, "Your headline here"));
  const subhead = props.subhead ? escHtml(props.subhead) : "";
  const ctaText = props.ctaText ? escHtml(props.ctaText) : "";
  const ctaUrl = safeUrl(props.ctaUrl);
  const imageUrl = safeUrl(props.imageUrl);
  const imageAlt = escHtml(props.imageAlt || "");

  const accent = props.accent === "pink" ? BRAND.pink
    : props.accent === "yellow" ? BRAND.yellow
    : props.accent === "none" ? null
    : BRAND.teal;

  let html = "";

  if (imageUrl) {
    html += `
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:0;font-size:0;line-height:0;">
<img src="${imageUrl}" alt="${imageAlt}" width="600" class="tg-img-fluid" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;">
</td></tr>`;
  }

  if (accent) {
    html += `
<tr><td bgcolor="${accent}" style="background-color:${accent};font-size:0;line-height:0;height:4px;">&nbsp;</td></tr>`;
  }

  html += `
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:32px 32px 16px 32px;">
<div class="tg-hero-headline" style="font-family:${FONTS.heading};font-size:32px;font-weight:700;color:${BRAND.ink};line-height:40px;margin:0;">${headline}</div>`;

  if (subhead) {
    html += `
<div class="tg-hero-subhead" style="font-family:${FONTS.body};font-size:17px;color:${BRAND.inkSoft};line-height:26px;margin:12px 0 0 0;">${subhead}</div>`;
  }
  html += `
</td></tr>`;

  if (ctaText && ctaUrl) {
    html += `
<tr><td bgcolor="${BRAND.surface}" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:16px 32px 32px 32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left"><tr><td align="left" bgcolor="${BRAND.teal}" style="background-color:${BRAND.teal};border-radius:8px;">
<a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;font-family:${FONTS.body};font-size:15px;font-weight:600;color:${BRAND.surface};text-decoration:none;border-radius:8px;">${ctaText}</a>
</td></tr></table>
</td></tr>`;
  } else {
    html += `
<tr><td bgcolor="${BRAND.surface}" style="background-color:${BRAND.surface};padding:0 32px 16px 32px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }

  return html;
}

const schema = {
  type: "hero",
  label: "Hero",
  description: "Large image with headline, subhead and primary CTA",
  fields: [
    { key: "imageUrl", label: "Hero image URL", type: "url", optional: true },
    { key: "imageAlt", label: "Image alt text", type: "text", optional: true },
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 120 },
    { key: "subhead", label: "Subhead", type: "longText", optional: true, maxLength: 280 },
    { key: "ctaText", label: "Button text", type: "text", optional: true, maxLength: 40 },
    { key: "ctaUrl", label: "Button link", type: "url", optional: true },
    { key: "accent", label: "Accent bar colour", type: "select", optional: true,
      options: ["teal", "pink", "yellow", "none"], default: "teal" },
  ],
};

module.exports = { render, schema };

// lib/email-sections/cta.js
// Big visual CTA block. Background tint, headline, supporting copy, button.

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

/**
 * Schema:
 *   headline: string
 *   body?: string
 *   ctaText: string
 *   ctaUrl: string
 *   variant?: 'tint' | 'solid' | 'plain'  (default 'tint')
 */
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
  } else { // plain
    bgColor = BRAND.surface;
    headlineColor = BRAND.ink;
    bodyColor = BRAND.inkSoft;
    btnBg = BRAND.teal;
    btnColor = BRAND.surface;
  }

  return `
    <mj-section background-color="${bgColor}" padding="40px 32px">
      <mj-column>
        <mj-text
          font-family="${FONTS.heading}"
          font-size="24px"
          font-weight="700"
          color="${headlineColor}"
          line-height="32px"
          align="center"
          padding="0 0 12px 0"
        >${headline}</mj-text>
        ${body ? `<mj-text
          font-family="${FONTS.body}"
          font-size="15px"
          color="${bodyColor}"
          line-height="24px"
          align="center"
          padding="0 0 24px 0"
        >${body}</mj-text>` : `<mj-spacer height="12px" />`}
        <mj-button
          href="${ctaUrl}"
          background-color="${btnBg}"
          color="${btnColor}"
          font-family="${FONTS.body}"
          font-size="15px"
          font-weight="600"
          inner-padding="14px 32px"
          border-radius="8px"
          align="center"
          padding="0"
        >${ctaText}</mj-button>
      </mj-column>
    </mj-section>`;
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

// lib/email-sections/hero.js
// Hero — large image, headline, subhead, CTA. The eye-catcher.

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

/**
 * Schema:
 *   imageUrl?: string
 *   imageAlt?: string
 *   headline: string
 *   subhead?: string
 *   ctaText?: string
 *   ctaUrl?: string
 *   accent?: 'teal' | 'pink' | 'yellow' | 'none'  (default 'teal')
 */
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

  // Image (full-width, no padding)
  if (imageUrl) {
    html += `
      <mj-section background-color="${BRAND.surface}" padding="0">
        <mj-column>
          <mj-image
            src="${imageUrl}"
            alt="${imageAlt}"
            width="600px"
            padding="0"
            fluid-on-mobile="true"
          />
        </mj-column>
      </mj-section>`;
  }

  // Accent bar
  if (accent) {
    html += `
      <mj-section background-color="${accent}" padding="0">
        <mj-column>
          <mj-spacer height="4px" />
        </mj-column>
      </mj-section>`;
  }

  // Headline + subhead block
  html += `
    <mj-section background-color="${BRAND.surface}" padding="32px 32px 16px 32px">
      <mj-column>
        <mj-text
          font-family="${FONTS.heading}"
          font-size="32px"
          font-weight="700"
          color="${BRAND.ink}"
          line-height="40px"
          align="left"
          padding="0 0 12px 0"
        >${headline}</mj-text>
        ${subhead ? `<mj-text
          font-family="${FONTS.body}"
          font-size="17px"
          color="${BRAND.inkSoft}"
          line-height="26px"
          align="left"
          padding="0"
        >${subhead}</mj-text>` : ""}
      </mj-column>
    </mj-section>`;

  // CTA button
  if (ctaText && ctaUrl) {
    html += `
      <mj-section background-color="${BRAND.surface}" padding="16px 32px 32px 32px">
        <mj-column>
          <mj-button
            href="${ctaUrl}"
            background-color="${BRAND.teal}"
            color="${BRAND.surface}"
            font-family="${FONTS.body}"
            font-size="15px"
            font-weight="600"
            inner-padding="14px 28px"
            border-radius="8px"
            align="left"
            padding="0"
          >${ctaText}</mj-button>
        </mj-column>
      </mj-section>`;
  } else if (!ctaText && !ctaUrl) {
    // Add bottom padding if no CTA so headline doesn't crash into next section
    html += `
      <mj-section background-color="${BRAND.surface}" padding="0 32px 16px 32px">
        <mj-column><mj-spacer height="0" /></mj-column>
      </mj-section>`;
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

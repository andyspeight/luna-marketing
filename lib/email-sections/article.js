// lib/email-sections/article.js
// Article — image one side, headline + body + read-more link other side.
// Stacks on mobile (image on top).

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl, renderBody, fallback } = require("./_helpers");

/**
 * Schema:
 *   imageUrl?: string
 *   imageAlt?: string
 *   imagePosition?: 'left' | 'right'  (default 'left')
 *   headline: string
 *   body: string
 *   linkText?: string
 *   linkUrl?: string
 */
function render(props = {}) {
  const imageUrl = safeUrl(props.imageUrl);
  const imageAlt = escHtml(props.imageAlt || "");
  const imageOnRight = props.imagePosition === "right";

  const headline = escHtml(fallback(props.headline, "Article headline"));
  const bodyHtml = renderBody(props.body || "");
  const linkText = props.linkText ? escHtml(props.linkText) : "";
  const linkUrl = safeUrl(props.linkUrl);

  // The text column
  const textColumn = `
    <mj-column width="${imageUrl ? "60%" : "100%"}" vertical-align="middle">
      <mj-text
        font-family="${FONTS.heading}"
        font-size="20px"
        font-weight="700"
        color="${BRAND.ink}"
        line-height="28px"
        padding="0 0 8px 0"
      >${headline}</mj-text>
      <mj-text
        font-family="${FONTS.body}"
        font-size="15px"
        color="${BRAND.inkSoft}"
        line-height="24px"
        padding="0 0 12px 0"
      >${bodyHtml}</mj-text>
      ${linkText && linkUrl ? `<mj-text
        font-family="${FONTS.body}"
        font-size="14px"
        font-weight="600"
        color="${BRAND.tealDeep}"
        line-height="22px"
        padding="0"
      ><a href="${linkUrl}" style="color:${BRAND.tealDeep};text-decoration:none;border-bottom:1px solid ${BRAND.tealDeep};padding-bottom:1px">${linkText} →</a></mj-text>` : ""}
    </mj-column>`;

  // The image column
  const imageColumn = imageUrl ? `
    <mj-column width="40%" vertical-align="middle">
      <mj-image
        src="${imageUrl}"
        alt="${imageAlt}"
        border-radius="8px"
        padding="0"
      />
    </mj-column>` : "";

  const columns = imageOnRight
    ? `${textColumn}${imageColumn}`
    : `${imageColumn}${textColumn}`;

  return `
    <mj-section background-color="${BRAND.surface}" padding="20px 32px">
      ${columns}
    </mj-section>`;
}

const schema = {
  type: "article",
  label: "Article",
  description: "Image and text side by side, stacks on mobile",
  fields: [
    { key: "imageUrl", label: "Image URL", type: "url", optional: true },
    { key: "imageAlt", label: "Image alt text", type: "text", optional: true },
    { key: "imagePosition", label: "Image position", type: "select",
      options: ["left", "right"], default: "left" },
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 100 },
    { key: "body", label: "Body", type: "longText", required: true, maxLength: 500 },
    { key: "linkText", label: "Read-more link text", type: "text", optional: true, maxLength: 40 },
    { key: "linkUrl", label: "Read-more link URL", type: "url", optional: true },
  ],
};

module.exports = { render, schema };

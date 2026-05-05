// lib/email-sections/two-column.js
// Two side-by-side blocks. Each has an icon/image, headline, body, optional link.
// Stacks on mobile.

const { BRAND, FONTS } = require("../email-brand");
const { escHtml, safeUrl, renderBody, fallback } = require("./_helpers");

/**
 * Schema:
 *   left: { imageUrl?, imageAlt?, headline, body, linkText?, linkUrl? }
 *   right: { imageUrl?, imageAlt?, headline, body, linkText?, linkUrl? }
 */
function render(props = {}) {
  const left = props.left || {};
  const right = props.right || {};

  function renderColumn(col) {
    const imageUrl = safeUrl(col.imageUrl);
    const imageAlt = escHtml(col.imageAlt || "");
    const headline = escHtml(fallback(col.headline, ""));
    const bodyHtml = renderBody(col.body || "");
    const linkText = col.linkText ? escHtml(col.linkText) : "";
    const linkUrl = safeUrl(col.linkUrl);

    return `
      <mj-column width="50%" vertical-align="top">
        ${imageUrl ? `<mj-image
          src="${imageUrl}"
          alt="${imageAlt}"
          width="200px"
          padding="0 0 16px 0"
          align="left"
          border-radius="6px"
        />` : ""}
        ${headline ? `<mj-text
          font-family="${FONTS.heading}"
          font-size="17px"
          font-weight="700"
          color="${BRAND.ink}"
          line-height="24px"
          padding="0 0 8px 0"
        >${headline}</mj-text>` : ""}
        ${bodyHtml ? `<mj-text
          font-family="${FONTS.body}"
          font-size="14px"
          color="${BRAND.inkSoft}"
          line-height="22px"
          padding="0 0 8px 0"
        >${bodyHtml}</mj-text>` : ""}
        ${linkText && linkUrl ? `<mj-text
          font-family="${FONTS.body}"
          font-size="13px"
          font-weight="600"
          color="${BRAND.tealDeep}"
          line-height="20px"
          padding="0"
        ><a href="${linkUrl}" style="color:${BRAND.tealDeep};text-decoration:none">${linkText} →</a></mj-text>` : ""}
      </mj-column>`;
  }

  return `
    <mj-section background-color="${BRAND.surface}" padding="20px 32px">
      ${renderColumn(left)}
      ${renderColumn(right)}
    </mj-section>`;
}

const columnFields = [
  { key: "imageUrl", label: "Image URL", type: "url", optional: true },
  { key: "imageAlt", label: "Image alt", type: "text", optional: true },
  { key: "headline", label: "Headline", type: "text", required: true, maxLength: 60 },
  { key: "body", label: "Body", type: "longText", required: true, maxLength: 280 },
  { key: "linkText", label: "Link text", type: "text", optional: true, maxLength: 30 },
  { key: "linkUrl", label: "Link URL", type: "url", optional: true },
];

const schema = {
  type: "two-column",
  label: "Two columns",
  description: "Side-by-side blocks, stacks on mobile",
  fields: [
    { key: "left", label: "Left column", type: "object", fields: columnFields },
    { key: "right", label: "Right column", type: "object", fields: columnFields },
  ],
};

module.exports = { render, schema };

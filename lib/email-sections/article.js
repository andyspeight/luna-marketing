// lib/email-sections/article.js
//
// Legacy "article" row: headline, body, read-more link, image left or
// right. The seeded Newsletter template uses it (imagePosition alternating
// left / right, linkText / linkUrl).
//
// Until September 2026 this file was a verbatim copy of hero.js, so
// imagePosition and the link were ignored and every article rendered as a
// full-width hero. It now maps its camelCase props onto the maintained
// image-text renderer, which is the same layout done properly (Outlook-safe
// split, stacks with the image on top on mobile). Kept for saved emails and
// the templates; new emails should use image-text directly.

const imageText = require("./image-text");

// Builder inline edits write image-text keys (cta_text etc.) back onto the
// section, so a snake_case value wins when present and the legacy camelCase
// prop is the fallback.
function pickProp(props, snake, camel) {
  if (props[snake] !== undefined && props[snake] !== null && props[snake] !== "") return props[snake];
  return props[camel];
}

function render(props = {}, brand, editable) {
  const mapped = Object.assign({}, props, {
    image_url: pickProp(props, "image_url", "imageUrl"),
    image_alt: pickProp(props, "image_alt", "imageAlt"),
    image_position: pickProp(props, "image_position", "imagePosition") === "right" ? "right" : "left",
    image_width: props.image_width || "medium",
    headline: props.headline,
    body: props.body,
    cta_text: pickProp(props, "cta_text", "linkText"),
    cta_url: pickProp(props, "cta_url", "linkUrl"),
    cta_style: props.cta_style || "link",
  });
  // Point the on-canvas edit hook for the link at the legacy prop name so
  // the inspector field and inline editing stay on the same value.
  return imageText.render(mapped, brand, editable).replace(/(data-tg-edit="[^":]*:)cta_text"/g, '$1linkText"');
}

const schema = {
  type: "article",
  label: "Article (legacy)",
  description: "Older article row: headline, body, read-more link and an image on the left or right. Kept for saved emails and the seeded Newsletter template. For new emails use image-text, which has the same layout with more options.",
  fields: [
    { key: "imageUrl", label: "Image URL", type: "url", optional: true },
    { key: "imageAlt", label: "Image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "imagePosition", label: "Image position (left | right)", type: "select", options: ["left", "right"], default: "left" },
    { key: "headline", label: "Headline", type: "text", optional: true, maxLength: 100 },
    { key: "body", label: "Body", type: "longText", optional: true, maxLength: 1200 },
    { key: "linkText", label: "Link text", type: "text", optional: true, maxLength: 40 },
    { key: "linkUrl", label: "Link URL", type: "url", optional: true },
  ],
  composerHints: {
    whenNotToUse: ["Always prefer image-text — article only exists for older emails and templates."],
  },
};

module.exports = { render, schema };

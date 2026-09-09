// lib/email-sections/image-text.js
//
// Image + text, side by side. An image on the left with text on the right,
// or the mirror image. Every text slot is optional (eyebrow, headline,
// subhead, body, CTA), so the same block works as a picture with a
// headline, a thumbnail beside a paragraph, or a full product / destination
// row with a button. Stack several with alternating image_position for a
// zig-zag of feature rows.
//
// Sister sections:
//   - `two-column`: two equal text columns (each with an optional image on top)
//   - `feature-story`: image above the text inside a card
//   - `image`: an image on its own
//
// What it accepts:
//   image_url         — image (optional; without one the text runs full width)
//   image_alt         — alt text
//   image_link_url    — optional link wrapping the image
//   image_position    — 'left' (default) | 'right'
//   image_width       — 'small' (152px thumbnail) | 'medium' (216px, default) | 'half' (50/50)
//   vertical_align    — 'middle' (default) | 'top'
//   rounded           — boolean, 8px image corners (default true)
//   eyebrow           — small uppercase label above the headline
//   headline          — bold heading
//   subhead           — supporting line under the headline
//   body              — paragraphs (blank line = new paragraph; **bold**, *italic*, [text](url))
//   cta_text, cta_url — optional call to action
//   cta_style         — 'link' (default, text link with an accent underline) | 'button'
//   variant           — 'plain' (default) | 'card' (tinted card with border and rounded corners)
//   spacing           — 'compact' | 'normal' (default) | 'roomy' — vertical padding
//   background_colour — section background (default white)
//   eyebrow_colour, heading_colour, body_colour, cta_colour, cta_text_colour
//   eyebrow_size, headline_size, subhead_size, body_size — fontSize presets
//
// Layout (desktop, image_position 'left'):
//   [ image 216px ] [24px] [ eyebrow / headline / subhead / body / CTA ]
//
// Mobile (<=480px): the two cells stack with the image on top whichever
// side it sits on desktop. For 'right' the table is rendered dir="rtl" with
// dir="ltr" cells, so the image stays first in source order (the standard
// reverse-stack technique — Outlook honours dir on tables). 'small'
// thumbnails stay side by side on mobile, digest-row style.
//
// Outlook patterns used:
//   - Table-based split with explicit cell widths (no flex/grid)
//   - P2 bulletproof CTA when cta_style is 'button'
//   - bgcolor attributes back every CSS background
//   - No positioned elements (Gmail strips position/transform)

const STATIC_BRAND = require("../email-brand");
const {
  escHtml, escAttr, safeUrl, fallback, renderBody, scaleFont, safeHex,
  editAttr, richAttr, richInline,
} = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

// 600px email minus 32px padding either side.
const INNER_WIDTH = 536;
const CARD_PADDING = 20;
const GAP = 24;
const IMAGE_WIDTHS = { small: 152, medium: 216 };
const SPACING = { compact: 12, normal: 24, roomy: 40 };

function pick(value, allowed, fallbackValue) {
  return allowed.includes(value) ? value : fallbackValue;
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const imageUrl = safeUrl(props.image_url);
  const imageAlt = props.image_alt ? escAttr(props.image_alt) : "";
  const imageLink = safeUrl(props.image_link_url);
  const position = pick(props.image_position, ["left", "right"], "left");
  const widthKey = pick(props.image_width, ["small", "medium", "half"], "medium");
  const valign = pick(props.vertical_align, ["top", "middle"], "middle");
  const rounded = props.rounded !== false;
  const variant = pick(props.variant, ["plain", "card"], "plain");
  const spacingKey = pick(props.spacing, ["compact", "normal", "roomy"], "normal");
  const ctaStyle = pick(props.cta_style, ["link", "button"], "link");

  const eyebrow = props.eyebrow ? escHtml(props.eyebrow) : "";
  const headline = props.headline ? escHtml(props.headline) : "";
  const subhead = props.subhead ? richInline(props.subhead) : "";
  const bodyHtml = renderBody(props.body || "");
  const ctaText = props.cta_text ? escHtml(props.cta_text) : "";
  const ctaUrl = safeUrl(props.cta_url);

  // `editable` is the section index when the builder renders (0 is a valid
  // index), so test for presence rather than truthiness.
  const isEditable = editable !== undefined && editable !== null && editable !== false;

  const hasText = !!(eyebrow || headline || subhead || bodyHtml || (ctaText && ctaUrl));
  if (!imageUrl && !hasText && !isEditable) return "";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const eyebrowSize = scaleFont(11, props.eyebrow_size);
  const headlineSize = scaleFont(22, props.headline_size);
  const subheadSize = scaleFont(15, props.subhead_size);
  const bodySize = scaleFont(15, props.body_size);

  // Colours. Defaults come from the design tokens (so client brand kits
  // theme the accent); each can be overridden with a strict hex.
  const eyebrowColour = safeHex(props.eyebrow_colour) || DESIGN_TOKENS.accent;
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const ctaBg = safeHex(props.cta_colour) || DESIGN_TOKENS.accent;
  const ctaFg = safeHex(props.cta_text_colour) || DESIGN_TOKENS.textPrimary;
  const linkColour = safeHex(props.cta_text_colour) || DESIGN_TOKENS.primary;
  const linkUnderline = safeHex(props.cta_colour) || DESIGN_TOKENS.accent;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;

  // Column maths. The card variant loses its inner padding on both sides.
  const available = variant === "card" ? INNER_WIDTH - CARD_PADDING * 2 : INNER_WIDTH;
  const imageWidth = widthKey === "half" ? Math.floor((available - GAP) / 2) : IMAGE_WIDTHS[widthKey];
  const textWidth = available - imageWidth - GAP;

  // ── Text stack ─────────────────────────────────────────────────────
  let text = "";
  if (eyebrow) {
    text += `<div${editAttr(editable, "eyebrow")} style="font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${eyebrowColour};line-height:${Math.round(eyebrowSize * (16 / 11))}px;text-align:left;margin:0 0 8px 0;">${eyebrow}</div>`;
  }
  if (headline) {
    text += `<div${editAttr(editable, "headline")} style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;letter-spacing:-0.02em;color:${headingColour};line-height:${Math.round(headlineSize * (28 / 22))}px;text-align:left;margin:0 0 8px 0;">${headline}</div>`;
  }
  if (subhead) {
    text += `<div${editAttr(editable, "subhead")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:${subheadSize}px;font-weight:500;color:${bodyColour};line-height:${Math.round(subheadSize * (22 / 15))}px;text-align:left;margin:0 0 10px 0;">${subhead}</div>`;
  }
  if (bodyHtml) {
    text += `<div${editAttr(editable, "body")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:${bodySize}px;font-weight:400;color:${bodyColour};line-height:${Math.round(bodySize * (24 / 15))}px;text-align:left;margin:0;">${bodyHtml}</div>`;
  }
  if (ctaText && ctaUrl) {
    if (ctaStyle === "button") {
      text += `<div style="margin:${bodyHtml || subhead || headline ? 18 : 0}px 0 0 0;">${bulletproofCta({
        text: ctaText,
        url: ctaUrl,
        bgColor: ctaBg,
        textColor: ctaFg,
        align: "left",
        fontSize: 14,
        paddingY: 12,
        paddingX: 22,
        height: 42,
        width: 180,
        attrs: editAttr(editable, "cta_text"),
      })}</div>`;
    } else {
      text += `<div style="margin:${bodyHtml || subhead || headline ? 14 : 0}px 0 0 0;"><a href="${ctaUrl}"${editAttr(editable, "cta_text")} style="display:inline-block;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${linkColour};text-decoration:none;border-bottom:2px solid ${linkUnderline};padding-bottom:2px;line-height:20px;">${ctaText} &rarr;</a></div>`;
    }
  }

  // ── Image cell ─────────────────────────────────────────────────────
  const radius = rounded ? "8px" : "0";
  let media = "";
  if (imageUrl) {
    const img = `<img src="${imageUrl}" alt="${imageAlt}" width="${imageWidth}" class="tg-img-fluid" style="display:block;width:100%;max-width:${imageWidth}px;height:auto;border:0;border-radius:${radius};outline:none;text-decoration:none;">`;
    media = imageLink
      ? `<a href="${imageLink}" style="display:block;text-decoration:none;">${img}</a>`
      : img;
  } else if (isEditable) {
    // Builder-only placeholder so the split layout is visible before an
    // image has been chosen. Never emitted on the send path.
    const phHeight = Math.round(imageWidth * 0.72);
    media = `<div style="width:100%;max-width:${imageWidth}px;height:${phHeight}px;background-color:${DESIGN_TOKENS.bgTertiary};border:1px dashed ${DESIGN_TOKENS.border};border-radius:${radius};box-sizing:border-box;font-family:${FONTS.body};font-size:12px;font-weight:600;color:${DESIGN_TOKENS.textTertiary};text-align:center;line-height:${phHeight - 2}px;">Add an image</div>`;
  }

  // ── Assemble the split ─────────────────────────────────────────────
  let inner;
  if (!media) {
    // No image: text runs the full width.
    inner = text;
  } else if (!hasText && !isEditable) {
    // Image only: honour the chosen side.
    inner = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td align="${position}" style="padding:0;">${media}</td></tr></table>`;
  } else {
    const isRight = position === "right";
    const stacks = widthKey !== "small";
    const mediaClass = stacks ? ` class="tg-split-media"` : "";
    const textClass = stacks ? ` class="tg-split-text"` : "";
    const mediaPad = isRight ? `0 0 0 ${GAP}px` : `0 ${GAP}px 0 0`;
    const textCell = `<td dir="ltr"${textClass} width="${textWidth}" valign="${valign}" style="width:${textWidth}px;vertical-align:${valign};padding:0;">${text || (isEditable ? `<div style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textTertiary};line-height:20px;">Add a headline or some text in the panel on the right.</div>` : "")}</td>`;
    const mediaCell = `<td dir="ltr"${mediaClass} width="${imageWidth}" valign="${valign}" style="width:${imageWidth}px;vertical-align:${valign};padding:${mediaPad};">${media}</td>`;
    // Image first in source order in both layouts so it stacks on top on
    // mobile; dir="rtl" on the table paints it on the right for 'right'.
    inner = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" dir="${isRight ? "rtl" : "ltr"}" style="width:100%;"><tr>${mediaCell}${textCell}</tr></table>`;
  }

  if (variant === "card") {
    inner = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="${DESIGN_TOKENS.bgSecondary}" style="width:100%;background-color:${DESIGN_TOKENS.bgSecondary};border:1px solid ${DESIGN_TOKENS.border};border-radius:12px;"><tr><td style="padding:${CARD_PADDING}px;">${inner}</td></tr></table>`;
  }

  const pad = SPACING[spacingKey];
  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" style="background-color:${sectionBg};padding:${pad}px 32px;">${inner}</td></tr>`;
}

const schema = {
  type: "image-text",
  label: "Image + text",
  description: "Image on one side, text on the other. Every text slot is optional (eyebrow, headline, subhead, body, CTA), so it works as a picture with a headline, a thumbnail beside a paragraph, or a product / destination row with a button. Set image_position to 'left' or 'right'; alternate down the email for a zig-zag. Stacks with the image on top on mobile.",
  fields: [
    { key: "image_url", label: "Image URL", type: "url", optional: true },
    { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "image_link_url", label: "Image link URL (optional)", type: "url", optional: true },
    { key: "image_position", label: "Image position (left | right)", type: "select", options: ["left", "right"], default: "left" },
    { key: "image_width", label: "Image width (small thumbnail | medium | half)", type: "select", options: ["small", "medium", "half"], default: "medium" },
    { key: "vertical_align", label: "Vertical alignment (middle | top)", type: "select", options: ["middle", "top"], default: "middle" },
    { key: "rounded", label: "Rounded image corners", type: "boolean", optional: true, checkboxLabel: "Round the image corners" },
    { key: "eyebrow", label: "Eyebrow label (small caps above the headline)", type: "text", optional: true, maxLength: 40 },
    { key: "eyebrow_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "eyebrow_colour", label: "Eyebrow colour", type: "colour", optional: true, defaultPreview: "#00B4D8", help: "Leave empty to keep the default." },
    { key: "headline", label: "Headline", type: "text", optional: true, maxLength: 100 },
    { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "heading_colour", label: "Headline colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "subhead", label: "Subhead", type: "text", optional: true, maxLength: 160 },
    { key: "subhead_size", label: "Subhead text size", type: "fontSize", optional: true },
    { key: "body", label: "Body (blank line between paragraphs)", type: "longText", optional: true, maxLength: 1200, help: "**bold**, *italic* and [text](url) work inline." },
    { key: "body_size", label: "Body text size", type: "fontSize", optional: true },
    { key: "body_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Applies to the subhead and body. Leave empty to keep the default." },
    { key: "cta_text", label: "CTA text (optional)", type: "text", optional: true, maxLength: 40 },
    { key: "cta_url", label: "CTA link", type: "url", optional: true },
    { key: "cta_style", label: "CTA style (link | button)", type: "select", options: ["link", "button"], default: "link" },
    { key: "cta_colour", label: "Button colour / link underline", type: "colour", optional: true, defaultPreview: "#00B4D8", help: "Background of the button, or the underline of the text link. Leave empty to keep the default." },
    { key: "cta_text_colour", label: "Button text / link colour", type: "colour", optional: true, defaultPreview: "#1B2B5B", help: "Leave empty to keep the default." },
    { key: "variant", label: "Style (plain | card)", type: "select", options: ["plain", "card"], default: "plain" },
    { key: "spacing", label: "Vertical spacing (compact | normal | roomy)", type: "select", options: ["compact", "normal", "roomy"], default: "normal" },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white", help: "Tint the whole section. Leave empty for white." },
  ],
  composerHints: {
    whenToUse: [
      "A product, feature, hotel or destination that has (or will get) a matching image plus a short explanation",
      "Two or three feature rows in a row: alternate image_position left / right for a zig-zag",
      "Digest rows: image_width 'small' with a headline and one line of body",
    ],
    whenNotToUse: [
      "The image is the whole message (use image or generated-image)",
      "There is no image and none is planned (use text)",
      "The opening hero of the email (use hero-image, hero-coloured or hero-dark)",
    ],
  },
};

module.exports = { render, schema };

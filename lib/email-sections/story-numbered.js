// lib/email-sections/story-numbered.js
//
// A numbered story block — the "01 | WE REBRANDED" pattern from
// Writesonic / Morning Brew / The Hustle. Sister to `feature-story`
// (untinted, link-only) and `text` (headline+body, no eyebrow).
//
// Use this when you want a sequence of stories in one email with clear
// numbered chapters. Each story optionally renders a tinted background
// card (for the "feature card" treatment in marketing newsletters) and
// optionally embeds an image + CTA button.
//
// What it accepts:
//   number_label      — e.g. "01" (rendered separately from eyebrow)
//   eyebrow_label     — e.g. "WE REBRANDED" (uppercased small caps)
//   headline          — story H2
//   body              — long text. Double newlines split paragraphs.
//   image_url         — optional image above the body (no, between
//                       headline and body — see render)
//   image_alt         — optional alt text for image
//   cta_text          — optional button text
//   cta_url           — optional button URL
//   background_colour — optional tint behind the card (defaults transparent)
//   accent_colour     — colour of the number + eyebrow separator
//                       (defaults to brand primary)
//
// Layout (top-to-bottom inside the card):
//   [number] [|] [EYEBROW LABEL]
//   Headline
//   Body paragraphs
//   [optional image, full-width]
//   [optional CTA button]
//
// Outlook patterns used:
//   - Table-based, bgcolor + style for fallback
//   - Image uses width attribute + max-width style for fluid behaviour

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback, scaleFont, safeHex, editAttr } = require("./_helpers");

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  // Colour resolution. background_colour defaults to empty (transparent),
  // accent_colour defaults to brand primary.
  const bgColour = safeHex(props.background_colour);  // may be null = no fill
  const accent = safeHex(props.accent_colour) || DESIGN_TOKENS.primary || "#1B2B5B";

  const numberLabel = props.number_label ? escHtml(props.number_label) : "";
  const eyebrowLabel = props.eyebrow_label ? escHtml(props.eyebrow_label) : "";
  const headline = escHtml(fallback(props.headline, "Section heading"));
  const body = String(props.body || "");

  const imageUrl = safeUrl(props.image_url);
  const imageAlt = props.image_alt ? escAttr(props.image_alt) : "";

  const ctaText = props.cta_text ? escHtml(props.cta_text) : "";
  const ctaUrl = safeUrl(props.cta_url);

  // Button colours. Default to the resolved accent colour (which colours
  // both the number label and the button); cta_colour/cta_text_colour
  // override only the button.
  const ctaBg = safeHex(props.cta_colour) || accent;
  const ctaFg = safeHex(props.cta_text_colour) || "#FFFFFF";

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const eyebrowSize = scaleFont(11, props.eyebrow_label_size);
  const headlineSize = scaleFont(22, props.headline_size);
  const bodySize = scaleFont(15, props.body_size);

  // Body paragraphs — split on blank lines so users can write naturally.
  // Single newlines within a paragraph become spaces (typical email
  // rendering convention).
  const bodyParagraphsHtml = body
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="font-family:${FONTS.body};font-size:${bodySize}px;color:${DESIGN_TOKENS.textPrimary};line-height:1.65;margin:0 0 14px 0;">${escHtml(p).replace(/\r?\n/g, " ")}</p>`)
    .join("");

  // Number + separator + eyebrow row. Render only if at least one is set.
  let eyebrowRowHtml = "";
  if (numberLabel || eyebrowLabel) {
    const sepHtml = (numberLabel && eyebrowLabel)
      ? `<span style="color:${DESIGN_TOKENS.textTertiary};margin:0 10px;">|</span>`
      : "";
    eyebrowRowHtml = `
    <div style="font-family:${FONTS.body};font-size:${eyebrowSize}px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;line-height:${Math.round(eyebrowSize * (16 / 11))}px;margin:0 0 14px 0;">
      ${numberLabel ? `<span${editAttr(editable, "number_label")} style="color:${accent};">${numberLabel}</span>` : ""}
      ${sepHtml}
      ${eyebrowLabel ? `<span${editAttr(editable, "eyebrow_label")} style="color:${DESIGN_TOKENS.textSecondary};">${eyebrowLabel}</span>` : ""}
    </div>`;
  }

  // Image row — full-width with rounded corners. Width is 528 (600 email
  // width minus 36px padding each side); max-width 100% lets mobile
  // gracefully scale.
  let imageRowHtml = "";
  if (imageUrl) {
    imageRowHtml = `
    <div style="margin:18px 0 0 0;">
      <img src="${imageUrl}" alt="${imageAlt}" width="528" class="tg-img-fluid" style="display:block;width:100%;max-width:528px;height:auto;border:0;border-radius:8px;outline:none;text-decoration:none;">
    </div>`;
  }

  // CTA button — same style as hero-coloured CTA so they feel consistent.
  let ctaRowHtml = "";
  if (ctaText && ctaUrl) {
    ctaRowHtml = `
    <div style="margin:20px 0 0 0;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td bgcolor="${ctaBg}" style="background-color:${ctaBg};border-radius:6px;mso-padding-alt:12px 22px;">
            <a href="${ctaUrl}"${editAttr(editable, "cta_text")} style="display:inline-block;padding:12px 22px;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${ctaFg};text-decoration:none;border-radius:6px;line-height:1;">${ctaText}</a>
          </td>
        </tr>
      </table>
    </div>`;
  }

  // Outer cell — bgcolor only if explicitly set, else inherit from body.
  // Internal padding generous (36/40) so coloured cards have breathing room.
  const outerBg = bgColour ? `bgcolor="${bgColour}"` : "";
  const outerStyle = bgColour
    ? `background-color:${bgColour};padding:32px 36px;`
    : `padding:24px 36px;`;

  return `
<tr><td ${outerBg} class="tg-pad-mobile" style="${outerStyle}">
  ${eyebrowRowHtml}
  <h2${editAttr(editable, "headline")} style="font-family:${FONTS.heading};font-size:${headlineSize}px;font-weight:700;letter-spacing:-0.015em;line-height:1.25;color:${DESIGN_TOKENS.textPrimary};margin:0 0 14px 0;">${headline}</h2>
  ${bodyParagraphsHtml ? `<div${editAttr(editable, "body")}>${bodyParagraphsHtml}</div>` : ""}
  ${imageRowHtml}
  ${ctaRowHtml}
</td></tr>`;
}

const schema = {
  type: "story-numbered",
  label: "Story (numbered)",
  description: "Numbered story block (e.g. \"01 | WE REBRANDED\") with headline, body paragraphs, optional image and CTA. Optional tinted background for feature cards. Build multiple in sequence for digest-style newsletters.",
  fields: [
    { key: "number_label", label: "Number / chapter label (e.g. \"01\")", type: "text", optional: true, maxLength: 8 },
    { key: "eyebrow_label", label: "Eyebrow text (e.g. \"WE REBRANDED\")", type: "text", optional: true, maxLength: 60 },
    { key: "eyebrow_label_size", label: "Eyebrow text size", type: "fontSize", optional: true },
    { key: "headline", label: "Headline", type: "text", required: true, maxLength: 120 },
    { key: "headline_size", label: "Headline text size", type: "fontSize", optional: true },
    { key: "body", label: "Body (blank line between paragraphs)", type: "longText", required: true, maxLength: 3000 },
    { key: "body_size", label: "Body text size", type: "fontSize", optional: true },
    { key: "image_url", label: "Image URL (optional)", type: "url", optional: true },
    { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 120 },
    { key: "cta_text", label: "CTA button text (optional)", type: "text", optional: true, maxLength: 40 },
    { key: "cta_url", label: "CTA button URL", type: "url", optional: true },
    { key: "cta_colour", label: "Button colour", type: "colour", optional: true, defaultPreview: "#1B2B5B", placeholder: "Defaults to current button colour", help: "Background colour of the button. Leave empty to keep the default." },
    { key: "cta_text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Defaults to current label colour", help: "Colour of the button label. Leave empty to keep the default." },
    { key: "background_colour", label: "Background tint colour (optional)", type: "colour", optional: true, defaultPreview: "#FFF7ED", placeholder: "Leave empty for no tint", help: "Apply a tinted background for feature-card treatment. Leave empty for plain stories." },
    { key: "accent_colour", label: "Accent colour (number + button)", type: "colour", optional: true, defaultPreview: "#1B2B5B", placeholder: "Leave empty to use brand primary", help: "Colour of the number label and CTA button. Defaults to your brand primary." },
  ],
};

module.exports = { render, schema };

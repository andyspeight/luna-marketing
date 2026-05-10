// lib/email-sections/feature-story.js
// Archetype B (Marketing Newsletter): featured article block.
// Eyebrow + section title + lede, then a card with image, body title,
// excerpt and "Read the full piece →" link.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.2.

const { DESIGN_TOKENS, FONTS } = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

function render(props = {}) {
  const eyebrow = escHtml(fallback(props.eyebrow, "Feature"));
  const title = escHtml(fallback(props.title, "Worth your attention"));
  const lede = props.lede ? escHtml(props.lede) : "";
  const imageUrl = safeUrl(props.image_url);
  const imageAlt = escHtml(fallback(props.image_alt, ""));
  const bodyTitle = escHtml(fallback(props.body_title, "Read more"));
  const excerpt = props.excerpt ? escHtml(props.excerpt) : "";
  const linkText = props.link && props.link.text ? escHtml(props.link.text) : "Read the full piece";
  const linkUrl = props.link && props.link.url ? safeUrl(props.link.url) : "";

  // Image cell — bare image. The card has a 1px border and rounded corners
  // (which Outlook will render square; acceptable per §12 P6).
  const imageHtml = imageUrl
    ? `<tr><td style="padding:0;font-size:0;line-height:0;">
         <img src="${imageUrl}" alt="${imageAlt}" width="600" height="240" style="display:block;width:100%;max-width:600px;height:240px;object-fit:cover;border:0;outline:none;text-decoration:none;"/>
       </td></tr>`
    : "";

  // The "Read the full piece →" link uses a coloured underline rather than
  // a button — it's a "continue reading" affordance, not a CTA.
  const linkHtml = linkUrl
    ? `<a href="${linkUrl}" style="display:inline-block;font-family:${FONTS.body};font-size:14px;font-weight:600;color:${DESIGN_TOKENS.accent};text-decoration:none;letter-spacing:-0.005em;">${linkText} <span style="display:inline-block;">&rarr;</span></a>`
    : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:56px 32px 16px;">
  <div style="font-family:${FONTS.body};font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};margin:0 0 12px 0;line-height:18px;">${eyebrow}</div>
  <div style="font-family:${FONTS.heading};font-size:26px;font-weight:700;line-height:32px;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};margin:0 0 8px 0;">${title}</div>
  ${lede ? `<div style="font-family:${FONTS.body};font-size:15px;line-height:24px;color:${DESIGN_TOKENS.textSecondary};margin:0 0 32px 0;max-width:520px;">${lede}</div>` : `<div style="height:32px;line-height:32px;font-size:32px;">&nbsp;</div>`}
</td></tr>

<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:0 32px 40px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${DESIGN_TOKENS.bgSecondary}" style="background-color:${DESIGN_TOKENS.bgSecondary};border:1px solid ${DESIGN_TOKENS.border};border-radius:16px;overflow:hidden;width:100%;">
    ${imageHtml}
    <tr>
      <td style="padding:32px;">
        <div style="font-family:${FONTS.heading};font-size:22px;font-weight:700;line-height:28px;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};margin:0 0 12px 0;">${bodyTitle}</div>
        ${excerpt ? `<div style="font-family:${FONTS.body};font-size:15px;line-height:25px;color:${DESIGN_TOKENS.textSecondary};margin:0 0 20px 0;">${excerpt}</div>` : ""}
        ${linkHtml}
      </td>
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "feature-story",
  label: "Feature story",
  description: "Featured article block with image, body title, excerpt and read-more link. Used in marketing newsletters.",
  fields: [
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 30, default: "Feature" },
    { key: "title", label: "Section title", type: "text", required: true, maxLength: 80 },
    { key: "lede", label: "Section lede", type: "longText", optional: true, maxLength: 200 },
    { key: "image_url", label: "Article image URL", type: "url", optional: true },
    { key: "image_alt", label: "Image alt text", type: "text", optional: true, maxLength: 100 },
    { key: "body_title", label: "Article title (inside the card)", type: "text", required: true, maxLength: 100 },
    { key: "excerpt", label: "Article excerpt", type: "longText", optional: true, maxLength: 300 },
    { key: "link", label: "Read more link", type: "object", required: true, schema: {
      text: { type: "text", default: "Read the full piece", maxLength: 40 },
      url: { type: "url", required: true },
    }},
  ],
};

module.exports = { render, schema };

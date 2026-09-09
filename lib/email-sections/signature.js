// lib/email-sections/signature.js
//
// A personal sign-off: an optional closing paragraph, a sign-off line,
// then the sender's photo (or initials), name, role and an optional link
// ("Reply to this email", "Book a call"). Ends nurture drips, welcome
// emails and the B2B Weekly with a person rather than a logo. The byline
// inside `lead-story` is the same idea at the top of an article; this one
// stands alone at the end.
//
// What it accepts:
//   message          — optional closing paragraph(s); blank line = paragraph, inline markdown
//   sign_off         — e.g. "Speak soon," (optional)
//   name             — required
//   role             — optional, e.g. "Founder, Travelgenix"
//   avatar_url       — optional photo (rendered as a 48px circle; square in Outlook)
//   link_text, link_url — optional
//   show_rule_above  — boolean, hairline above the block (default false)
//   heading_colour, body_colour, background_colour, message_size
//
// Outlook patterns used:
//   - P6 two-cell row for avatar + details
//   - Initials avatar uses bgcolor (no gradient); border-radius is ignored
//     by Outlook, which shows a square tile — acceptable per §12

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback, renderBody, scaleFont, safeHex, editAttr, richAttr } = require("./_helpers");

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]).join("").toUpperCase();
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const name = escHtml(fallback(props.name, "")).trim();
  if (!name) return "";

  const role = props.role ? escHtml(props.role) : "";
  const signOff = props.sign_off ? escHtml(props.sign_off) : "";
  const messageHtml = renderBody(props.message || "");
  const avatarUrl = safeUrl(props.avatar_url);
  const linkText = props.link_text ? escHtml(props.link_text) : "";
  const linkUrl = safeUrl(props.link_url);
  const showRule = props.show_rule_above === true;

  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;
  const messageSize = scaleFont(15, props.message_size);

  const avatar = avatarUrl
    ? `<img src="${avatarUrl}" alt="${escAttr(props.name)}" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:24px;border:0;outline:none;text-decoration:none;">`
    : `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="48"><tr><td bgcolor="${DESIGN_TOKENS.primary}" align="center" valign="middle" width="48" height="48" style="background-color:${DESIGN_TOKENS.primary};border-radius:24px;font-family:${FONTS.body};font-size:16px;font-weight:700;color:#ffffff;line-height:48px;width:48px;height:48px;mso-line-height-rule:exactly;">${escHtml(initialsFor(props.name))}</td></tr></table>`;

  const messageBlock = messageHtml
    ? `<div${editAttr(editable, "message")}${richAttr(editable)} style="font-family:${FONTS.body};font-size:${messageSize}px;color:${bodyColour};line-height:${Math.round(messageSize * (25 / 15))}px;margin:0 0 4px 0;">${messageHtml}</div>`
    : "";
  const signOffBlock = signOff
    ? `<div${editAttr(editable, "sign_off")} style="font-family:${FONTS.body};font-size:${messageSize}px;color:${bodyColour};line-height:${Math.round(messageSize * (25 / 15))}px;margin:0 0 16px 0;">${signOff}</div>`
    : (messageHtml ? `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>` : "");

  const linkHtml = linkText && linkUrl
    ? `<div style="margin:4px 0 0 0;"><a href="${linkUrl}"${editAttr(editable, "link_text")} style="font-family:${FONTS.body};font-size:13px;font-weight:600;color:${DESIGN_TOKENS.accentDark};text-decoration:none;line-height:18px;">${linkText} &rarr;</a></div>`
    : "";

  const rule = showRule ? `border-top:1px solid ${DESIGN_TOKENS.border};` : "";

  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" style="background-color:${sectionBg};padding:24px 32px 28px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="${rule}">
    <tr><td style="padding:${showRule ? 24 : 0}px 0 0 0;">
      ${messageBlock}
      ${signOffBlock}
      <table role="presentation" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td width="48" valign="middle" style="width:48px;padding:0 14px 0 0;">${avatar}</td>
          <td valign="middle">
            <div${editAttr(editable, "name")} style="font-family:${FONTS.heading};font-size:15px;font-weight:700;color:${headingColour};line-height:20px;margin:0;">${name}</div>
            ${role ? `<div${editAttr(editable, "role")} style="font-family:${FONTS.body};font-size:13px;color:${bodyColour};line-height:18px;margin:2px 0 0 0;">${role}</div>` : ""}
            ${linkHtml}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "signature",
  label: "Signature",
  description: "A personal sign-off: optional closing paragraph and sign-off line, then photo (or initials), name, role and an optional link. Ends an email with a person rather than a logo.",
  fields: [
    { key: "message", label: "Closing paragraph (optional)", type: "longText", optional: true, maxLength: 600, help: "Blank line = paragraph. **bold**, *italic* and [text](url) work inline." },
    { key: "message_size", label: "Paragraph text size", type: "fontSize", optional: true },
    { key: "sign_off", label: "Sign-off line (e.g. \"Speak soon,\")", type: "text", optional: true, maxLength: 40 },
    { key: "name", label: "Name", type: "text", required: true, maxLength: 60 },
    { key: "role", label: "Role / company", type: "text", optional: true, maxLength: 80 },
    { key: "avatar_url", label: "Photo URL (optional, shown as a circle)", type: "url", optional: true },
    { key: "link_text", label: "Link text (optional)", type: "text", optional: true, maxLength: 40 },
    { key: "link_url", label: "Link URL", type: "url", optional: true },
    { key: "show_rule_above", label: "Rule above", type: "boolean", optional: true, checkboxLabel: "Show a thin rule above the sign-off" },
    { key: "heading_colour", label: "Name colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "body_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Applies to the paragraph, sign-off and role. Leave empty to keep the default." },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "Nurture, welcome and B2B Weekly emails that should end with a person",
      "Right before the footer, after the last content block",
    ],
    whenNotToUse: [
      "Transactional emails (use help-block)",
      "When no sender name is known — never invent one",
    ],
  },
};

module.exports = { render, schema };

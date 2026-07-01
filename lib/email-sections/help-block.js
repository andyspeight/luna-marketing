// lib/email-sections/help-block.js
// Archetype D (Transactional): support contact strip.
// Centred title, supporting line, then phone + email contacts inline
// with leading icons.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.4.

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont, editAttr } = require("./_helpers");

// Inline SVGs for phone and email icons. Render in modern clients;
// Outlook 2019+ renders them; Outlook 2016 may show a blank space, which
// is acceptable since the value text (phone number, email) is right there.
const ICONS = {
  phone: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  email: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
};

function renderContact(contact, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!contact) return "";
  const value = escHtml(contact.value || "");
  if (!value) return "";

  const type = ["phone", "email"].includes(contact.type) ? contact.type : "phone";
  const icon = ICONS[type];

  // Build href: explicit href takes precedence, else derive from type+value
  let href = "";
  if (contact.href) {
    href = safeUrl(contact.href);
    // safeUrl strips mailto/tel — re-allow them if the href starts with them
    if (!href && /^(mailto:|tel:)/i.test(contact.href)) {
      // Manually validate and pass through
      const cleaned = String(contact.href).trim().replace(/"/g, "&quot;").replace(/</g, "&lt;");
      href = cleaned;
    }
  }
  if (!href) {
    if (type === "email") {
      href = `mailto:${value}`;
    } else if (type === "phone") {
      // Strip non-digits and + for tel: link
      const digits = String(value).replace(/[^0-9+]/g, "");
      href = digits ? `tel:${digits}` : "#";
    }
  }

  return `<a href="${href}" style="display:inline-block;padding:0 12px;text-decoration:none;font-family:${FONTS.body};font-size:13px;font-weight:500;color:${DESIGN_TOKENS.primary};line-height:20px;white-space:nowrap;"><span style="vertical-align:middle;color:${DESIGN_TOKENS.primary};line-height:0;">${icon}</span>&nbsp;<span style="vertical-align:middle;">${value}</span></a>`;
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const title = escHtml(fallback(props.title, "Need help?"));
  const text = props.text ? escHtml(props.text) : "";
  const contacts = Array.isArray(props.contacts) ? props.contacts : [];

  // Per-text-area sizes. Bases match the px values used in the markup below.
  const titleSize = scaleFont(14, props.title_size);
  const textSize = scaleFont(13, props.text_size);

  const contactsHtml = contacts.map(d => renderContact(d, brand)).filter(Boolean).join("");

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgSecondary}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.bgSecondary};padding:28px 32px;text-align:center;border-top:1px solid ${DESIGN_TOKENS.border};">
  <div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:600;color:${DESIGN_TOKENS.textPrimary};letter-spacing:-0.01em;line-height:${Math.round(titleSize * (21 / 14))}px;margin:0 0 6px 0;">${title}</div>
  ${text ? `<div${editAttr(editable, "text")} style="font-family:${FONTS.body};font-size:${textSize}px;line-height:${Math.round(textSize * (20 / 13))}px;color:${DESIGN_TOKENS.textSecondary};margin:0 0 16px 0;">${text}</div>` : `<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>`}
  ${contactsHtml ? `<div style="text-align:center;line-height:20px;">${contactsHtml}</div>` : ""}
</td></tr>`;
}

const schema = {
  type: "help-block",
  label: "Help block",
  description: "Support contact strip with phone and email. Use in transactional emails so customers know how to reach a human.",
  fields: [
    { key: "title", label: "Title", type: "text", optional: true, maxLength: 60, default: "Need help?" },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "text", label: "Supporting text (e.g. opening hours)", type: "text", optional: true, maxLength: 120 },
    { key: "text_size", label: "Supporting text size", type: "fontSize", optional: true },
    { key: "contacts", label: "Contacts", type: "array", required: true, itemSchema: {
      type: { type: "select", options: ["phone", "email"], required: true },
      value: { type: "text", required: true, maxLength: 80 },
      href: { type: "text", optional: true, maxLength: 120 },
    }},
  ],
};

module.exports = { render, schema };

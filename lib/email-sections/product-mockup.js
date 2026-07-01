// lib/email-sections/product-mockup.js
// Archetype C (Product Launch): visual product mockup.
// Two variants:
//
// 1) chat — chat-widget mockup with navy header (avatar + name + status),
//    body of alternating bot / user message bubbles, optional typing
//    dots row. Models the Luna Chat launch reference.
//
// 2) dashboard — list of "metric" rows on a tinted background (label +
//    value + delta colour). Simpler; useful for analytics-style launches.
//
// Both variants sit inside a "visual frame" — a tinted gradient panel
// on a white outer block, so the mockup feels like product UI floating
// inside the email.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.3.
//
// Outlook patterns used:
//   - Tables with bgcolor for chat bubbles (no border-radius reliance,
//     no gradients on the bubbles themselves)
//   - Status dot uses Unicode bullet + green colour (no CSS dot)
//   - Typing dots become three static grey dots in Outlook (P8)
//   - Avatar circle uses bgcolor (no gradient)

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback, scaleFont, editAttr } = require("./_helpers");

// ── Chat variant ────────────────────────────────────────────────────
function renderChatMessage(msg, brand, editable, index) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!msg || !msg.text) return "";
  const text = escHtml(msg.text);
  const isUser = msg.from === "user";
  const msgSize = scaleFont(13, msg.text_size);

  if (isUser) {
    // User bubble: teal bg, dark text, right-aligned. Use a 2-cell
    // table where the left cell is a flex-spacer so the bubble hugs
    // the right edge.
    return `
<tr>
  <td style="padding:0 0 8px 0;">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="15%">&nbsp;</td>
        <td valign="top" align="right">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td bgcolor="${DESIGN_TOKENS.accent}" style="background-color:${DESIGN_TOKENS.accent};border-radius:14px 14px 4px 14px;padding:10px 14px;font-family:${FONTS.body};font-size:${msgSize}px;font-weight:500;line-height:1.45;color:${DESIGN_TOKENS.primaryDark};">${text}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
  }

  // Bot bubble: pale grey bg, dark text, left-aligned with a slight
  // squeeze on the right so it doesn't span full width.
  return `
<tr>
  <td style="padding:0 0 8px 0;">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td valign="top" align="left">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td bgcolor="${DESIGN_TOKENS.bgTertiary}" style="background-color:${DESIGN_TOKENS.bgTertiary};border-radius:14px 14px 14px 4px;padding:10px 14px;font-family:${FONTS.body};font-size:${msgSize}px;line-height:1.45;color:${DESIGN_TOKENS.textPrimary};">${text}</td>
            </tr>
          </table>
        </td>
        <td width="15%">&nbsp;</td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderChatVariant(props, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const headerName = escHtml(fallback(props.header_name, "Luna"));
  const headerNameSize = scaleFont(13, props.header_name_size);
  const headerStatus = escHtml(fallback(props.header_status, "Online · responds instantly"));
  const headerInitial = escHtml(fallback(props.header_initial, headerName[0] || "L")).slice(0, 1).toUpperCase();
  const messages = Array.isArray(props.messages) ? props.messages : [];
  const showTyping = !!props.show_typing;

  const messagesHtml = messages.map(d => renderChatMessage(d, brand)).filter(Boolean).join("");

  // Typing-dots row. Three Unicode bullets at low opacity. Outlook gets
  // three static dots; modern clients see them in a pale grey bubble.
  const typingHtml = showTyping ? `
<tr>
  <td style="padding:4px 0 0 0;">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td bgcolor="${DESIGN_TOKENS.bgTertiary}" style="background-color:${DESIGN_TOKENS.bgTertiary};border-radius:14px 14px 14px 4px;padding:12px 14px;font-family:${FONTS.body};font-size:14px;color:${DESIGN_TOKENS.textTertiary};line-height:1;letter-spacing:2px;">
          <span style="color:${DESIGN_TOKENS.textTertiary};">●</span><span style="color:${DESIGN_TOKENS.textTertiary};opacity:0.7;">●</span><span style="color:${DESIGN_TOKENS.textTertiary};opacity:0.4;">●</span>
        </td>
      </tr>
    </table>
  </td>
</tr>` : "";

  // Status dot: small green circle + status text. Built via inline
  // table to keep alignment in Outlook.
  return `
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="360" align="center" style="background-color:#ffffff;border-radius:16px 16px 0 0;border:1px solid #e2e8f0;border-bottom:none;max-width:360px;margin:0 auto;">
  <!-- Header -->
  <tr>
    <td bgcolor="${DESIGN_TOKENS.primary}" style="background-color:${DESIGN_TOKENS.primary};padding:14px 18px;border-radius:16px 16px 0 0;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
        <tr>
          <td width="42" valign="middle" style="padding-right:10px;">
            <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="32">
              <tr>
                <td bgcolor="${DESIGN_TOKENS.accent}" align="center" valign="middle" width="32" height="32" style="background-color:${DESIGN_TOKENS.accent};border-radius:16px;font-family:${FONTS.body};font-size:13px;font-weight:700;color:${DESIGN_TOKENS.primaryDark};line-height:32px;width:32px;height:32px;mso-line-height-rule:exactly;">${headerInitial}</td>
              </tr>
            </table>
          </td>
          <td valign="middle">
            <div style="font-family:${FONTS.body};font-size:${headerNameSize}px;font-weight:600;color:#ffffff;line-height:${Math.round(headerNameSize * (18 / 13))}px;margin:0;">${headerName}</div>
            <div style="font-family:${FONTS.body};font-size:11px;color:rgba(255,255,255,0.7);line-height:16px;margin:0;">
              <span style="color:${DESIGN_TOKENS.success};font-size:9px;line-height:9px;">●</span>&nbsp;${headerStatus}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:18px;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
        ${messagesHtml}
        ${typingHtml}
      </table>
    </td>
  </tr>
</table>`;
}

// ── Dashboard variant ───────────────────────────────────────────────
function renderDashboardRow(row, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!row) return "";
  const label = escHtml(fallback(row.label, "")).trim();
  const value = escHtml(fallback(row.value, "")).trim();
  const delta = row.delta ? escHtml(row.delta) : "";
  const deltaDir = row.delta_direction === "down" ? "down" : "up";
  const deltaColour = deltaDir === "down" ? "#DC2626" : DESIGN_TOKENS.success;
  const deltaArrow = deltaDir === "down" ? "▼" : "▲";

  if (!label && !value) return "";

  return `
<tr>
  <td style="padding:14px 16px;border-bottom:1px solid ${DESIGN_TOKENS.borderLight};">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td valign="middle" align="left" style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:18px;">${label}</td>
        <td valign="middle" align="right">
          <span style="font-family:${FONTS.heading};font-size:16px;font-weight:700;letter-spacing:-0.01em;color:${DESIGN_TOKENS.textPrimary};line-height:18px;font-variant-numeric:tabular-nums;">${value}</span>
          ${delta ? `<span style="font-family:${FONTS.body};font-size:11px;font-weight:600;color:${deltaColour};margin-left:8px;">${deltaArrow}&nbsp;${delta}</span>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderDashboardVariant(props, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const title = escHtml(fallback(props.dashboard_title, "Today's metrics"));
  const titleSize = scaleFont(14, props.dashboard_title_size);
  const rows = Array.isArray(props.dashboard_rows) ? props.dashboard_rows : [];

  const rowsHtml = rows.map(d => renderDashboardRow(d, brand)).filter(Boolean).join("");

  return `
<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="440" align="center" style="background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;max-width:440px;margin:0 auto;overflow:hidden;">
  <tr>
    <td bgcolor="#ffffff" style="background-color:#ffffff;padding:16px 18px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
      <div style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.01em;color:${DESIGN_TOKENS.textPrimary};line-height:${Math.round(titleSize * (18 / 14))}px;">${title}</div>
    </td>
  </tr>
  ${rowsHtml || `<tr><td style="padding:24px;text-align:center;color:${DESIGN_TOKENS.textTertiary};font-family:${FONTS.body};font-size:13px;">(no data)</td></tr>`}
</table>`;
}

// ── Outer wrap (the "visual frame" — tinted gradient panel) ─────────
function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const variant = props.variant === "dashboard" ? "dashboard" : "chat";
  const inner = variant === "dashboard"
    ? renderDashboardVariant(props, brand)
    : renderChatVariant(props, brand);

  // Tinted gradient panel via background-image (modern); flat bgcolor
  // for Outlook. The mockup floats inside this with a 40px top padding
  // and bleed-bottom (no bottom padding) so it suggests "more screen
  // below the fold" without showing the full thing.
  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:48px 40px 8px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" align="center" style="max-width:560px;">
    <tr>
      <td bgcolor="${DESIGN_TOKENS.bgSecondary}" style="background-color:${DESIGN_TOKENS.bgSecondary};background-image:linear-gradient(135deg, ${DESIGN_TOKENS.bgSecondary} 0%, #E0F7FA 100%);border:1px solid ${DESIGN_TOKENS.border};border-radius:16px;padding:40px 32px 0;">
        ${inner}
      </td>
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "product-mockup",
  label: "Product mockup",
  description: "Mockup of a product UI inside a tinted gradient frame. Two variants: chat (a chat widget) or dashboard (a metric list). For product launch emails.",
  fields: [
    { key: "variant", label: "Variant", type: "select", options: ["chat", "dashboard"], default: "chat" },
    // ── chat variant fields ──
    { key: "header_initial", label: "Chat: header avatar letter", type: "text", optional: true, maxLength: 1, help: "Used by the chat variant." },
    { key: "header_name", label: "Chat: header name", type: "text", optional: true, maxLength: 30, help: "Used by the chat variant." },
    { key: "header_name_size", label: "Header name text size", type: "fontSize", optional: true },
    { key: "header_status", label: "Chat: header status (e.g. \"Online · responds instantly\")", type: "text", optional: true, maxLength: 60, help: "Used by the chat variant." },
    { key: "messages", label: "Chat messages", type: "array", optional: true, itemLabel: "message", itemFields: [
      { key: "from", label: "From", type: "select", required: true, options: ["bot", "user"] },
      { key: "text", label: "Message text", type: "longText", required: true, maxLength: 280 },
      { key: "text_size", label: "Message text size", type: "fontSize", optional: true },
    ]},
    { key: "show_typing", label: "Chat: show typing dots at end", type: "boolean" },
    // ── dashboard variant fields ──
    { key: "dashboard_title", label: "Dashboard: title", type: "text", optional: true, maxLength: 60, help: "Used by the dashboard variant." },
    { key: "dashboard_title_size", label: "Dashboard title text size", type: "fontSize", optional: true },
    { key: "dashboard_rows", label: "Dashboard rows", type: "array", optional: true, itemLabel: "row", itemFields: [
      { key: "label", label: "Label", type: "text", required: true, maxLength: 60 },
      { key: "value", label: "Value", type: "text", required: true, maxLength: 30 },
      { key: "delta", label: "Delta (e.g. \"+12%\")", type: "text", optional: true, maxLength: 20 },
      { key: "delta_direction", label: "Delta direction", type: "select", options: ["up", "down"] },
    ]},
  ],
};

module.exports = { render, schema };

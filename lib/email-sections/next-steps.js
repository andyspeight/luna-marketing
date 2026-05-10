// lib/email-sections/next-steps.js
// Archetype D (Transactional): numbered things-to-do block.
// Compact 24px numbered tiles with title + description per step. The
// description supports inline markdown links (built into _helpers).
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.4 for the visual
// reference. Uses §12 P6 (two-column without flex/grid) — number tile in a
// fixed-width left cell, content in the right cell.

const { DESIGN_TOKENS, FONTS } = require("../email-brand");
const { escHtml, fallback, inlineMarkdown } = require("./_helpers");

function renderStep(step, index) {
  if (!step) return "";
  const title = escHtml(fallback(step.title, "")).trim();
  const text = step.text ? inlineMarkdown(escHtml(step.text)) : "";
  if (!title && !text) return "";

  const num = String(index + 1);

  // Two-column table per §12 P6. Number tile is a fixed 32px left cell with
  // a circular grey background and centred number; right cell holds title
  // and description. The number itself uses navy text (Outlook-safe — no
  // gradient fills).
  return `
<tr>
  <td style="padding:12px 0;">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="32" valign="top" style="padding-right:14px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="24">
            <tr>
              <td bgcolor="${DESIGN_TOKENS.bgTertiary}" align="center" valign="middle" width="24" height="24" style="background-color:${DESIGN_TOKENS.bgTertiary};border-radius:12px;font-family:${FONTS.body};font-size:11px;font-weight:700;color:${DESIGN_TOKENS.primary};line-height:24px;width:24px;height:24px;mso-line-height-rule:exactly;">
                ${num}
              </td>
            </tr>
          </table>
        </td>
        <td valign="top">
          ${title ? `<div style="font-family:${FONTS.heading};font-size:14px;font-weight:600;letter-spacing:-0.01em;color:${DESIGN_TOKENS.textPrimary};line-height:21px;margin:0 0 3px 0;">${title}</div>` : ""}
          ${text ? `<div style="font-family:${FONTS.body};font-size:13px;line-height:20px;color:${DESIGN_TOKENS.textSecondary};margin:0;">${text}</div>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function render(props = {}) {
  const title = escHtml(fallback(props.title, "A few things before you go"));
  const steps = Array.isArray(props.steps) ? props.steps : [];

  if (!steps.length) return "";

  const stepsHtml = steps.map(renderStep).filter(Boolean).join("");

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:8px 32px 24px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="border-top:1px solid ${DESIGN_TOKENS.border};padding-top:24px;">
    <tr>
      <td style="padding:0 0 12px 0;">
        <div style="font-family:${FONTS.heading};font-size:16px;font-weight:700;letter-spacing:-0.015em;color:${DESIGN_TOKENS.textPrimary};line-height:22px;margin:0;">${title}</div>
      </td>
    </tr>
    ${stepsHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "next-steps",
  label: "Next steps",
  description: "Numbered checklist of things to do before/after a booking. For transactional emails. Step descriptions support inline links via [text](url) markdown.",
  fields: [
    { key: "title", label: "Block title", type: "text", optional: true, maxLength: 80, default: "A few things before you go" },
    { key: "steps", label: "Steps", type: "array", required: true, itemSchema: {
      title: { type: "text", required: true, maxLength: 80 },
      text: { type: "longText", optional: true, maxLength: 280 },
    }},
  ],
};

module.exports = { render, schema };

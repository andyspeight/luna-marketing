// lib/email-sections/masthead.js
// Archetype A (B2B Weekly): newspaper-style header.
// White background, 3px navy bottom border (Outlook-safe — no
// pseudo-elements). Vol/issue and date split across a top meta row,
// large bold title, italic tagline below.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.1.
//
// Outlook patterns used:
//   - P6 (two-column without flex/grid) for the vol-issue/date row

const { DESIGN_TOKENS, FONTS } = require("../email-brand");
const { escHtml, fallback } = require("./_helpers");

function render(props = {}) {
  const issueLabel = escHtml(fallback(props.issue_label, ""));
  const dateLabel = escHtml(fallback(props.date_label, ""));
  const title = escHtml(fallback(props.title, "The Travelgenix Weekly"));
  const tagline = props.tagline ? escHtml(props.tagline) : "";

  // Top meta row (vol/issue left, date right) — only render the row if
  // either is set. If only one is set, push it to the relevant edge.
  let metaRowHtml = "";
  if (issueLabel || dateLabel) {
    metaRowHtml = `
    <tr>
      <td style="padding:0 0 16px 0;">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
          <tr>
            <td valign="middle" align="left" style="font-family:${FONTS.body};font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${DESIGN_TOKENS.textSecondary};line-height:16px;">${issueLabel}</td>
            <td valign="middle" align="right" style="font-family:${FONTS.body};font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${DESIGN_TOKENS.textSecondary};line-height:16px;">${dateLabel}</td>
          </tr>
        </table>
      </td>
    </tr>`;
  }

  // Title + tagline. The 3px bottom border lives on the outer cell so
  // Outlook honours it (a div border-bottom inside doesn't always render).
  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:32px 36px 20px;border-bottom:3px solid ${DESIGN_TOKENS.primary};">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    ${metaRowHtml}
    <tr>
      <td style="padding:0;">
        <h1 style="font-family:${FONTS.heading};font-size:38px;font-weight:800;letter-spacing:-0.035em;line-height:1;color:${DESIGN_TOKENS.primary};margin:0;mso-line-height-rule:exactly;">${title}</h1>
      </td>
    </tr>
    ${tagline ? `
    <tr>
      <td style="padding:8px 0 0 0;">
        <p style="font-family:${FONTS.body};font-size:12px;font-style:italic;letter-spacing:-0.005em;color:${DESIGN_TOKENS.textSecondary};line-height:18px;margin:0;">${tagline}</p>
      </td>
    </tr>` : ""}
  </table>
</td></tr>`;
}

const schema = {
  type: "masthead",
  label: "Masthead",
  description: "Newspaper-style header with vol/issue line, large bold title, and italic tagline. For B2B Weekly newsletters.",
  fields: [
    { key: "issue_label", label: "Issue label (e.g. \"Vol. 02 · Issue 19\")", type: "text", optional: true, maxLength: 60 },
    { key: "date_label", label: "Date (e.g. \"Friday, 8 May 2026\")", type: "text", optional: true, maxLength: 40 },
    { key: "title", label: "Title", type: "text", required: true, maxLength: 60 },
    { key: "tagline", label: "Tagline (italic, single line)", type: "text", optional: true, maxLength: 120 },
  ],
};

module.exports = { render, schema };

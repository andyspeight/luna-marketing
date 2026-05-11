// lib/email-sections/calendar-grid.js
// Archetype A (B2B Weekly): "On the radar" upcoming events list.
// Title + sub on the section header, then a stacked list of items. Each
// item: 80px-wide left column with month abbreviation + big day number,
// thin grey rule separator, then a content column with title and one
// line of supporting copy. Items rendered as either plain rows or links
// depending on whether item.url is supplied.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.1.
//
// Outlook patterns used:
//   - P6 (two-column without flex/grid) for each item row
//   - bgcolor on each item cell (no gradients)
//   - Hover transforms in the visual reference are P8-stripped

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback } = require("./_helpers");

function renderItem(item, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!item) return "";
  const month = escHtml(fallback(item.month, "")).toUpperCase();
  const day = escHtml(fallback(item.day, ""));
  const title = escHtml(fallback(item.title, "")).trim();
  const text = item.text ? escHtml(item.text) : "";
  const url = safeUrl(item.url);

  if (!title && !day) return "";

  // The whole row is wrapped in either a single <a> (if url) or rendered
  // as a static block (if no url). Email clients differ on how nicely
  // they style block-level <a> tags, so we keep the link styling minimal
  // and put the colour on the inner cells.
  const linkOpen = url ? `<a href="${url}" style="text-decoration:none;color:${DESIGN_TOKENS.textPrimary};display:block;">` : "";
  const linkClose = url ? `</a>` : "";

  return `
<tr>
  <td style="padding:0 0 12px 0;">
    ${linkOpen}
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="background-color:${DESIGN_TOKENS.bgSecondary};border-radius:8px;">
      <tr>
        <td width="80" valign="middle" align="center" bgcolor="${DESIGN_TOKENS.bgSecondary}" style="background-color:${DESIGN_TOKENS.bgSecondary};padding:14px 0;border-right:1px solid ${DESIGN_TOKENS.border};border-radius:8px 0 0 8px;">
          ${month ? `<div style="font-family:${FONTS.body};font-size:11px;font-weight:700;color:${DESIGN_TOKENS.primary};letter-spacing:0.05em;text-transform:uppercase;line-height:1.3;margin:0;">${month}</div>` : ""}
          ${day ? `<div style="font-family:${FONTS.heading};font-size:18px;font-weight:800;color:${DESIGN_TOKENS.primary};letter-spacing:-0.02em;line-height:1.2;margin:2px 0 0 0;">${day}</div>` : ""}
        </td>
        <td valign="middle" bgcolor="${DESIGN_TOKENS.bgSecondary}" style="background-color:${DESIGN_TOKENS.bgSecondary};padding:14px 16px;border-radius:0 8px 8px 0;">
          ${title ? `<div style="font-family:${FONTS.heading};font-size:14px;font-weight:600;letter-spacing:-0.01em;color:${DESIGN_TOKENS.textPrimary};line-height:1.3;margin:0 0 3px 0;">${title}</div>` : ""}
          ${text ? `<div style="font-family:${FONTS.body};font-size:12px;color:${DESIGN_TOKENS.textSecondary};line-height:1.5;margin:0;">${text}</div>` : ""}
        </td>
      </tr>
    </table>
    ${linkClose}
  </td>
</tr>`;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const title = escHtml(fallback(props.title, "On the radar"));
  const sub = props.sub ? escHtml(props.sub) : "";
  const items = Array.isArray(props.items) ? props.items : [];

  if (!items.length) return "";

  const itemsHtml = items.map(d => renderItem(d, brand)).filter(Boolean).join("");

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:36px;">
  <div style="font-family:${FONTS.heading};font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};line-height:1.2;margin:0 0 6px 0;">${title}</div>
  ${sub ? `<div style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:1.5;margin:0 0 20px 0;">${sub}</div>` : `<div style="height:20px;line-height:20px;font-size:20px;">&nbsp;</div>`}
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">${itemsHtml}</table>
</td></tr>`;
}

const schema = {
  type: "calendar-grid",
  label: "Calendar grid (On the radar)",
  description: "Upcoming-events list. Each item shows a month/day tile on the left and a title + one-line description on the right. Use for B2B Weekly newsletters.",
  fields: [
    { key: "title", label: "Section title", type: "text", optional: true, maxLength: 60, default: "On the radar" },
    { key: "sub", label: "Sub-line", type: "text", optional: true, maxLength: 120 },
    { key: "items", label: "Items", type: "array", required: true, itemLabel: "event", itemFields: [
      { key: "month", label: "Month (e.g. \"May\")", type: "text", required: true, maxLength: 4 },
      { key: "day", label: "Day (e.g. \"14\")", type: "text", required: true, maxLength: 2 },
      { key: "title", label: "Event title", type: "text", required: true, maxLength: 80 },
      { key: "text", label: "One-line description", type: "text", optional: true, maxLength: 140 },
      { key: "url", label: "Link URL", type: "url", optional: true },
    ]},
  ],
};

module.exports = { render, schema };

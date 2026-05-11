// lib/email-sections/cost-summary.js
// Archetype D (Transactional): cost breakdown card.
// Light grey card with line items, total row, payment status footer.
// See travelgenix-email-design SKILL.md §4 and Appendix A.4.

const STATIC_BRAND = require("../email-brand");
const { escHtml, fallback } = require("./_helpers");

function renderLineItem(item, isLast, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!item || !item.label) return "";
  const label = escHtml(item.label);
  const amount = escHtml(item.amount || "");

  return `
<tr>
  <td style="padding:8px 0;">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td valign="top">
          <span style="font-family:${FONTS.body};font-size:14px;color:${DESIGN_TOKENS.textSecondary};line-height:21px;">${label}</span>
        </td>
        <td valign="top" align="right">
          <span style="font-family:${FONTS.body};font-size:14px;font-weight:600;color:${DESIGN_TOKENS.textSecondary};line-height:21px;">${amount}</span>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderTotalRow(total, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!total || !total.amount) return "";
  const label = escHtml(fallback(total.label, "Total"));
  const amount = escHtml(total.amount);

  return `
<tr>
  <td style="padding:14px 0 8px 0;border-top:1px solid ${DESIGN_TOKENS.border};">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td valign="top">
          <span style="font-family:${FONTS.body};font-size:16px;font-weight:700;color:${DESIGN_TOKENS.textPrimary};line-height:24px;">${label}</span>
        </td>
        <td valign="top" align="right">
          <span style="font-family:${FONTS.body};font-size:16px;font-weight:800;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};line-height:24px;">${amount}</span>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderPaymentRow(payment, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!payment || !payment.text) return "";
  const text = escHtml(payment.text);
  const status = escHtml(fallback(payment.status, "Settled"));

  // Green dot uses Unicode ● rather than CSS for cross-client reliability
  return `
<tr>
  <td style="padding:12px 0 0 0;border-top:1px solid ${DESIGN_TOKENS.border};">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td valign="middle">
          <span style="font-family:${FONTS.body};font-size:12px;color:${DESIGN_TOKENS.textSecondary};line-height:18px;">${text}</span>
        </td>
        <td valign="middle" align="right">
          <span style="font-family:${FONTS.body};font-size:12px;font-weight:600;color:${DESIGN_TOKENS.success};line-height:18px;">
            <span style="color:${DESIGN_TOKENS.success};">●</span> ${status}
          </span>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const lineItems = Array.isArray(props.line_items) ? props.line_items : [];
  const total = props.total || null;
  const payment = props.payment || null;

  if (lineItems.length === 0 && !total) {
    // Nothing to show
    return "";
  }

  const lineItemsHtml = lineItems.map((item, i) =>
    renderLineItem(item, i === lineItems.length - 1, brand)
  ).join("");
  const totalHtml = renderTotalRow(total, brand);
  const paymentHtml = renderPaymentRow(payment, brand);

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:0 32px 32px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="${DESIGN_TOKENS.bgSecondary}" style="background-color:${DESIGN_TOKENS.bgSecondary};border-radius:12px;">
    <tr>
      <td style="padding:20px 24px;">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
          ${lineItemsHtml}
          ${totalHtml}
          ${paymentHtml}
        </table>
      </td>
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "cost-summary",
  label: "Cost summary",
  description: "Line items, total, and payment status. For transactional emails.",
  fields: [
    { key: "line_items", label: "Line items", type: "array", itemSchema: {
      label: { type: "text", required: true, maxLength: 60 },
      amount: { type: "text", required: true, maxLength: 20 },
    }},
    { key: "total", label: "Total", type: "object", required: true, schema: {
      label: { type: "text", default: "Total", maxLength: 30 },
      amount: { type: "text", required: true, maxLength: 20 },
    }},
    { key: "payment", label: "Payment status", type: "object", optional: true, schema: {
      text: { type: "text", maxLength: 80 },
      status: { type: "text", default: "Settled", maxLength: 20 },
    }},
  ],
};

module.exports = { render, schema };

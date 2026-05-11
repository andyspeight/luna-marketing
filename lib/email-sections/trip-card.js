// lib/email-sections/trip-card.js
// Archetype D (Transactional): booking display centrepiece.
// Header image with destination tag overlay, body with detail rows,
// and a journey block showing outbound → return airports.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.4 for the
// visual reference. Uses §12 P5 (image with overlay) and P6 (two-column).

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

function renderDetailRow(detail, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!detail || !detail.label || !detail.value) return "";
  const label = escHtml(detail.label);
  const value = escHtml(detail.value);
  const secondary = detail.secondary ? escHtml(detail.secondary) : "";

  return `
<tr>
  <td style="padding:14px 0;border-bottom:1px solid ${DESIGN_TOKENS.borderLight};">
    <table role="presentation" class="tg-stack-mobile" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="130" valign="top" style="padding-right:16px;">
          <div style="font-family:${FONTS.body};font-size:12px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:${DESIGN_TOKENS.textTertiary};line-height:18px;">${label}</div>
        </td>
        <td valign="top">
          <div style="font-family:${FONTS.body};font-size:14px;font-weight:600;color:${DESIGN_TOKENS.textPrimary};line-height:21px;">${value}</div>
          ${secondary ? `<div style="font-family:${FONTS.body};font-size:12px;color:${DESIGN_TOKENS.textSecondary};line-height:18px;margin-top:2px;">${secondary}</div>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderJourneyBlock(journey, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!journey || !journey.outbound || !journey.return) return "";

  const outAirport = escHtml(journey.outbound.airport_code || "");
  const outCity = escHtml(journey.outbound.airport_name || "");
  const outDate = escHtml(journey.outbound.date || "");
  const outTime = escHtml(journey.outbound.time || "");
  const retAirport = escHtml(journey.return.airport_code || "");
  const retCity = escHtml(journey.return.airport_name || "");
  const retDate = escHtml(journey.return.date || "");
  const retTime = escHtml(journey.return.time || "");

  const outboundMeta = [outCity, outDate && outTime ? `${outDate}, ${outTime}` : (outDate || outTime)]
    .filter(Boolean).join(" · ");
  const returnMeta = [retCity, retDate && retTime ? `${retDate}, ${retTime}` : (retDate || retTime)]
    .filter(Boolean).join(" · ");

  return `
<tr>
  <td style="padding:24px 0;border-top:1px solid ${DESIGN_TOKENS.borderLight};border-bottom:1px solid ${DESIGN_TOKENS.borderLight};">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td width="45%" valign="middle">
          <div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.textTertiary};line-height:14px;margin:0 0 4px 0;">Outbound</div>
          <div style="font-family:${FONTS.heading};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};line-height:24px;margin:0 0 4px 0;">${outAirport}</div>
          <div style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:18px;">${outboundMeta}</div>
        </td>
        <td width="10%" valign="middle" align="center" style="color:${DESIGN_TOKENS.accent};">
          <span style="font-family:${FONTS.body};font-size:18px;font-weight:700;color:${DESIGN_TOKENS.accent};line-height:1;">→</span>
        </td>
        <td width="45%" valign="middle" align="right">
          <div style="font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.textTertiary};line-height:14px;margin:0 0 4px 0;">Return</div>
          <div style="font-family:${FONTS.heading};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${DESIGN_TOKENS.textPrimary};line-height:24px;margin:0 0 4px 0;">${retAirport}</div>
          <div style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:18px;">${returnMeta}</div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const imageUrl = safeUrl(props.image_url);
  const imageTag = escHtml(fallback(props.image_tag, ""));
  const imageName = escHtml(fallback(props.image_name, "Your trip"));
  const details = Array.isArray(props.details) ? props.details : [];
  const journey = props.journey || null;

  // Image header — overlay text only renders in non-Outlook clients.
  // Outlook gets the bare image; the destination name appears again as the
  // first detail row by convention if no other duplication exists.
  let imageHtml = "";
  if (imageUrl) {
    const overlayHtml = `
      ${imageTag ? `<div style="display:inline-block;padding:4px 10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:999px;font-family:${FONTS.body};font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;margin-bottom:8px;">${imageTag}</div>` : ""}
      <div style="font-family:${FONTS.heading};font-size:22px;font-weight:700;letter-spacing:-0.02em;line-height:26px;color:#ffffff;margin:0;">${imageName}</div>`;

    imageHtml = `
<!--[if mso]>
  <img src="${imageUrl}" alt="${imageName}" width="536" height="180" style="display:block;width:100%;max-width:536px;height:auto;border:0;outline:none;text-decoration:none;"/>
<![endif]-->
<!--[if !mso]><!-- -->
  <div style="position:relative;width:100%;">
    <img src="${imageUrl}" alt="${imageName}" width="536" height="180" style="display:block;width:100%;height:180px;object-fit:cover;border:0;outline:none;text-decoration:none;"/>
    <div style="position:absolute;bottom:16px;left:20px;right:20px;color:#ffffff;text-shadow:0 1px 2px rgba(0,0,0,0.3);">
      ${overlayHtml}
    </div>
  </div>
<!--<![endif]-->`;
  }

  // Body table — detail rows plus the journey block
  const detailRowsHtml = details.map(d => renderDetailRow(d, brand)).join("");
  const journeyHtml = renderJourneyBlock(journey, brand);

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:0 32px 32px;">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="border:1px solid ${DESIGN_TOKENS.border};border-radius:12px;overflow:hidden;background-color:${DESIGN_TOKENS.bgPrimary};">
    ${imageUrl ? `<tr><td style="padding:0;font-size:0;line-height:0;">${imageHtml}</td></tr>` : ""}
    <tr>
      <td style="padding:24px;">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
          ${detailRowsHtml}
          ${journeyHtml}
        </table>
      </td>
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "trip-card",
  label: "Trip card",
  description: "Booking display with destination image, detail rows, and outbound/return journey block. For transactional emails.",
  fields: [
    { key: "image_url", label: "Destination image URL", type: "url", optional: true },
    { key: "image_tag", label: "Region tag (e.g. \"Greek Islands\")", type: "text", optional: true, maxLength: 30 },
    { key: "image_name", label: "Destination name", type: "text", required: true, maxLength: 60 },
    { key: "details", label: "Detail rows", type: "array", itemSchema: {
      label: { type: "text", required: true, maxLength: 30 },
      value: { type: "text", required: true, maxLength: 100 },
      secondary: { type: "text", optional: true, maxLength: 100 },
    }},
    { key: "journey", label: "Journey (outbound/return)", type: "object", optional: true, schema: {
      outbound: { type: "object", schema: {
        airport_code: { type: "text", maxLength: 4 },
        airport_name: { type: "text", maxLength: 60 },
        date: { type: "text", maxLength: 30 },
        time: { type: "text", maxLength: 10 },
      }},
      return: { type: "object", schema: {
        airport_code: { type: "text", maxLength: 4 },
        airport_name: { type: "text", maxLength: 60 },
        date: { type: "text", maxLength: 30 },
        time: { type: "text", maxLength: 10 },
      }},
    }},
  ],
};

module.exports = { render, schema };

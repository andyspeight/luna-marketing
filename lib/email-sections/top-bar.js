// lib/email-sections/top-bar.js
// Compact header bar with logo on the left and metadata (typically a
// booking reference) on the right. Used by Archetype D (Transactional).
// For the centred logo header used elsewhere, see header.js.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.4.
//
// May 2026 — brand kit support (Push 2). The render function now accepts
// an optional second argument `brand` from getBrand(clientKit). When
// passed, brand-aware tokens (logo URL, colours, fonts) come from the
// client's kit instead of the static Travelgenix defaults. When omitted,
// the static module-level constants are used (backward compat for any
// legacy caller that hasn't been updated to pass brand).

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback } = require("./_helpers");

function render(props = {}, brand) {
  // Brand-aware tokens — fall back to static Travelgenix defaults if
  // no brand object was passed in.
  const { DESIGN_TOKENS, FONTS, LOGO_URL, COMPANY } = brand || STATIC_BRAND;

  const logoUrl = safeUrl(props.logoUrl) || LOGO_URL;
  const logoAlt = escHtml(props.logoAlt || COMPANY.name);
  const logoLink = safeUrl(props.logoLinkUrl) || COMPANY.url;
  const businessName = escHtml(fallback(props.businessName, COMPANY.name));
  const showLogoImage = props.showLogoImage !== false;

  // "Was a logo URL explicitly provided?" — previously this was a
  // comparison to LOGO_URL (the static default). That broke when brand
  // kits supplied their own logo via LOGO_URL, because props.logoUrl
  // (set by applyBrandKitToSections in the wizard) would equal LOGO_URL
  // and the image would silently fall back to text. The fix: check the
  // original prop directly. If the prop is set OR a brand kit provides
  // a logo URL different from the static Travelgenix default, show the
  // image; otherwise fall back to the business name as text.
  const hasExplicitLogo = !!safeUrl(props.logoUrl)
    || (brand && LOGO_URL !== STATIC_BRAND.LOGO_URL);

  const metaLabel = props.metaLabel ? escHtml(props.metaLabel) : "";
  const metaValue = props.metaValue ? escHtml(props.metaValue) : "";
  const hasMeta = metaLabel || metaValue;

  // Two-column table layout: logo left, meta right.
  // Logo cell renders either an <img> (if showLogoImage AND a logo was
  // actually provided/branded) OR the business name as text.

  const logoCell = showLogoImage && hasExplicitLogo
    ? `<a href="${logoLink}" style="text-decoration:none;border:0;outline:none;"><img src="${logoUrl}" alt="${logoAlt}" width="180" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:180px;"></a>`
    : `<a href="${logoLink}" style="text-decoration:none;color:${DESIGN_TOKENS.textPrimary};font-family:${FONTS.heading};font-size:14px;font-weight:700;letter-spacing:-0.01em;">${businessName}</a>`;

  const metaCell = hasMeta
    ? `<span style="font-family:${FONTS.body};font-size:11px;font-weight:500;color:${DESIGN_TOKENS.textTertiary};letter-spacing:0;line-height:18px;">${metaLabel}${metaLabel && metaValue ? " · " : ""}${metaValue ? `<strong style="color:${DESIGN_TOKENS.textPrimary};font-weight:600;letter-spacing:0.02em;">${metaValue}</strong>` : ""}</span>`
    : "";

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgPrimary}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.bgPrimary};padding:20px 32px;border-bottom:1px solid ${DESIGN_TOKENS.border};">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    <tr>
      <td valign="middle" align="left">${logoCell}</td>
      ${hasMeta ? `<td valign="middle" align="right">${metaCell}</td>` : ""}
    </tr>
  </table>
</td></tr>`;
}

const schema = {
  type: "top-bar",
  label: "Top bar",
  description: "Compact header with logo (or business name) on the left and metadata on the right. Use for transactional emails to show booking reference, order number, etc.",
  fields: [
    { key: "businessName", label: "Business name (used if no logo image)", type: "text", optional: true, maxLength: 50 },
    { key: "logoUrl", label: "Logo image URL", type: "url", optional: true },
    { key: "logoAlt", label: "Logo alt text", type: "text", optional: true, maxLength: 50 },
    { key: "logoLinkUrl", label: "Logo link URL", type: "url", optional: true },
    { key: "showLogoImage", label: "Show logo image (uncheck for text-only)", type: "boolean", default: true },
    { key: "metaLabel", label: "Meta label (e.g. \"Booking ref\")", type: "text", optional: true, maxLength: 30 },
    { key: "metaValue", label: "Meta value (e.g. \"TG24189\")", type: "text", optional: true, maxLength: 30 },
  ],
};

module.exports = { render, schema };

// lib/email-sections/footer-dark.js
// Archetype C (Product Launch): deep navy footer.
// Sister to footer-light (light grey, marketing) and footer-meta
// (transactional). Used at the bottom of product launch emails so the
// dark colour scheme runs all the way to the email's edge.
//
// White logo wordmark, optional small inline links row (Reply / Forward
// / Manage), and a meta block underneath with the send reason, manage
// links (Update preferences / Unsubscribe / View in browser), and legal
// line. Optional social icons row for parity with footer-light.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.3.
//
// Outlook patterns used:
//   - Flat dark navy background (no gradients)
//   - Inline social icons, with bordered circles via bgcolor + border
//   - All decorative animations (none expected here) graceful-strip

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback } = require("./_helpers");

// Inline SVGs for social icons. Same set as footer-light. Outlook 2019+
// renders inline SVG; older Outlook just shows the bordered circle which
// still reads as a "social" pill.
const SOCIAL_ICONS = {
  linkedin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"/></svg>',
  facebook: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/></svg>',
  instagram: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37zM17.5 6.5h.01"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  youtube: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  tiktok: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.81a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.24z"/></svg>',
};

function renderSocialIcon(social) {
  if (!social || !social.platform) return "";
  const platform = String(social.platform).toLowerCase();
  const icon = SOCIAL_ICONS[platform];
  if (!icon) return "";
  const url = safeUrl(social.url);
  if (!url) return "";
  const label = escAttr(social.platform);

  return `<a href="${url}" aria-label="${label}" style="display:inline-block;width:36px;height:36px;border:1px solid rgba(255,255,255,0.15);border-radius:18px;text-align:center;line-height:36px;color:#94A3B8;text-decoration:none;margin:0 4px;mso-line-height-rule:exactly;">
    <span style="display:inline-block;vertical-align:middle;line-height:0;">${icon}</span>
  </a>`;
}

// Inline links row — Reply / Forward / Manage style. Separated by a
// middle-dot. Simpler than the manage-links block since these are
// interaction prompts rather than legal links.
function renderInlineLinks(links) {
  if (!Array.isArray(links) || !links.length) return "";

  const parts = links
    .map((l) => {
      if (!l || !l.label) return null;
      const label = escHtml(l.label);
      const url = safeUrl(l.url);
      if (!url) return null;
      return `<a href="${url}" style="color:#CBD5E1;text-decoration:none;font-weight:500;">${label}</a>`;
    })
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.join(' <span style="color:rgba(255,255,255,0.2);">&nbsp;·&nbsp;</span> ');
}

// Manage-links row — small, dim, underlined. Same pattern as
// footer-light's manage_links.
function renderManageLinks(links) {
  if (!Array.isArray(links) || !links.length) return "";

  const parts = links
    .map((l) => {
      if (!l || !l.label) return null;
      const label = escHtml(l.label);
      const url = safeUrl(l.url);
      if (!url) return null;
      return `<a href="${url}" style="color:#94A3B8;text-decoration:underline;">${label}</a>`;
    })
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.join(' <span style="color:rgba(255,255,255,0.2);"> · </span> ');
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  // Resolve brand-kit fallbacks. Same pattern as footer-light: section
  // props win when populated, brand kit (My Settings) fills gaps, hardcoded
  // defaults only if neither is set.
  const brandCompany = (brand && brand.COMPANY) || STATIC_BRAND.COMPANY || {};
  const brandFooter  = (brand && brand.FOOTER)  || {};
  const brandSocials = (brand && Array.isArray(brand.SOCIALS)) ? brand.SOCIALS : [];
  const brandLogo    = (brand && brand.LOGO_URL) || STATIC_BRAND.LOGO_URL || "";

  const logoText = escHtml(fallback(props.logo_text, brandCompany.name || "Travelgenix"));
  const logoUrl = safeUrl(props.logo_url || brandLogo);
  const logoLink = safeUrl(props.logo_link_url || brandCompany.url);
  const inlineLinks = Array.isArray(props.inline_links) ? props.inline_links : [];
  // Socials: same fallback rule as footer-light — section list wins
  // ONLY if it has at least one item with a real URL. Otherwise fall
  // back to brand-kit socials so an empty starter row doesn't block
  // the My Settings values from rendering.
  const propsSocialsValid = Array.isArray(props.socials)
    ? props.socials.filter(s => s && typeof s.url === "string" && s.url.trim())
    : [];
  const socials = propsSocialsValid.length > 0 ? propsSocialsValid : brandSocials;
  const manageLinks = Array.isArray(props.manage_links) ? props.manage_links : [];
  // Reason / legal pull from brand.FOOTER when section props are empty.
  const reason = props.reason
    ? escHtml(props.reason)
    : (brandFooter.reason ? escHtml(brandFooter.reason) : "");
  const legal = props.legal
    ? escHtml(props.legal)
    : ((Array.isArray(brandFooter.legalLines) && brandFooter.legalLines.length > 0)
        ? escHtml(brandFooter.legalLines.join(" \u00b7 "))
        : "");

  // Logo block — image or wordmark. White on dark.
  let logoHtml;
  if (logoUrl) {
    const imgTag = `<img src="${logoUrl}" alt="${escAttr(logoText)}" width="120" style="display:inline-block;height:auto;max-width:160px;border:0;outline:none;text-decoration:none;"/>`;
    logoHtml = logoLink
      ? `<a href="${logoLink}" style="text-decoration:none;border:0;outline:none;">${imgTag}</a>`
      : imgTag;
  } else {
    const textHtml = `<span style="font-family:${FONTS.heading};font-size:13px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;line-height:18px;">${logoText}</span>`;
    logoHtml = logoLink
      ? `<a href="${logoLink}" style="text-decoration:none;color:#ffffff;">${textHtml}</a>`
      : textHtml;
  }

  const inlineHtml = renderInlineLinks(inlineLinks);
  const socialsHtml = socials.map(renderSocialIcon).filter(Boolean).join("");
  const manageHtml = renderManageLinks(manageLinks);

  return `
<tr><td bgcolor="${DESIGN_TOKENS.primaryDark}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.primaryDark};padding:32px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
  <div style="margin:0 0 16px 0;line-height:18px;">${logoHtml}</div>
  ${inlineHtml ? `<div style="font-family:${FONTS.body};font-size:12px;line-height:18px;margin:0 0 16px 0;">${inlineHtml}</div>` : ""}
  ${socialsHtml ? `<div style="text-align:center;line-height:36px;margin:0 0 18px 0;">${socialsHtml}</div>` : ""}
  <div style="font-family:${FONTS.body};font-size:11px;color:#475569;line-height:1.6;margin:0;">
    ${reason ? `<div style="margin:0 0 4px 0;">${reason}</div>` : ""}
    ${manageHtml ? `<div style="margin:0 0 8px 0;">${manageHtml}</div>` : ""}
    ${legal ? `<div style="margin:0;">${legal}</div>` : ""}
  </div>
</td></tr>`;
}

const schema = {
  type: "footer-dark",
  label: "Footer (dark)",
  description: "Deep navy footer for product launches. Logo, optional inline links (Reply/Forward/Manage), socials, manage links, and legal meta.",
  fields: [
    { key: "logo_text", label: "Logo wordmark text (used if no image)", type: "text", optional: true, maxLength: 30, default: "Travelgenix" },
    { key: "logo_url", label: "Logo image URL", type: "url", optional: true },
    { key: "logo_link_url", label: "Logo link URL", type: "url", optional: true },
    { key: "inline_links", label: "Inline action links (e.g. Reply / Forward / Manage)", type: "array", optional: true, itemLabel: "link", itemFields: [
      { key: "label", label: "Link label", type: "text", required: true, maxLength: 20 },
      { key: "url", label: "Link URL", type: "url", required: true },
    ]},
    { key: "socials", label: "Social links", type: "array", optional: true, itemLabel: "social", itemFields: [
      { key: "platform", label: "Platform", type: "select", required: true, options: ["linkedin", "facebook", "instagram", "x", "youtube", "tiktok"] },
      { key: "url", label: "Profile URL", type: "url", required: true },
    ]},
    { key: "manage_links", label: "Manage links (preferences, unsubscribe, view in browser)", type: "array", optional: true, itemLabel: "link", itemFields: [
      { key: "label", label: "Link label", type: "text", required: true, maxLength: 30 },
      { key: "url", label: "Link URL", type: "url", required: true },
    ]},
    { key: "reason", label: "Send reason line", type: "text", optional: true, maxLength: 200 },
    { key: "legal", label: "Legal meta line", type: "text", optional: true, maxLength: 200 },
  ],
};

module.exports = { render, schema };

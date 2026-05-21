// lib/email-sections/footer-light.js
// Archetype B (Marketing) and Archetype A (B2B Weekly): light footer.
// White/light grey background with logo wordmark, tagline, optional social
// links, manage/unsubscribe/view-in-browser line, and legal meta.
//
// Sister to footer-meta (transactional, plain text only) and footer-dark
// (product launch, deep navy). This is the "everyday" marketing footer.
//
// See travelgenix-email-design SKILL.md §4 and Appendix A.2 for the
// visual reference. Uses §12 P2 for any link styling, §12 P6 conventions
// for the social icons row.

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback } = require("./_helpers");

// Hosted PNG social icons on Vercel Blob. We use hosted images instead of
// inline SVG because most email clients (Gmail, Outlook, Apple Mail web)
// strip or break inline SVG. PNGs are universally supported and the brand-
// coloured filled icons read clearly at small sizes.
//
// Source PNGs are 128px so they render crisply on retina screens at the
// rendered 28px display size (~4.5x density). Hosted permanently in the
// luna-marketing-assets Blob — these URLs do not expire.
const SOCIAL_ICONS = {
  linkedin:  "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/2b388c5e-linkedin.png",
  facebook:  "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/cc42db46-facebook.png",
  instagram: "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/5d6e7023-instagram.png",
  x:         "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/dccd2b81-twitter.png",
  youtube:   "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/44809598-youtube.png",
  tiktok:    "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/ed4d624f-tiktok.png",
};

function renderSocialIcon(social, brand) {
  // Hosted PNG approach — no need for brand colour tokens since the icons
  // are self-coloured (brand-coloured glyphs from Vercel Blob).
  if (!social || !social.platform) return "";
  const platform = String(social.platform).toLowerCase();
  const iconUrl = SOCIAL_ICONS[platform];
  if (!iconUrl) return "";
  const url = safeUrl(social.url);
  if (!url) return "";
  const label = escAttr(social.platform);

  // 28px display size, source PNGs are 128px (4.5x density — crisp on retina).
  // 12px horizontal margin between icons. white-space:nowrap on the parent
  // wrapper keeps the row aligned. mso-line-height-rule:exactly prevents
  // Outlook from adding extra vertical space.
  return `<a href="${url}" aria-label="${label}" style="display:inline-block;margin:0 6px;text-decoration:none;line-height:0;">
    <img src="${iconUrl}" alt="${label}" width="28" height="28" style="display:inline-block;width:28px;height:28px;border:0;outline:none;text-decoration:none;vertical-align:middle;">
  </a>`;
}

function renderManageLinks(links, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  if (!Array.isArray(links) || !links.length) return "";

  const parts = links
    .map((l) => {
      if (!l || !l.label) return null;
      const label = escHtml(l.label);
      const url = safeUrl(l.url);
      if (!url) return null;
      return `<a href="${url}" style="color:${DESIGN_TOKENS.textSecondary};text-decoration:underline;">${label}</a>`;
    })
    .filter(Boolean);

  if (!parts.length) return "";
  return parts.join(' <span style="color:' + DESIGN_TOKENS.textTertiary + ';"> · </span> ');
}

function render(props = {}, brand) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  // Resolve brand-kit fallbacks. Section props win when populated, brand
  // kit fills gaps (sourced from My Settings → Footer & Legal), hardcoded
  // defaults only if neither is set.
  const brandCompany = (brand && brand.COMPANY) || STATIC_BRAND.COMPANY || {};
  const brandFooter  = (brand && brand.FOOTER)  || {};
  const brandSocials = (brand && Array.isArray(brand.SOCIALS)) ? brand.SOCIALS : [];
  const brandLogo    = (brand && brand.LOGO_URL) || STATIC_BRAND.LOGO_URL || "";

  const logoText = escHtml(fallback(props.logo_text, brandCompany.name || "Travelgenix"));
  const logoUrl = safeUrl(props.logo_url || brandLogo);
  const logoLink = safeUrl(props.logo_link_url || brandCompany.url);
  const tagline = props.tagline ? escHtml(props.tagline) : "";
  // Socials: section's list wins ONLY if it contains at least one item
  // with a real URL — otherwise fall back to brand-kit socials. This
  // matters because the array-field editor seeds an empty starter row
  // (e.g. {platform: 'linkedin', url: ''}) which is not truly populated
  // but would otherwise prevent the brand-kit fallback from firing.
  const propsSocialsValid = Array.isArray(props.socials)
    ? props.socials.filter(s => s && typeof s.url === "string" && s.url.trim())
    : [];
  const socials = propsSocialsValid.length > 0 ? propsSocialsValid : brandSocials;
  const manageLinks = Array.isArray(props.manage_links) ? props.manage_links : [];
  // Reason / legal pull from brand.FOOTER when section props are empty.
  // Legal is joined from the lines array into a single inline string for
  // this footer style (the multi-line treatment lives in footer-meta).
  const reason = props.reason
    ? escHtml(props.reason)
    : (brandFooter.reason ? escHtml(brandFooter.reason) : "");
  const legal = props.legal
    ? escHtml(props.legal)
    : ((Array.isArray(brandFooter.legalLines) && brandFooter.legalLines.length > 0)
        ? escHtml(brandFooter.legalLines.join(" \u00b7 "))
        : "");

  // Logo: image takes precedence over text wordmark if both supplied.
  // Display width 180px (was 120) with max-width 240px — reads cleanly
  // in the footer without being so small it looks like an afterthought.
  let logoHtml;
  if (logoUrl) {
    const imgTag = `<img src="${logoUrl}" alt="${escAttr(logoText)}" width="180" style="display:inline-block;height:auto;max-width:240px;border:0;outline:none;text-decoration:none;"/>`;
    logoHtml = logoLink
      ? `<a href="${logoLink}" style="text-decoration:none;border:0;outline:none;">${imgTag}</a>`
      : imgTag;
  } else {
    const textHtml = `<span style="font-family:${FONTS.heading};font-size:14px;font-weight:700;letter-spacing:-0.02em;color:${DESIGN_TOKENS.primary};line-height:20px;">${logoText}</span>`;
    logoHtml = logoLink
      ? `<a href="${logoLink}" style="text-decoration:none;color:${DESIGN_TOKENS.primary};">${textHtml}</a>`
      : textHtml;
  }

  const socialsHtml = socials.map(d => renderSocialIcon(d, brand)).filter(Boolean).join("");
  const manageHtml = renderManageLinks(manageLinks, brand);

  return `
<tr><td bgcolor="${DESIGN_TOKENS.bgSecondary}" class="tg-pad-mobile" align="center" style="background-color:${DESIGN_TOKENS.bgSecondary};padding:40px 32px 32px;text-align:center;">
  <div style="margin:0 0 12px 0;line-height:20px;">${logoHtml}</div>
  ${tagline ? `<div style="font-family:${FONTS.body};font-size:13px;color:${DESIGN_TOKENS.textSecondary};line-height:21px;margin:0 auto 24px auto;max-width:360px;">${tagline}</div>` : `<div style="height:20px;line-height:20px;font-size:20px;">&nbsp;</div>`}
  ${socialsHtml ? `<div style="text-align:center;line-height:36px;margin:0 0 24px 0;">${socialsHtml}</div>` : ""}
  <div style="font-family:${FONTS.body};font-size:11px;color:${DESIGN_TOKENS.textTertiary};line-height:18px;margin:0;">
    ${reason ? `<div style="margin:0 0 4px 0;">${reason}</div>` : ""}
    ${manageHtml ? `<div style="margin:0 0 8px 0;">${manageHtml}</div>` : ""}
    ${legal ? `<div style="margin:0;">${legal}</div>` : ""}
  </div>
</td></tr>`;
}

const schema = {
  type: "footer-light",
  label: "Footer (light)",
  description: "Light grey marketing footer with logo wordmark, tagline, social icons, manage links, and legal meta. For marketing newsletters and B2B Weekly.",
  fields: [
    { key: "logo_text", label: "Logo wordmark text (used if no logo image)", type: "text", optional: true, maxLength: 30, default: "Travelgenix" },
    { key: "logo_url", label: "Logo image URL", type: "url", optional: true },
    { key: "logo_link_url", label: "Logo link URL", type: "url", optional: true },
    { key: "tagline", label: "Tagline", type: "longText", optional: true, maxLength: 200 },
    { key: "socials", label: "Social links", type: "array", optional: true, itemSchema: {
      platform: { type: "select", options: ["linkedin", "facebook", "instagram", "x", "youtube", "tiktok"], required: true },
      url: { type: "url", required: true },
    }},
    { key: "manage_links", label: "Manage links (e.g. Update preferences, Unsubscribe, View in browser)", type: "array", optional: true, itemSchema: {
      label: { type: "text", required: true, maxLength: 30 },
      url: { type: "url", required: true },
    }},
    { key: "reason", label: "Send reason line", type: "text", optional: true, maxLength: 200 },
    { key: "legal", label: "Legal meta (e.g. \"Travelgenix Ltd · Bournemouth, UK · Co. #12781046\")", type: "text", optional: true, maxLength: 200 },
  ],
};

module.exports = { render, schema };

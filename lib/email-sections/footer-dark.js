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

// Hosted PNG social icons on Vercel Blob. Same set + URLs as footer-light.
// Email clients reliably render hosted images; inline SVG is stripped by
// most clients (Gmail, Outlook web, Apple Mail web). PNGs are 128px source
// rendered at 28px display for retina sharpness.
const SOCIAL_ICONS = {
  linkedin:  "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/2b388c5e-linkedin.png",
  facebook:  "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/cc42db46-facebook.png",
  instagram: "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/5d6e7023-instagram.png",
  x:         "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/dccd2b81-twitter.png",
  youtube:   "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/44809598-youtube.png",
  tiktok:    "https://vpedbzseh2tx8dub.public.blob.vercel-storage.com/email-images/2026-05-21/ed4d624f-tiktok.png",
};

function renderSocialIcon(social) {
  if (!social || !social.platform) return "";
  const platform = String(social.platform).toLowerCase();
  const iconUrl = SOCIAL_ICONS[platform];
  if (!iconUrl) return "";
  const url = safeUrl(social.url);
  if (!url) return "";
  const label = escAttr(social.platform);

  return `<a href="${url}" aria-label="${label}" style="display:inline-block;margin:0 6px;text-decoration:none;line-height:0;">
    <img src="${iconUrl}" alt="${label}" width="28" height="28" style="display:inline-block;width:28px;height:28px;border:0;outline:none;text-decoration:none;vertical-align:middle;">
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
// Brevo merge tag fallback for legally-required links. See footer-light.js
// for the full reasoning. Briefly: {{ unsubscribe }} and {{ mirror }} are
// Brevo template language placeholders, replaced per-recipient at send.
function defaultUrlForLabel(label) {
  if (!label) return "";
  const norm = String(label).toLowerCase().trim();
  if (/(^|\s)unsub(scribe)?(\s|$)/.test(norm) || /(opt[\-\s]?out)/.test(norm)) {
    return "{{ unsubscribe }}";
  }
  if (/view.*(in|on).*(browser|web)/.test(norm) || /(open|read).*(in|on).*(browser|web)/.test(norm)) {
    return "{{ mirror }}";
  }
  return "";
}

function renderManageLinks(links) {
  // Always emit at least an unsubscribe link — legal requirement for
  // marketing emails (UK GDPR, CAN-SPAM, CASL).
  const safeLinks = Array.isArray(links) ? links : [];
  const hasUnsub = safeLinks.some((l) =>
    l && l.label && /(^|\s)unsub(scribe)?(\s|$)|opt[\-\s]?out/.test(String(l.label).toLowerCase().trim())
  );
  const workingList = hasUnsub
    ? safeLinks
    : [...safeLinks, { label: "Unsubscribe", url: "" }];

  const parts = workingList
    .map((l) => {
      if (!l || !l.label) return null;
      const label = escHtml(l.label);
      // See footer-light renderManageLinks for the URL resolution order.
      let url = "";
      const rawUrl = l.url ? String(l.url).trim() : "";
      if (/^\{\{\s*(unsubscribe|mirror|update_profile|update_preferences)\s*\}\}$/.test(rawUrl)) {
        url = rawUrl;
      } else {
        url = safeUrl(l.url);
        if (!url) {
          const fallback = defaultUrlForLabel(l.label);
          if (fallback) url = fallback;
        }
      }
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
    const imgTag = `<img src="${logoUrl}" alt="${escAttr(logoText)}" width="180" style="display:inline-block;height:auto;max-width:240px;border:0;outline:none;text-decoration:none;"/>`;
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

// lib/email-sections/footer.js
// Legacy footer section — predates the design-system footers (footer-light,
// footer-dark, footer-meta). Still used by defaultStarterSections() in the
// client portal builder, and by older saved drafts.
//
// May 2026 update — accepts the optional `brand` arg so client My Settings
// flow through. Standard fallback pattern: section props win when populated,
// brand kit fills gaps, hardcoded BRAND/COMPANY are last resort.
const STATIC_BRAND = require("../email-brand");
const { BRAND, FONTS, COMPANY } = STATIC_BRAND;
const { escHtml, safeUrl } = require("./_helpers");

function render(props = {}, brand) {
  // Resolve the brand-kit-aware tokens. Falls back to the static module
  // exports when brand isn't passed (legacy callers, preview-render).
  const brandCompany = (brand && brand.COMPANY) || COMPANY;
  const brandFooter  = (brand && brand.FOOTER)  || {};
  const brandSocials = (brand && Array.isArray(brand.SOCIALS)) ? brand.SOCIALS : [];

  // Standard fallback chain: section prop > brand kit > hardcoded default
  const companyName    = escHtml(props.companyName    || brandCompany.name || COMPANY.name);
  const companyAddress = escHtml(props.companyAddress || brandFooter.companyAddress || brandCompany.address || COMPANY.address);
  const tagline        = props.tagline ? escHtml(props.tagline) : "";

  // Social links: section's socialLinks wins, else brand kit's SOCIALS array
  const socialLinksRaw = (Array.isArray(props.socialLinks) && props.socialLinks.length > 0)
    ? props.socialLinks
    : brandSocials;

  let socialHtml = "";
  if (Array.isArray(socialLinksRaw) && socialLinksRaw.length > 0) {
    const items = socialLinksRaw
      .map((l) => {
        const url = safeUrl(l.url);
        const platform = (l.platform || "").toLowerCase();
        const label = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (!url || !platform) return "";
        return `<a href="${url}" style="color:${BRAND.inkSoft};text-decoration:none;margin:0 8px;font-size:13px;font-family:${FONTS.body};">${escHtml(label)}</a>`;
      })
      .filter(Boolean)
      .join(" &middot; ");
    if (items) {
      socialHtml = `<div style="font-family:${FONTS.body};font-size:13px;color:${BRAND.inkSoft};line-height:20px;text-align:center;margin:0 0 12px 0;">${items}</div>`;
    }
  }

  const showUnsub = props.showUnsub !== false;

  // Render the unsubscribe / opt-in line. When brand.FOOTER.reason is set,
  // use it as the explanation (per-client wording). Otherwise fall back to
  // the generic "You're receiving this because you opted in to {company}".
  const optInReason = brandFooter.reason
    ? escHtml(brandFooter.reason)
    : `You're receiving this because you opted in to ${companyName} updates.`;
  const brandUrl = brandCompany.url || COMPANY.url;
  const unsubLine = showUnsub
    ? `${optInReason}<br><a href="{{UNSUB_URL}}" style="color:${BRAND.inkSoft};text-decoration:underline;">Unsubscribe</a> &middot; <a href="${brandUrl}" style="color:${BRAND.inkSoft};text-decoration:underline;">Visit ${companyName}</a>`
    : `&copy; ${new Date().getFullYear()} ${companyName}`;

  // Optional legal lines block — joined into one space-separated line below
  // the address. Renders only if brand kit supplies legalLines and there's
  // no per-section override that already includes them.
  const legalLineHtml = (Array.isArray(brandFooter.legalLines) && brandFooter.legalLines.length > 0)
    ? `<div style="font-family:${FONTS.body};font-size:11px;color:${BRAND.inkLight};line-height:16px;text-align:center;margin:6px 0 0 0;">${escHtml(brandFooter.legalLines.join(" \u00b7 "))}</div>`
    : "";

  let inner = "";
  if (tagline) {
    inner += `<div style="font-family:${FONTS.heading};font-size:14px;font-weight:600;color:${BRAND.ink};line-height:20px;text-align:center;margin:0 0 8px 0;">${tagline}</div>`;
  }
  inner += socialHtml;
  inner += `<div style="font-family:${FONTS.body};font-size:12px;color:${BRAND.inkMuted};line-height:20px;text-align:center;margin:0 0 8px 0;">${unsubLine}</div>`;
  inner += `<div style="font-family:${FONTS.body};font-size:11px;color:${BRAND.inkLight};line-height:16px;text-align:center;margin:0;">${companyAddress}</div>`;
  inner += legalLineHtml;

  return `
<tr><td bgcolor="${BRAND.paper}" class="tg-pad-mobile" align="center" style="background-color:${BRAND.paper};padding:32px 32px;text-align:center;">${inner}</td></tr>`;
}

const schema = {
  type: "footer",
  label: "Footer",
  description: "Company info, unsubscribe link, address (compliance required). Empty fields fall back to your My Settings → Footer & Legal.",
  fields: [
    { key: "companyName", label: "Company name (overrides My Settings)", type: "text", optional: true,
      default: COMPANY.name },
    { key: "companyAddress", label: "Postal address (overrides My Settings)", type: "text", optional: true,
      default: COMPANY.address },
    { key: "tagline", label: "Tagline", type: "text", optional: true, maxLength: 80 },
    { key: "socialLinks", label: "Social links (overrides My Settings)", type: "linkList", optional: true, max: 4 },
    { key: "showUnsub", label: "Show unsubscribe link", type: "boolean", default: true,
      help: "Required for marketing emails. Only disable for transactional." },
  ],
};

module.exports = { render, schema };

// lib/email-sections/footer.js
const { BRAND, FONTS, COMPANY } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");

function render(props = {}) {
  const companyName = escHtml(props.companyName || COMPANY.name);
  const companyAddress = escHtml(props.companyAddress || COMPANY.address);
  const tagline = props.tagline ? escHtml(props.tagline) : "";

  let socialHtml = "";
  if (Array.isArray(props.socialLinks) && props.socialLinks.length > 0) {
    const items = props.socialLinks
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
  const unsubLine = showUnsub
    ? `You're receiving this because you opted in to ${companyName} updates.<br><a href="{{UNSUB_URL}}" style="color:${BRAND.inkSoft};text-decoration:underline;">Unsubscribe</a> &middot; <a href="${COMPANY.url}" style="color:${BRAND.inkSoft};text-decoration:underline;">Visit ${companyName}</a>`
    : `&copy; ${new Date().getFullYear()} ${companyName}`;

  let inner = "";
  if (tagline) {
    inner += `<div style="font-family:${FONTS.heading};font-size:14px;font-weight:600;color:${BRAND.ink};line-height:20px;text-align:center;margin:0 0 8px 0;">${tagline}</div>`;
  }
  inner += socialHtml;
  inner += `<div style="font-family:${FONTS.body};font-size:12px;color:${BRAND.inkMuted};line-height:20px;text-align:center;margin:0 0 8px 0;">${unsubLine}</div>`;
  inner += `<div style="font-family:${FONTS.body};font-size:11px;color:${BRAND.inkLight};line-height:16px;text-align:center;margin:0;">${companyAddress}</div>`;

  return `
<tr><td bgcolor="${BRAND.paper}" class="tg-pad-mobile" align="center" style="background-color:${BRAND.paper};padding:32px 32px;text-align:center;">${inner}</td></tr>`;
}

const schema = {
  type: "footer",
  label: "Footer",
  description: "Company info, unsubscribe link, address (compliance required)",
  fields: [
    { key: "companyName", label: "Company name", type: "text", optional: true,
      default: COMPANY.name },
    { key: "companyAddress", label: "Postal address", type: "text", optional: true,
      default: COMPANY.address },
    { key: "tagline", label: "Tagline", type: "text", optional: true, maxLength: 80 },
    { key: "socialLinks", label: "Social links", type: "linkList", optional: true, max: 4 },
    { key: "showUnsub", label: "Show unsubscribe link", type: "boolean", default: true,
      help: "Required for marketing emails. Only disable for transactional." },
  ],
};

module.exports = { render, schema };

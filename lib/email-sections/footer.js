// lib/email-sections/footer.js
// Footer with company info and unsub link. Required for compliance.
// The unsub URL is INJECTED by the renderer using {{UNSUB_URL}} placeholder
// — never set directly. This ensures every email has a valid unsub link.

const { BRAND, FONTS, COMPANY } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");

/**
 * Schema:
 *   companyName?: string
 *   companyAddress?: string
 *   tagline?: string
 *   socialLinks?: Array<{ platform: 'twitter'|'linkedin'|'facebook'|'instagram', url: string }>
 *   showUnsub?: boolean  (default true — must stay true for compliance)
 */
function render(props = {}) {
  const companyName = escHtml(props.companyName || COMPANY.name);
  const companyAddress = escHtml(props.companyAddress || COMPANY.address);
  const tagline = props.tagline ? escHtml(props.tagline) : "";

  // Social links
  let socialHtml = "";
  if (Array.isArray(props.socialLinks) && props.socialLinks.length > 0) {
    const items = props.socialLinks
      .map((l) => {
        const url = safeUrl(l.url);
        const platform = (l.platform || "").toLowerCase();
        const label = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (!url || !platform) return "";
        return `<a href="${url}" style="color:${BRAND.inkSoft};text-decoration:none;margin:0 8px;font-size:13px">${escHtml(label)}</a>`;
      })
      .filter(Boolean)
      .join(" · ");

    if (items) {
      socialHtml = `
        <mj-text
          font-family="${FONTS.body}"
          font-size="13px"
          color="${BRAND.inkSoft}"
          line-height="20px"
          align="center"
          padding="0 0 12px 0"
        >${items}</mj-text>`;
    }
  }

  // Unsub line uses placeholder {{UNSUB_URL}} that the renderer replaces.
  // showUnsub=false is allowed for transactional/system emails only — but
  // the renderer enforces the policy that marketing emails always have it.
  const showUnsub = props.showUnsub !== false;
  const unsubLine = showUnsub
    ? `You're receiving this because you opted in to ${companyName} updates.<br>
       <a href="{{UNSUB_URL}}" style="color:${BRAND.inkSoft};text-decoration:underline">Unsubscribe</a>
       &nbsp;·&nbsp;
       <a href="${COMPANY.url}" style="color:${BRAND.inkSoft};text-decoration:underline">Visit ${companyName}</a>`
    : `&copy; ${new Date().getFullYear()} ${companyName}`;

  return `
    <mj-section background-color="${BRAND.paper}" padding="32px 32px">
      <mj-column>
        ${tagline ? `<mj-text
          font-family="${FONTS.heading}"
          font-size="14px"
          font-weight="600"
          color="${BRAND.ink}"
          line-height="20px"
          align="center"
          padding="0 0 8px 0"
        >${tagline}</mj-text>` : ""}
        ${socialHtml}
        <mj-text
          font-family="${FONTS.body}"
          font-size="12px"
          color="${BRAND.inkMuted}"
          line-height="20px"
          align="center"
          padding="0 0 8px 0"
        >${unsubLine}</mj-text>
        <mj-text
          font-family="${FONTS.body}"
          font-size="11px"
          color="${BRAND.inkLight}"
          line-height="16px"
          align="center"
          padding="0"
        >${companyAddress}</mj-text>
      </mj-column>
    </mj-section>`;
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

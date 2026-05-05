// lib/email-sections/header.js
const { BRAND, LOGO_URL, FONTS } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");

function render(props = {}) {
  const logoUrl = safeUrl(props.logoUrl) || LOGO_URL;
  const logoAlt = escHtml(props.logoAlt || "Travelgenix");
  const logoLink = safeUrl(props.logoLinkUrl) || "https://travelgenix.io";

  let navHtml = "";
  if (Array.isArray(props.navLinks) && props.navLinks.length > 0) {
    const items = props.navLinks
      .slice(0, 4)
      .map((l) => {
        const url = safeUrl(l.url);
        const label = escHtml(l.label || "");
        if (!url || !label) return "";
        return `<a href="${url}" style="color:${BRAND.inkSoft};text-decoration:none;margin:0 12px;font-size:13px;font-family:${FONTS.body};">${label}</a>`;
      })
      .filter(Boolean)
      .join("");
    if (items) {
      navHtml = `
<tr><td bgcolor="${BRAND.surface}" align="center" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:0 24px 16px 24px;font-family:${FONTS.body};font-size:13px;color:${BRAND.inkSoft};line-height:20px;">${items}</td></tr>`;
    }
  }

  return `
<tr><td bgcolor="${BRAND.surface}" align="center" class="tg-pad-mobile" style="background-color:${BRAND.surface};padding:32px 24px 16px 24px;">
<a href="${logoLink}" style="text-decoration:none;border:0;outline:none;"><img src="${logoUrl}" alt="${logoAlt}" width="180" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;height:auto;max-width:180px;"></a>
</td></tr>${navHtml}`;
}

const schema = {
  type: "header",
  label: "Header",
  description: "Logo at top of email with optional nav links",
  fields: [
    { key: "logoUrl", label: "Logo URL", type: "url", optional: true },
    { key: "logoAlt", label: "Logo alt text", type: "text", optional: true, default: "Travelgenix" },
    { key: "logoLinkUrl", label: "Logo link", type: "url", optional: true, default: "https://travelgenix.io" },
    { key: "navLinks", label: "Nav links (max 4)", type: "linkList", optional: true, max: 4 },
  ],
};

module.exports = { render, schema };

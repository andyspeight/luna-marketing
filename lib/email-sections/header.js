// lib/email-sections/header.js
// Top-of-email header. Logo centred, optional small nav links underneath.

const { BRAND, LOGO_URL } = require("../email-brand");
const { escHtml, safeUrl } = require("./_helpers");

/**
 * Schema:
 *   logoUrl?: string (defaults to Travelgenix logo)
 *   logoAlt?: string (defaults to "Travelgenix")
 *   logoLinkUrl?: string (where the logo links to, defaults to travelgenix.io)
 *   navLinks?: Array<{ label: string, url: string }>  (optional, max 4)
 */
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
        return `<a href="${url}" style="color:${BRAND.inkSoft};text-decoration:none;margin:0 12px;font-size:13px">${label}</a>`;
      })
      .filter(Boolean)
      .join("");

    if (items) {
      navHtml = `
        <mj-section background-color="${BRAND.surface}" padding="0 24px 16px 24px">
          <mj-column>
            <mj-text align="center" font-size="13px" color="${BRAND.inkSoft}" line-height="20px">
              ${items}
            </mj-text>
          </mj-column>
        </mj-section>`;
    }
  }

  return `
    <mj-section background-color="${BRAND.surface}" padding="32px 24px 16px 24px">
      <mj-column>
        <mj-image
          src="${logoUrl}"
          alt="${logoAlt}"
          href="${logoLink}"
          width="180px"
          align="center"
          padding="0"
        />
      </mj-column>
    </mj-section>${navHtml}
  `;
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

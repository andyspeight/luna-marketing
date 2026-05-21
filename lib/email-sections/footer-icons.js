// lib/email-sections/footer-icons.js
//
// A Daily-Beacon-style footer with a row of circular icons (phone, email,
// location, website) followed by manage links and a centred legal block.
// Sister to `footer-light` (lighter, more conventional) and `footer-dark`
// (inverted dark). Use this when you want a clean, editorial feel.
//
// What it accepts:
//   icons             — array of { type, url } where type is 'phone'|'email'|'location'|'website'
//                       Defaults to brand-kit values (phone, replyToEmail, address, websiteUrl)
//   manage_links      — array of { label, url } for preferences/unsubscribe/etc
//   reason            — sending reason line (falls back to brand FOOTER.reason)
//   address           — postal address (falls back to brand FOOTER.companyAddress)
//   company_meta      — Company number / VAT meta (falls back to brand FOOTER.legalLines)
//   copyright         — © line text (falls back to brand COMPANY.name with year)
//   icon_colour       — circle fill colour (default #000000 Daily Beacon)
//   icon_text_colour  — icon glyph colour (default #FFFFFF)
//   background_colour — outer section bg (default transparent)
//
// Layout:
//   [ ⊙ ] [ ⊙ ] [ ⊙ ] [ ⊙ ]    ← circle icons row, centred
//   Manage links (underlined)
//   Address line
//   Company meta line
//   © line

const STATIC_BRAND = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback } = require("./_helpers");

function safeHex(value) {
  if (typeof value !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

// SVG glyph for each icon type. Sized to fit inside a 40px circle with
// roughly 14px visual size. Kept as embedded data URIs so they render in
// Gmail, Outlook, Apple Mail, etc. without external image hosting.
// Trade-off: each glyph is ~200 bytes inline. Cumulative ~1KB for 4 icons.
const ICON_SVGS = {
  phone: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>',
  email: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  location: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  website: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>',
};

function render(props = {}, brand) {
  const effectiveBrand = brand || STATIC_BRAND;
  const { DESIGN_TOKENS, FONTS, COMPANY } = effectiveBrand;
  const brandFooter = (brand && brand.FOOTER) || {};

  const iconColour = safeHex(props.icon_colour) || "#000000";
  const iconTextColour = safeHex(props.icon_text_colour) || "#FFFFFF";
  const bgColour = safeHex(props.background_colour);

  // Build the icons row. If user supplied an icons array, use that.
  // Otherwise auto-build from brand kit (phone/email/location/website).
  const userIcons = Array.isArray(props.icons) ? props.icons : null;
  let icons;
  if (userIcons && userIcons.length > 0) {
    icons = userIcons
      .filter(i => i && i.type && ICON_SVGS[i.type])
      .map(i => ({ type: i.type, url: safeUrl(i.url) || (i.type === "phone" && brandFooter.supportPhoneRaw ? `tel:${brandFooter.supportPhoneRaw}` : "") }))
      .filter(i => i.url);
  } else {
    // Auto-build from brand kit. Skip any icon without a destination.
    const auto = [
      { type: "phone", url: brandFooter.supportPhoneRaw ? `tel:${brandFooter.supportPhoneRaw}` : "" },
      { type: "email", url: COMPANY && COMPANY.supportEmail ? `mailto:${COMPANY.supportEmail}` : "" },
      { type: "location", url: "" },  // Location has no natural URL; suppressed unless overridden
      { type: "website", url: COMPANY && COMPANY.url ? COMPANY.url : "" },
    ];
    icons = auto.filter(i => i.url);
  }

  // Each icon cell. The circle is achieved with a square table cell that
  // uses border-radius:50%. Outlook strips border-radius from divs but
  // honours it (mostly) on table cells. Email-safe enough — worst case
  // Outlook shows a square, still recognisable.
  const renderIcon = (icon) => {
    const svg = ICON_SVGS[icon.type] || "";
    // Inline svg colour via fill on stroke currentColor — wrap in a div
    // that sets colour so the SVG inherits it.
    const glyph = svg
      ? `<div style="color:${iconTextColour};line-height:0;">${svg}</div>`
      : "";
    return `
      <td align="center" valign="middle" width="48" style="padding:0 6px;">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td width="40" height="40" align="center" valign="middle" bgcolor="${iconColour}" style="width:40px;height:40px;background-color:${iconColour};border-radius:50%;">
              <a href="${icon.url}" style="display:inline-block;text-decoration:none;color:${iconTextColour};">${glyph}</a>
            </td>
          </tr>
        </table>
      </td>`;
  };

  const iconsRowHtml = icons.length > 0
    ? `<tr>
        <td align="center" style="padding:0 0 18px 0;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0">
            <tr>${icons.map(renderIcon).join("")}</tr>
          </table>
        </td>
      </tr>`
    : "";

  // Manage links — small underlined links, centred.
  const manageLinks = Array.isArray(props.manage_links) ? props.manage_links.filter(l => l && l.label && l.url) : [];
  const manageLinksHtml = manageLinks.length > 0
    ? `<tr>
        <td align="center" style="padding:0 0 10px 0;">
          <p style="font-family:${FONTS.body};font-size:12px;color:${DESIGN_TOKENS.textSecondary || "#666666"};line-height:18px;margin:0;">
            ${manageLinks.map(l => `<a href="${safeUrl(l.url)}" style="color:${DESIGN_TOKENS.textSecondary || "#666666"};text-decoration:underline;">${escHtml(l.label)}</a>`).join(' <span style="color:#CCCCCC;">·</span> ')}
          </p>
        </td>
      </tr>`
    : "";

  // Address — section override wins, else brand FOOTER.companyAddress
  const address = props.address || brandFooter.companyAddress || "";
  const addressHtml = address
    ? `<tr><td align="center" style="padding:6px 0 0 0;"><p style="font-family:${FONTS.body};font-size:11px;color:${DESIGN_TOKENS.textTertiary || "#888888"};line-height:16px;margin:0;">${escHtml(address)}</p></td></tr>`
    : "";

  // Company meta — section override wins, else first FOOTER.legalLines entry
  const companyMeta = props.company_meta
    || (Array.isArray(brandFooter.legalLines) && brandFooter.legalLines.length > 0 ? brandFooter.legalLines.join(" · ") : "");
  const companyMetaHtml = companyMeta
    ? `<tr><td align="center" style="padding:2px 0 0 0;"><p style="font-family:${FONTS.body};font-size:11px;color:${DESIGN_TOKENS.textTertiary || "#888888"};line-height:16px;margin:0;">${escHtml(companyMeta)}</p></td></tr>`
    : "";

  // Copyright — section override wins, else "© YEAR Brand Name"
  const year = new Date().getFullYear();
  const copyright = props.copyright || `© ${year} ${(COMPANY && COMPANY.name) || "Travelgenix"}`;
  const copyrightHtml = `<tr><td align="center" style="padding:2px 0 0 0;"><p style="font-family:${FONTS.body};font-size:11px;color:${DESIGN_TOKENS.textTertiary || "#888888"};line-height:16px;margin:0;">${escHtml(copyright)}</p></td></tr>`;

  const outerBg = bgColour ? `bgcolor="${bgColour}"` : "";
  const outerStyle = bgColour
    ? `background-color:${bgColour};padding:32px 36px 36px 36px;`
    : `padding:32px 36px 36px 36px;`;

  return `
<tr><td ${outerBg} class="tg-pad-mobile" style="${outerStyle}">
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
    ${iconsRowHtml}
    ${manageLinksHtml}
    ${addressHtml}
    ${companyMetaHtml}
    ${copyrightHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "footer-icons",
  label: "Footer (icon circles)",
  description: "Daily-Beacon-style footer with circle icons (phone/email/location/website), manage links, address, company meta and copyright line. Icons auto-build from My Settings if not specified. Use for sophisticated marketing emails.",
  fields: [
    { key: "icons", label: "Icons (leave empty to auto-build from My Settings)", type: "array", itemLabel: "icon", itemFields: [
      { key: "type", label: "Icon type", type: "select", required: true, options: ["phone", "email", "location", "website"] },
      { key: "url", label: "Destination URL (or tel:/mailto:)", type: "url", required: true },
    ]},
    { key: "manage_links", label: "Manage links (preferences, unsubscribe, view in browser)", type: "array", itemLabel: "link", itemFields: [
      { key: "label", label: "Link label", type: "text", required: true, maxLength: 40 },
      { key: "url", label: "Link URL", type: "url", required: true },
    ]},
    { key: "address", label: "Address (overrides My Settings)", type: "text", optional: true, maxLength: 200 },
    { key: "company_meta", label: "Company meta line (overrides My Settings → Footer legal)", type: "text", optional: true, maxLength: 200 },
    { key: "copyright", label: "Copyright line (defaults to © YEAR Brand Name)", type: "text", optional: true, maxLength: 80 },
    { key: "icon_colour", label: "Icon circle colour", type: "colour", optional: true, defaultPreview: "#000000", placeholder: "#000000", help: "Daily Beacon default is black. Try your brand primary." },
    { key: "icon_text_colour", label: "Icon glyph colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "#FFFFFF" },
    { key: "background_colour", label: "Footer background colour (optional)", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for transparent" },
  ],
};

module.exports = { render, schema };

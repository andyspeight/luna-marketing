// lib/email-sections/hero-dark.js
// Archetype C (Product Launch): the dark mesh-gradient hero.
// Deep navy background with radial-gradient "glow" layers (mesh effect)
// in modern clients; flat #0A0F1F navy in Outlook. Big bold headline
// (52px, -0.04em letter-spacing) where one word can be italicised and
// rendered with a teal gradient text fill (modern clients) or solid
// teal #48CAE4 (Outlook). Optional "new launch" badge in the top nav
// row (text-only in Outlook, no pulsing dot animation). Up to two CTA
// buttons in a horizontal group: solid teal primary, ghost-bordered
// secondary.
//
// See travelgenix-email-design SKILL.md §4, §12.2 P4 (dark hero with
// gradient backdrop), §12.2 P2 (bulletproof CTA), §12.2 P8 (animations
// strip in Outlook), §12.3 (Archetype C checklist).
//
// Outlook patterns used:
//   - P4 dark hero: flat dark navy bgcolor, no mesh, no gradient text
//     fill on the accent word (falls back to solid #48CAE4)
//   - P2 bulletproof CTAs for both primary and secondary buttons
//   - P8 animation graceful strip: pulsing badge dot becomes a static
//     teal dot; no @keyframes survives Outlook
//   - Logo mark uses bgcolor (no backdrop-filter / blur)

const { DESIGN_TOKENS, FONTS } = require("../email-brand");
const { escHtml, escAttr, safeUrl, fallback } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

// Render the optional top nav row: logo mark + name on the left, "New
// launch" badge on the right. Both are optional. Uses a 2-cell table
// for the row layout (P6 conventions).
function renderHeroNav(props) {
  const logoText = escHtml(fallback(props.logo_text, ""));
  const logoMark = escHtml(fallback(props.logo_mark, "")).slice(0, 2);
  const logoLink = safeUrl(props.logo_link_url);
  const badgeText = escHtml(fallback(props.badge_text, ""));
  const showBadge = !!badgeText;

  if (!logoText && !logoMark && !showBadge) return "";

  // Logo: small bordered tile + wordmark side by side. Tile bgcolor is
  // the accent teal at low alpha; we approximate the rgba by using a
  // flat bgcolor that's close to the visible blend on dark navy.
  const logoHtml = (logoText || logoMark) ? `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0">
      <tr>
        ${logoMark ? `
        <td valign="middle" style="padding-right:10px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="26">
            <tr>
              <td bgcolor="#1A2540" align="center" valign="middle" width="26" height="26" style="background-color:#1A2540;border-radius:7px;border:1px solid rgba(255,255,255,0.18);font-family:${FONTS.body};font-size:13px;font-weight:800;color:#ffffff;line-height:26px;width:26px;height:26px;mso-line-height-rule:exactly;">${logoMark}</td>
            </tr>
          </table>
        </td>` : ""}
        ${logoText ? `<td valign="middle" style="font-family:${FONTS.body};font-size:14px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;line-height:26px;">${logoText}</td>` : ""}
      </tr>
    </table>` : "";

  const wrappedLogo = logoLink && logoHtml
    ? `<a href="${logoLink}" style="text-decoration:none;color:#ffffff;display:inline-block;">${logoHtml}</a>`
    : logoHtml;

  // Badge: a pill with a teal dot and uppercase label. Outlook gets a
  // static dot (no pulse animation, see §12.2 P8).
  const badgeHtml = showBadge ? `
    <table role="presentation" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td bgcolor="#11324A" valign="middle" style="background-color:#11324A;border:1px solid #1F5673;border-radius:999px;padding:6px 12px;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td valign="middle" style="padding-right:6px;line-height:0;">
                <span style="display:inline-block;width:6px;height:6px;background:${DESIGN_TOKENS.accent};border-radius:3px;line-height:6px;font-size:6px;mso-line-height-rule:exactly;">&nbsp;</span>
              </td>
              <td valign="middle" style="font-family:${FONTS.body};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${DESIGN_TOKENS.accentLight};line-height:14px;">${badgeText}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>` : "";

  // Nav row: logo left, badge right. Single row of a 2-column table so
  // Outlook honours the layout. If only one side is set, the other cell
  // is empty but reserves the column width.
  return `
<tr>
  <td style="padding:0 0 56px 0;">
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%">
      <tr>
        <td valign="middle" align="left">${wrappedLogo}</td>
        <td valign="middle" align="right">${badgeHtml}</td>
      </tr>
    </table>
  </td>
</tr>`;
}

// Render the headline. The accent word(s) may be marked by wrapping in
// `*...*` (single asterisks). The accent portion gets italic + teal in
// modern clients (text-fill gradient is stripped in Outlook so we use
// a solid teal fallback in both branches; the gradient is purely a
// modern-client garnish). Plain `*` and `**` not surrounded by word
// boundaries are escaped through normal HTML escaping.
function renderHeadline(headline) {
  if (!headline) return "";
  const parts = String(headline).split(/(\*[^*]+\*)/g);
  return parts
    .map((p) => {
      const m = p.match(/^\*([^*]+)\*$/);
      if (m) {
        return `<em style="font-style:italic;color:${DESIGN_TOKENS.accentLight};font-weight:800;">${escHtml(m[1])}</em>`;
      }
      return escHtml(p);
    })
    .join("");
}

function render(props = {}) {
  const eyebrow = escHtml(fallback(props.eyebrow, "")).trim();
  const headlineHtml = renderHeadline(props.headline);
  const deck = props.deck ? escHtml(props.deck) : "";
  const primaryCta = props.primary_cta || null;
  const secondaryCta = props.secondary_cta || null;

  if (!headlineHtml) return "";

  // CTA group. Two buttons rendered as separate bulletproof tables side
  // by side in a P6-style two-cell row. If only primary, render full
  // width with the primary aligned left. The wrapping table fixes the
  // column widths so Outlook lays them out correctly.
  let ctaHtml = "";
  const primaryBtn = primaryCta && primaryCta.text && primaryCta.url
    ? bulletproofCta({
        text: escHtml(primaryCta.text),
        url: safeUrl(primaryCta.url),
        bgColor: DESIGN_TOKENS.accent,
        textColor: DESIGN_TOKENS.primaryDark,
        width: 220,
        height: 50,
        align: "left",
      })
    : "";
  const secondaryBtn = (() => {
    if (!secondaryCta || !secondaryCta.text || !secondaryCta.url) return "";
    const text = escHtml(secondaryCta.text);
    const url = safeUrl(secondaryCta.url);
    // Ghost button: bordered pill, transparent bg, white text. Built
    // inline rather than via bulletproofCta because the helper's VML
    // fallback assumes solid fill.
    const height = 50, width = 200;
    return `
<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="left" style="margin:0;">
  <tr>
    <td align="center" bgcolor="#0A0F1F" style="background-color:#0A0F1F;border:1px solid rgba(255,255,255,0.22);border-radius:12px;">
      <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="${url}"
          style="height:${height}px;v-text-anchor:middle;width:${width}px;"
          arcsize="24%"
          strokecolor="#444B5C"
          fillcolor="#0A0F1F">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;">${text}</center>
        </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
        <a href="${url}" style="display:inline-block;padding:15px 22px;background:transparent;color:#ffffff;text-decoration:none;border-radius:12px;font-family:${FONTS.body};font-size:15px;font-weight:600;letter-spacing:-0.01em;line-height:1;">${text}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
  })();

  if (primaryBtn || secondaryBtn) {
    ctaHtml = `
    <tr>
      <td style="padding:36px 0 0 0;">
        <table role="presentation" border="0" cellspacing="0" cellpadding="0">
          <tr>
            ${primaryBtn ? `<td valign="middle" align="left" style="padding-right:12px;">${primaryBtn}</td>` : ""}
            ${secondaryBtn ? `<td valign="middle" align="left">${secondaryBtn}</td>` : ""}
          </tr>
        </table>
      </td>
    </tr>`;
  }

  // Outer wrapper. Outlook gets a flat dark navy background; modern
  // clients get the same flat colour PLUS an absolutely-positioned mesh
  // glow (P4). The mesh layer sits inside an `[if !mso]` block so it
  // doesn't render in Outlook at all.
  const meshHtml = `
<!--[if !mso]><!-- -->
  <div style="position:absolute;top:-180px;left:-160px;width:480px;height:480px;background:radial-gradient(circle, rgba(0,180,216,0.32) 0%, transparent 60%);filter:blur(50px);pointer-events:none;"></div>
  <div style="position:absolute;bottom:-200px;right:-180px;width:520px;height:520px;background:radial-gradient(circle, rgba(72,202,228,0.18) 0%, transparent 60%);filter:blur(60px);pointer-events:none;"></div>
<!--<![endif]-->`;

  return `
<tr><td bgcolor="${DESIGN_TOKENS.primaryDark}" class="tg-pad-mobile" style="background-color:${DESIGN_TOKENS.primaryDark};padding:32px 40px 56px;color:#ffffff;position:relative;overflow:hidden;">
  ${meshHtml}
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="position:relative;">
    ${renderHeroNav(props)}
    ${eyebrow ? `
    <tr>
      <td style="padding:0 0 20px 0;">
        <span style="font-family:${FONTS.body};font-size:12px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:${DESIGN_TOKENS.accentLight};line-height:14px;">${eyebrow}</span>
      </td>
    </tr>` : ""}
    <tr>
      <td style="padding:0 0 20px 0;">
        <h1 style="font-family:${FONTS.heading};font-size:52px;font-weight:800;line-height:1.02;letter-spacing:-0.04em;color:#ffffff;margin:0;mso-line-height-rule:exactly;">${headlineHtml}</h1>
      </td>
    </tr>
    ${deck ? `
    <tr>
      <td style="padding:0;">
        <p style="font-family:${FONTS.body};font-size:18px;line-height:1.55;color:rgba(255,255,255,0.78);font-weight:400;letter-spacing:-0.005em;margin:0;max-width:480px;">${deck}</p>
      </td>
    </tr>` : ""}
    ${ctaHtml}
  </table>
</td></tr>`;
}

const schema = {
  type: "hero-dark",
  label: "Hero (dark mesh)",
  description: "Deep navy launch hero with mesh-gradient backdrop, optional logo and \"new launch\" badge, big bold headline, deck, and up to two CTAs. Wrap an accent word in *asterisks* to italicise and teal-colour it.",
  fields: [
    { key: "logo_mark", label: "Logo mark (1-2 letters, e.g. \"T\")", type: "text", optional: true, maxLength: 2 },
    { key: "logo_text", label: "Logo wordmark", type: "text", optional: true, maxLength: 30 },
    { key: "logo_link_url", label: "Logo link URL", type: "url", optional: true },
    { key: "badge_text", label: "Badge text (e.g. \"New launch\")", type: "text", optional: true, maxLength: 20 },
    { key: "eyebrow", label: "Eyebrow line", type: "text", optional: true, maxLength: 60 },
    { key: "headline", label: "Headline (use *word* to italic-teal one phrase)", type: "longText", required: true, maxLength: 160 },
    { key: "deck", label: "Deck (subhead paragraph)", type: "longText", optional: true, maxLength: 280 },
    { key: "primary_cta", label: "Primary CTA (solid teal)", type: "group", optional: true, fields: [
      { key: "text", label: "Button text", type: "text", maxLength: 30 },
      { key: "url", label: "Button URL", type: "url" },
    ]},
    { key: "secondary_cta", label: "Secondary CTA (ghost / outline)", type: "group", optional: true, fields: [
      { key: "text", label: "Button text", type: "text", maxLength: 30 },
      { key: "url", label: "Button URL", type: "url" },
    ]},
  ],
};

module.exports = { render, schema };

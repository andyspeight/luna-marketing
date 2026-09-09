// lib/email-sections/pricing-cards.js
//
// Plan / pricing cards for B2B SaaS emails. Two or three plans side by
// side, each with a name, price, billing period, an optional note (setup
// fee, "billed annually"), a tick list of what is included and a CTA. One
// plan can be highlighted as the recommended one: it renders on the brand
// primary (navy) with a badge, the others on white with a hairline border.
//
// Props:
//   eyebrow, title, lede      — optional header above the cards
//   plans                     — array, max 3, each:
//       name        e.g. "Boost"
//       price       e.g. "£229"
//       period      e.g. "/month" (optional)
//       note        e.g. "£2,995 setup" (optional)
//       features    one per line (optional)
//       cta_text, cta_url (optional)
//       highlight   boolean — the recommended plan
//       badge       label on the highlighted plan (default "Most popular")
//   cta_colour, cta_text_colour, heading_colour, body_colour, background_colour
//
// Every price, period and feature must come from the Product Library or the
// user's input. The composer never invents pricing.
//
// Outlook patterns used:
//   - Cards are nested tables with bgcolor; 12px gap cells between them
//   - P2 bulletproof CTA in every card
//   - Cards stack on mobile (tg-stack-narrow); gap cells become 12px spacers

const STATIC_BRAND = require("../email-brand");
const { escHtml, safeUrl, fallback, scaleFont, safeHex, editAttr, richInline } = require("./_helpers");
const { bulletproofCta } = require("./_outlook-bulletproof");

const INNER_WIDTH = 536;
const GAP = 12;
const CARD_PAD = 18;

function featureLines(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  return String(value || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function render(props = {}, brand, editable) {
  const { DESIGN_TOKENS, FONTS } = brand || STATIC_BRAND;

  const plansRaw = Array.isArray(props.plans) ? props.plans : [];
  const plans = plansRaw
    .map((plan, idx) => ({ plan, idx }))
    .filter(({ plan }) => plan && (plan.name || plan.price))
    .slice(0, 3);
  if (!plans.length) return "";

  const eyebrow = props.eyebrow ? escHtml(props.eyebrow) : "";
  const title = props.title ? escHtml(props.title) : "";
  const lede = props.lede ? richInline(props.lede) : "";

  const titleSize = scaleFont(26, props.title_size);
  const headingColour = safeHex(props.heading_colour) || DESIGN_TOKENS.textPrimary;
  const bodyColour = safeHex(props.body_colour) || DESIGN_TOKENS.textSecondary;
  const ctaBg = safeHex(props.cta_colour) || DESIGN_TOKENS.accent;
  const ctaFg = safeHex(props.cta_text_colour) || DESIGN_TOKENS.textPrimary;
  const sectionBg = safeHex(props.background_colour) || DESIGN_TOKENS.bgPrimary;

  const cardWidth = Math.floor((INNER_WIDTH - GAP * (plans.length - 1)) / plans.length);
  const innerWidth = cardWidth - CARD_PAD * 2;

  const renderCard = ({ plan, idx }) => {
    const hi = plan.highlight === true;
    const name = plan.name ? escHtml(plan.name) : "";
    const price = plan.price ? escHtml(plan.price) : "";
    const period = plan.period ? escHtml(plan.period) : "";
    const note = plan.note ? escHtml(plan.note) : "";
    const badge = escHtml(fallback(plan.badge, "Most popular"));
    const features = featureLines(plan.features);
    const ctaText = plan.cta_text ? escHtml(plan.cta_text) : "";
    const ctaUrl = safeUrl(plan.cta_url);

    const cardBg = hi ? DESIGN_TOKENS.primary : DESIGN_TOKENS.bgPrimary;
    const border = hi ? `1px solid ${DESIGN_TOKENS.primary}` : `1px solid ${DESIGN_TOKENS.border}`;
    const nameColour = hi ? DESIGN_TOKENS.accentLight : DESIGN_TOKENS.accent;
    const priceColour = hi ? "#FFFFFF" : headingColour;
    const mutedColour = hi ? "rgba(255,255,255,0.75)" : bodyColour;
    const tickColour = hi ? DESIGN_TOKENS.accentLight : DESIGN_TOKENS.accent;
    const featureColour = hi ? "rgba(255,255,255,0.9)" : bodyColour;
    const ruleColour = hi ? "rgba(255,255,255,0.18)" : DESIGN_TOKENS.borderLight;

    const badgeHtml = hi && badge
      ? `<div style="margin:0 0 12px 0;"><span${editAttr(editable, `plans.${idx}.badge`)} style="display:inline-block;padding:4px 10px;background-color:${DESIGN_TOKENS.accent};border-radius:999px;font-family:${FONTS.body};font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${DESIGN_TOKENS.textPrimary};line-height:14px;">${badge}</span></div>`
      : "";
    const nameHtml = name
      ? `<div${editAttr(editable, `plans.${idx}.name`)} style="font-family:${FONTS.body};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${nameColour};line-height:16px;margin:0 0 8px 0;">${name}</div>`
      : "";
    const priceHtml = price
      ? `<div style="margin:0 0 ${note ? 4 : 14}px 0;"><span${editAttr(editable, `plans.${idx}.price`)} style="font-family:${FONTS.heading};font-size:28px;font-weight:800;letter-spacing:-0.03em;color:${priceColour};line-height:32px;">${price}</span>${period ? `<span${editAttr(editable, `plans.${idx}.period`)} style="font-family:${FONTS.body};font-size:13px;font-weight:500;color:${mutedColour};line-height:16px;margin-left:2px;">${period}</span>` : ""}</div>`
      : "";
    const noteHtml = note
      ? `<div${editAttr(editable, `plans.${idx}.note`)} style="font-family:${FONTS.body};font-size:12px;color:${mutedColour};line-height:17px;margin:0 0 14px 0;">${note}</div>`
      : "";
    const featuresHtml = features.length
      ? `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="border-top:1px solid ${ruleColour};margin:0 0 ${ctaText && ctaUrl ? 16 : 0}px 0;">${features.map((f) => `<tr><td width="18" valign="top" style="width:18px;padding:9px 0 0 0;font-family:${FONTS.body};font-size:13px;font-weight:700;color:${tickColour};line-height:18px;">&#10003;</td><td valign="top" style="padding:9px 0 0 0;font-family:${FONTS.body};font-size:13px;color:${featureColour};line-height:18px;">${richInline(f)}</td></tr>`).join("")}</table>`
      : "";
    const ctaHtml = ctaText && ctaUrl
      ? bulletproofCta({
          text: ctaText,
          url: ctaUrl,
          bgColor: ctaBg,
          textColor: ctaFg,
          align: "center",
          fontSize: 13,
          paddingY: 11,
          paddingX: 14,
          height: 40,
          radius: 8,
          width: innerWidth,
          fullWidth: true,
          attrs: editAttr(editable, `plans.${idx}.cta_text`),
        })
      : "";

    return `<td width="${cardWidth}" valign="top" class="tg-stack-narrow" style="width:${cardWidth}px;vertical-align:top;">
      <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" bgcolor="${cardBg}" style="width:100%;background-color:${cardBg};border:${border};border-radius:12px;">
        <tr><td style="padding:${CARD_PAD}px;">${badgeHtml}${nameHtml}${priceHtml}${noteHtml}${featuresHtml}${ctaHtml}</td></tr>
      </table>
    </td>`;
  };

  const gapCell = `<td width="${GAP}" class="tg-stack-gap" style="width:${GAP}px;font-size:0;line-height:0;">&nbsp;</td>`;
  const cardsHtml = plans.map(renderCard).join(gapCell);

  const headerHtml = (eyebrow || title || lede)
    ? `<div style="margin:0 0 24px 0;">
      ${eyebrow ? `<div${editAttr(editable, "eyebrow")} style="font-family:${FONTS.body};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${DESIGN_TOKENS.accent};line-height:16px;margin:0 0 10px 0;">${eyebrow}</div>` : ""}
      ${title ? `<div${editAttr(editable, "title")} style="font-family:${FONTS.heading};font-size:${titleSize}px;font-weight:700;letter-spacing:-0.02em;color:${headingColour};line-height:${Math.round(titleSize * (32 / 26))}px;margin:0 0 ${lede ? 8 : 0}px 0;">${title}</div>` : ""}
      ${lede ? `<div${editAttr(editable, "lede")} style="font-family:${FONTS.body};font-size:15px;color:${bodyColour};line-height:24px;margin:0;max-width:520px;">${lede}</div>` : ""}
    </div>`
    : "";

  return `
<tr><td bgcolor="${sectionBg}" class="tg-pad-mobile" style="background-color:${sectionBg};padding:36px 32px;">
  ${headerHtml}
  <table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%"><tr>${cardsHtml}</tr></table>
</td></tr>`;
}

const schema = {
  type: "pricing-cards",
  label: "Pricing cards",
  description: "Two or three plan cards side by side: plan name, price, period, optional note, a tick list of what's included and a CTA. Flag one plan as highlight for the recommended-plan treatment. plans is an array of { name, price, period, note, features (one per line), cta_text, cta_url, highlight, badge }. Prices and features must come from the Product Library or the brief — never invent them.",
  fields: [
    { key: "eyebrow", label: "Eyebrow label", type: "text", optional: true, maxLength: 40 },
    { key: "title", label: "Section title", type: "text", optional: true, maxLength: 80 },
    { key: "title_size", label: "Title text size", type: "fontSize", optional: true },
    { key: "lede", label: "Lede (optional)", type: "text", optional: true, maxLength: 200 },
    { key: "plans", label: "Plans (up to 3)", type: "array", required: true, max: 3, itemLabel: "plan", itemFields: [
      { key: "name", label: "Plan name", type: "text", required: true, maxLength: 30 },
      { key: "price", label: "Price (e.g. £229)", type: "text", optional: true, maxLength: 20 },
      { key: "period", label: "Period (e.g. /month)", type: "text", optional: true, maxLength: 20 },
      { key: "note", label: "Note (e.g. £2,995 setup)", type: "text", optional: true, maxLength: 60 },
      { key: "features", label: "What's included (one per line)", type: "longText", optional: true, maxLength: 600 },
      { key: "cta_text", label: "Button text", type: "text", optional: true, maxLength: 30 },
      { key: "cta_url", label: "Button link", type: "url", optional: true },
      { key: "highlight", label: "Recommended plan", type: "boolean", optional: true, checkboxLabel: "Highlight this plan (navy card with badge)" },
      { key: "badge", label: "Badge text", type: "text", optional: true, maxLength: 20, default: "Most popular" },
    ]},
    { key: "heading_colour", label: "Title colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "body_colour", label: "Text colour", type: "colour", optional: true, defaultPreview: "#475569", help: "Leave empty to keep the default." },
    { key: "cta_colour", label: "Button colour", type: "colour", optional: true, defaultPreview: "#00B4D8", help: "Leave empty to keep the default." },
    { key: "cta_text_colour", label: "Button text colour", type: "colour", optional: true, defaultPreview: "#0F172A", help: "Leave empty to keep the default." },
    { key: "background_colour", label: "Section background colour", type: "colour", optional: true, defaultPreview: "#FFFFFF", placeholder: "Leave empty for white" },
  ],
  composerHints: {
    whenToUse: [
      "Pricing or plan comparison emails where the tiers are in the Product Library or the brief",
      "Upgrade nudges: highlight the plan you are recommending",
    ],
    whenNotToUse: [
      "Any time a price, setup fee or inclusion is not in the input — omit the section rather than guess",
      "More than three plans (pick the three that matter)",
    ],
  },
};

module.exports = { render, schema };

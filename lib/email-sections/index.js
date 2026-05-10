// lib/email-sections/index.js
// Section registry. Single source of truth for which sections exist.

const header = require("./header");
const hero = require("./hero");
const article = require("./article");
const twoColumn = require("./two-column");
const text = require("./text");
const cta = require("./cta");
const divider = require("./divider");
const footer = require("./footer");

// Offer sections (May 2026) — pull live offers from Travelify via the
// tg-widgets proxy. All six share the same data layer (_offer-fetch.js)
// and helpers (_offer-helpers.js); each is a different render template.
const offersHero = require("./offers-hero");
const offersThreeUp = require("./offers-three-up");
const offersUrgency = require("./offers-urgency");
const offersList = require("./offers-list");
const offersTwoUp = require("./offers-two-up");
const offersEditorial = require("./offers-editorial");

// Transactional sections (May 2026, Archetype D from travelgenix-email-design
// skill). Built per the new design system tokens (DESIGN_TOKENS in
// email-brand.js) and the bulletproof Outlook patterns from §12 of the skill.
// These use the helper module ./_outlook-bulletproof for shared patterns.
const topBar = require("./top-bar");
const confirmationBlock = require("./confirmation-block");
const tripCard = require("./trip-card");
const costSummary = require("./cost-summary");
const nextSteps = require("./next-steps");
const helpBlock = require("./help-block");
const footerMeta = require("./footer-meta");

const SECTIONS = {
  // Existing layout sections
  header,
  hero,
  article,
  "two-column": twoColumn,
  text,
  cta,
  divider,
  footer,

  // Offer sections
  "offers-hero": offersHero,
  "offers-three-up": offersThreeUp,
  "offers-urgency": offersUrgency,
  "offers-list": offersList,
  "offers-two-up": offersTwoUp,
  "offers-editorial": offersEditorial,

  // Transactional sections (Archetype D — complete)
  "top-bar": topBar,
  "confirmation-block": confirmationBlock,
  "trip-card": tripCard,
  "cost-summary": costSummary,
  "next-steps": nextSteps,
  "help-block": helpBlock,
  "footer-meta": footerMeta,
};

/**
 * Get section module by type. Returns null if unknown.
 */
function get(type) {
  return SECTIONS[type] || null;
}

/**
 * List all section schemas — used by the builder UI to populate the section library.
 */
function listSchemas() {
  return Object.entries(SECTIONS).map(([type, mod]) => mod.schema);
}

/**
 * Render a single section by type with given props.
 * Returns HTML markup string. Returns empty string on unknown type.
 */
function renderSection(type, props) {
  const mod = SECTIONS[type];
  if (!mod) {
    console.warn(`[email-sections] Unknown section type: ${type}`);
    return "";
  }
  try {
    return mod.render(props || {});
  } catch (e) {
    console.error(`[email-sections] Render failed for ${type}:`, e.message);
    return "";
  }
}

module.exports = { get, listSchemas, renderSection, SECTIONS };

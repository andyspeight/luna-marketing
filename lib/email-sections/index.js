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

// Marketing newsletter sections (May 2026, Archetype B). Match the
// design treatment of offers-three-up but accept manual content rather
// than live offer data. pull-quote is also used by Archetype A (B2B Weekly).
const heroImage = require("./hero-image");
const destinationGrid = require("./destination-grid");
const featureStory = require("./feature-story");
const pullQuote = require("./pull-quote");
const ctaBanner = require("./cta-banner");
const footerLight = require("./footer-light");

// B2B Weekly sections (May 2026, Archetype A). Editorial newspaper
// treatment. Footer for this archetype is footer-light (shared with
// Archetype B); the dark footer used in the Appendix A.1 mockup is one
// styling option but the spec calls for footer-light in B2B Weekly.
const masthead = require("./masthead");
const toc = require("./toc");
const leadStory = require("./lead-story");
const duoGrid = require("./duo-grid");
const pulseStats = require("./pulse-stats");
const numberedList = require("./numbered-list");
const calendarGrid = require("./calendar-grid");

// Product Launch sections (May 2026, Archetype C). Dark mesh-gradient
// hero, product mockup (chat or dashboard), feature list, stats strip,
// testimonial, dark final CTA, dark footer. Mesh gradients are wrapped
// in [if !mso] blocks so Outlook gets the flat-colour fallback.
const heroDark = require("./hero-dark");
const productMockup = require("./product-mockup");
const featuresSection = require("./features-section");
const statsStrip = require("./stats-strip");
const testimonialSection = require("./testimonial");
const ctaDark = require("./cta-dark");
const footerDark = require("./footer-dark");

// Generated image (Stage C, May 2026). A single AI-generated visual
// produced by the Stage B image pipeline (/api/image-generate-v2). The
// section's only content IS the image — no headline or body copy around
// it. Used when the visual is the message (product mockups, pricing
// comparisons, data cards) rather than supporting it.
const generatedImage = require("./generated-image");

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

  // Marketing newsletter sections (Archetype B — complete)
  "hero-image": heroImage,
  "destination-grid": destinationGrid,
  "feature-story": featureStory,
  "pull-quote": pullQuote,
  "cta-banner": ctaBanner,
  "footer-light": footerLight,

  // B2B Weekly sections (Archetype A — complete)
  "masthead": masthead,
  "toc": toc,
  "lead-story": leadStory,
  "duo-grid": duoGrid,
  "pulse-stats": pulseStats,
  "numbered-list": numberedList,
  "calendar-grid": calendarGrid,

  // Product Launch sections (Archetype C — complete)
  "hero-dark": heroDark,
  "product-mockup": productMockup,
  "features-section": featuresSection,
  "stats-strip": statsStrip,
  "testimonial": testimonialSection,
  "cta-dark": ctaDark,
  "footer-dark": footerDark,

  // Stage C — single AI-generated image as a section
  "generated-image": generatedImage,
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
function renderSection(type, props, brand) {
  const mod = SECTIONS[type];
  if (!mod) {
    console.warn(`[email-sections] Unknown section type: ${type}`);
    return "";
  }
  try {
    // brand is optional. Components that haven't been migrated yet
    // ignore the extra argument and use static Travelgenix defaults.
    // Once stage B of the brand-kit refactor lands, every component
    // reads from brand instead.
    return mod.render(props || {}, brand);
  } catch (e) {
    console.error(`[email-sections] Render failed for ${type}:`, e.message);
    return "";
  }
}

module.exports = { get, listSchemas, renderSection, SECTIONS };

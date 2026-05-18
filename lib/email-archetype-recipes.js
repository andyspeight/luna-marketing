// lib/email-archetype-recipes.js
//
// Section recipes for each email archetype, derived from travelgenix-email-design SKILL.md §2.
// These tell the AI composer which sections to use for each archetype, in what order,
// and any structural rules.
//
// These are RECIPES, not templates. The composer fills sections with bespoke content
// matching the user's intent. Same archetype → same structure → different content each time.
//
// Author: Travelgenix
// Date:   18 May 2026

const ARCHETYPE_RECIPES = {

  // ─────────────────────────────────────────────────────────────────
  // Archetype A: B2B Weekly Newsletter
  // Editorial newspaper feel. Dense with value. Andy Speight byline.
  // Dials: Variance 4 · Motion 2 · Density 6
  // ─────────────────────────────────────────────────────────────────
  "b2b-weekly": {
    name: "B2B Weekly Newsletter",
    description: "Recurring weekly/fortnightly editorial dispatch. Stratechery / Morning Brew style. Dense with value, multiple stories, data-driven.",
    feel: "Editorial newspaper. Smart, opinionated, dense.",
    targetWords: { min: 350, max: 650 },
    sections: [
      {
        type: "masthead",
        required: true,
        purpose: "Issue masthead with publication name, issue number, date. The signature opening."
      },
      {
        type: "toc",
        required: false,
        purpose: "Table of contents for the issue. Use if 4+ stories. Otherwise skip."
      },
      {
        type: "lead-story",
        required: true,
        purpose: "The lead opinion piece with byline. 150-250 words. The editorial centrepiece."
      },
      {
        type: "duo-grid",
        required: false,
        purpose: "Two-up grid for secondary stories. Each ~80-120 words. Use if you have 2 strong secondary stories."
      },
      {
        type: "pulse-stats",
        required: false,
        purpose: "Industry pulse — 3-4 data points with sources. Use when you have current week's data."
      },
      {
        type: "numbered-list",
        required: false,
        purpose: "Quick wins or takeaways. 3-5 numbered items, each one line. Practical, actionable."
      },
      {
        type: "pull-quote",
        required: false,
        purpose: "A standout quote from the lead story or a featured source. One per issue maximum."
      },
      {
        type: "calendar-grid",
        required: false,
        purpose: "On the radar — upcoming industry events (next 2-4 weeks). Use only if events are genuinely relevant."
      },
      {
        type: "footer-light",
        required: true,
        purpose: "Standard light footer with unsubscribe, social, company details."
      }
    ],
    rules: [
      "Lead story must have a clear opinion or takeaway, not just news summary.",
      "Pulse stats MUST include source attribution. Never invent numbers.",
      "Max one pull-quote per issue (overuse dilutes the effect).",
      "Variance is low — same skeleton every week. Variation comes from the content."
    ]
  },

  // ─────────────────────────────────────────────────────────────────
  // Archetype B: Marketing Newsletter
  // Travel magazine feel. Editorial but commercial.
  // Dials: Variance 6 · Motion 3 · Density 4
  // ─────────────────────────────────────────────────────────────────
  "marketing-newsletter": {
    name: "Marketing Newsletter",
    description: "Client-facing monthly newsletter. Destination promotion, seasonal campaign. Editorial but commercial.",
    feel: "Travel magazine. Generous breathing room. Aspirational.",
    targetWords: { min: 200, max: 450 },
    sections: [
      {
        type: "top-bar",
        required: true,
        purpose: "Slim top bar with business name and issue meta (Issue 12 · May 2026 etc)."
      },
      {
        type: "hero-image",
        required: true,
        purpose: "Big hero image with eyebrow, headline, deck and primary CTA. The visual centrepiece."
      },
      {
        type: "destination-grid",
        required: false,
        purpose: "Three-up destination cards. Use when promoting multiple destinations. Each card needs image, name, meta, price."
      },
      {
        type: "feature-story",
        required: false,
        purpose: "Featured article block. Eyebrow + title + lede + card with image, excerpt, read-more link."
      },
      {
        type: "offers-three-up",
        required: false,
        purpose: "Three offers fetched live from Travelify. Specify search criteria in props.fetch; offers are filled at render time."
      },
      {
        type: "pull-quote",
        required: false,
        purpose: "A customer or industry voice. Use when you have a real attributable quote — never invent."
      },
      {
        type: "cta-banner",
        required: true,
        purpose: "Mid-email conversion banner with title + supporting text + primary button on navy gradient."
      },
      {
        type: "footer-light",
        required: true,
        purpose: "Standard light footer."
      }
    ],
    rules: [
      "Hero image is required. If no image URL available, the composer must flag it in imagesNeeded.",
      "Destination grid needs all three cards filled — half-empty looks broken.",
      "Pull quote is optional but powerful. Skip if no real attributable source.",
      "Variance is medium — vary the structure slightly each month to keep it fresh."
    ]
  },

  // ─────────────────────────────────────────────────────────────────
  // Archetype C: Product Launch
  // Linear/Vercel/Stripe feel. Single moment, single action.
  // Dials: Variance 7 · Motion 5 · Density 3
  // ─────────────────────────────────────────────────────────────────
  "product-launch": {
    name: "Product Launch",
    description: "New product launch, major feature release, beta access. Single moment, single action.",
    feel: "Tech product launch. Dark, confident, focused.",
    targetWords: { min: 100, max: 250 },
    sections: [
      {
        type: "hero-dark",
        required: true,
        purpose: "Dark mesh-gradient hero with bold headline. The product reveal moment. NO image — the type does the work."
      },
      {
        type: "product-mockup",
        required: false,
        purpose: "Product visual / mockup. Apple-style screenshot or illustration. Image slot if available."
      },
      {
        type: "features-section",
        required: false,
        purpose: "3-5 feature rows with icons + short copy. Each feature = one thing the product does."
      },
      {
        type: "stats-strip",
        required: false,
        purpose: "3-4 standout stats. Only use if you have REAL numbers — never invent."
      },
      {
        type: "testimonial",
        required: false,
        purpose: "Single testimonial — quote + name + role. Only use if you have a real attributable quote."
      },
      {
        type: "cta-dark",
        required: true,
        purpose: "Final dark CTA. One action. No alternative path. This is the conversion moment."
      },
      {
        type: "footer-dark",
        required: true,
        purpose: "Dark footer matching the launch aesthetic."
      }
    ],
    rules: [
      "ONE action. ONE CTA. Don't dilute the moment.",
      "Stats and testimonials MUST be real. If unsure, omit.",
      "Hero-dark doesn't use an image — bold typography on dark gradient does the work.",
      "Variance is high — every launch should feel distinct, not templated."
    ]
  },

  // ─────────────────────────────────────────────────────────────────
  // Archetype D: Transactional
  // Stripe receipt / Apple booking feel. Calm, scannable.
  // Dials: Variance 2 · Motion 1 · Density 5
  // ─────────────────────────────────────────────────────────────────
  "transactional": {
    name: "Transactional",
    description: "System-triggered confirmation, receipt, or required information. Booking confirmation, payment receipt, password reset.",
    feel: "Calm, scannable, information-first. Read in 8 seconds.",
    targetWords: { min: 80, max: 180 },
    sections: [
      {
        type: "top-bar",
        required: true,
        purpose: "Top bar with booking ref or transaction ID."
      },
      {
        type: "confirmation-block",
        required: true,
        purpose: "Success icon + personalised greeting (Hi {name}) + one-line confirmation."
      },
      {
        type: "trip-card",
        required: false,
        purpose: "Trip card with image header + detail rows + journey block. Booking confirmations only."
      },
      {
        type: "cost-summary",
        required: false,
        purpose: "Line items + total + paid status. Use for receipts and booking confirmations."
      },
      {
        type: "next-steps",
        required: false,
        purpose: "Numbered list of what the recipient needs to do next. 3 items max."
      },
      {
        type: "help-block",
        required: true,
        purpose: "Contact info — phone, email. ALWAYS include in transactional emails."
      },
      {
        type: "footer-meta",
        required: true,
        purpose: "Compliance footer with ATOL/ABTA, address, company details."
      }
    ],
    rules: [
      "Information is the priority. No marketing copy.",
      "Greeting must be personalised — use the recipient's name.",
      "Help block is REQUIRED. Recipients in distress need to find the contact info fast.",
      "Footer-meta is REQUIRED for travel compliance (ATOL/ABTA where applicable).",
      "Variance is very low — same shape every time. Recipients should recognise the format."
    ]
  }
};

/**
 * Get the recipe for an archetype.
 * @param {string} archetypeKey
 * @returns {Object|null}
 */
function getRecipe(archetypeKey) {
  return ARCHETYPE_RECIPES[archetypeKey] || null;
}

/**
 * List all archetype keys and their names — for UI display.
 */
function listArchetypes() {
  return Object.entries(ARCHETYPE_RECIPES).map(([key, recipe]) => ({
    key,
    name: recipe.name,
    description: recipe.description,
    feel: recipe.feel
  }));
}

module.exports = {
  ARCHETYPE_RECIPES,
  getRecipe,
  listArchetypes
};

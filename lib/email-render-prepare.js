// lib/email-render-prepare.js
//
// Async pre-render step. The hand-rolled renderer (lib/email-renderer.js)
// is synchronous because email sections render to HTML strings without
// any I/O. Offer sections need a network round-trip to Travelify, so we
// fetch all offer data BEFORE the synchronous render and hydrate each
// offer-* section with its results.
//
// Pattern:
//   1. Walk the sections array
//   2. Find every section whose type starts with "offers-"
//   3. Fetch their offers in parallel (one fetch per block — the API
//      doesn't support multiplexing, and the cost is the same anyway)
//   4. Return a NEW sections array with each offer-* section's
//      props.offers populated
//
// The synchronous renderer then sees offers in props and renders normally.
// If a fetch fails or returns nothing, props.offers is set to an empty
// array — sections handle this themselves with emptyRow().

const { fetchOffers } = require("./email-sections/_offer-fetch");

const OFFER_TYPE_PREFIX = "offers-";

// Per-section default fetch limits. Match what each block can actually
// display so we never pull more than we need.
const SECTION_DEFAULT_LIMITS = {
  "offers-hero": 1,
  "offers-urgency": 1,
  "offers-editorial": 1,
  "offers-two-up": 2,
  "offers-three-up": 3,
  "offers-list": 6,
};

function isOfferSection(s) {
  return (
    s &&
    typeof s === "object" &&
    typeof s.type === "string" &&
    s.type.startsWith(OFFER_TYPE_PREFIX)
  );
}

function limitForType(type, propsMaxItems) {
  const base = SECTION_DEFAULT_LIMITS[type] || 6;
  // For offers-list, the user can lower the cap via maxItems
  if (type === "offers-list" && Number.isFinite(propsMaxItems)) {
    return Math.max(1, Math.min(base, parseInt(propsMaxItems, 10)));
  }
  return base;
}

/**
 * Walks sections, fetches offers for each offer-* section in parallel,
 * returns a new sections array with props.offers populated.
 *
 * @param {Array} sections
 * @returns {Promise<{ sections: Array, warnings: Array }>}
 */
async function prepareSections(sections) {
  if (!Array.isArray(sections)) return { sections: [], warnings: [] };

  const warnings = [];
  const offerJobs = [];

  // Identify which sections need fetching. We index by position so we
  // can splice the results back in deterministically.
  sections.forEach((s, idx) => {
    if (!isOfferSection(s)) return;
    const props = s.props || {};
    const limit = limitForType(s.type, props.maxItems);
    offerJobs.push({
      idx,
      type: s.type,
      promise: fetchOffers(props.fetch || {}, limit),
    });
  });

  // Fast-path: nothing to fetch
  if (offerJobs.length === 0) return { sections: [...sections], warnings };

  // Run fetches in parallel — cap at 6 concurrent to avoid hammering the
  // proxy if an email has lots of offer blocks. (Realistic max is 3-4.)
  const results = await Promise.all(offerJobs.map((j) => j.promise));

  // Hydrate each offer section with its results
  const hydrated = sections.map((s) => ({ ...s, props: { ...(s.props || {}) } }));
  offerJobs.forEach((job, i) => {
    const { offers, error } = results[i] || { offers: [], error: "Unknown" };
    hydrated[job.idx].props.offers = offers;
    if (error) {
      warnings.push(`Section ${job.idx} (${job.type}): ${error}`);
    } else if (offers.length === 0) {
      warnings.push(`Section ${job.idx} (${job.type}): no offers returned`);
    }
  });

  return { sections: hydrated, warnings };
}

module.exports = { prepareSections, isOfferSection };

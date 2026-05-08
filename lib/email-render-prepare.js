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
//   5. Deduplicate the demo banner — only the FIRST offer section in
//      any contiguous run of demo-data sections shows the banner.
//      Subsequent demo sections in the same run set _suppressDemoBanner
//      so the offer block skips rendering it.
//
// The synchronous renderer then sees offers in props and renders normally.
// If a fetch fails or returns nothing, props.offers is set to an empty
// array — sections handle this themselves with emptyRow().

const { fetchOffers } = require("./email-sections/_offer-fetch");

const OFFER_TYPE_PREFIX = "offers-";

// Per-section default fetch limits.
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
  if (type === "offers-list" && Number.isFinite(propsMaxItems)) {
    return Math.max(1, Math.min(base, parseInt(propsMaxItems, 10)));
  }
  return base;
}

/**
 * Mark every offer section that came back with demo data, then clear the
 * banner on all but the first in any contiguous run. A "run" is broken
 * by either a non-offer section or an offer section without demo data.
 *
 * Mutates the hydrated array in place.
 */
function dedupeDemoBanners(hydrated) {
  let inDemoRun = false;
  for (let i = 0; i < hydrated.length; i++) {
    const s = hydrated[i];
    if (!isOfferSection(s)) {
      // Non-offer section breaks the run
      inDemoRun = false;
      continue;
    }
    const offers = (s.props && s.props.offers) || [];
    const isDemo = offers.some((o) => o && o._isDemo);
    if (!isDemo) {
      inDemoRun = false;
      continue;
    }
    // This section has demo data
    if (inDemoRun) {
      // Already saw a demo banner earlier in the run — suppress this one
      s.props._suppressDemoBanner = true;
    } else {
      // First demo section in the run — keep its banner
      inDemoRun = true;
    }
  }
}

/**
 * Walks sections, fetches offers for each offer-* section in parallel,
 * returns a new sections array with props.offers populated and the demo
 * banner deduplicated across contiguous demo runs.
 */
async function prepareSections(sections) {
  if (!Array.isArray(sections)) return { sections: [], warnings: [] };

  const warnings = [];
  const offerJobs = [];

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

  if (offerJobs.length === 0) return { sections: [...sections], warnings };

  const results = await Promise.all(offerJobs.map((j) => j.promise));

  // Clone sections (and props) so we don't mutate the caller's input
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

  // Dedupe the demo banner across contiguous demo runs
  dedupeDemoBanners(hydrated);

  return { sections: hydrated, warnings };
}

module.exports = { prepareSections, isOfferSection };

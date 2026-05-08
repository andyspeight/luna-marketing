// lib/email-sections/_offer-fetch.js
//
// Shared fetcher used by every offer-* section. Calls the existing
// tg-widgets offers proxy (which itself proxies the Travelify
// widgetsvc/traveloffers endpoint) and returns a normalised array of
// offers ready to render. Auto mode only for v1 — manual offer-picking
// will be layered on later.
//
// This runs server-side (in the email-render-prepare step), never in the
// browser. Travelify auth lives in the tg-widgets proxy, never here.
//
// Returns: { offers: [...], error: null|string }

const TG_WIDGETS_OFFERS_URL =
  process.env.TG_WIDGETS_OFFERS_URL ||
  "https://tg-widgets.vercel.app/api/offers";

// Hard caps so a misconfigured block can't hang the renderer or pull
// thousands of offers we'd never use.
const MAX_OFFERS = 12;
const FETCH_TIMEOUT_MS = 6000;

// Field allowlist — verified against tg-widgets/public/widget-offers.js
// `_buildPayload` (the actual code that talks to Travelify). Anything
// outside this list is ignored.
const ALLOWED_FETCH_KEYS = new Set([
  // Type / package
  "type",                // Accommodation | Flights | DynamicPackages | PackageHolidays | BothPackages | Any
  "packageType",         // DynamicPackages | PackageHolidays | Any

  // Where
  "destinations",        // array — country codes, IATA, city/resort names
  "origins",              // array — airport IATA, country codes
  "origin",              // single string — used by departure-board pattern only

  // Filters
  "boardBases",          // array — RoomOnly/BedAndBreakfast/HalfBoard/FullBoard/AllInclusive/AllInclusivePlus
  "cabinClasses",        // array — Economy/PremiumEconomy/Business/First
  "ratingMin",           // number 0–5
  "budgetMin",           // number — £pp
  "budgetMax",           // number — £pp
  "durationMin",         // number — nights
  "durationMax",         // number — nights

  // Date window
  "rollingDates",        // boolean
  "DatesMin",            // number — days ahead
  "DatesMax",            // number — days ahead

  // Sort + dedupe
  "sort",                // 'price:asc' | 'price:desc' | 'random'
  "deduping",            // 'Aggressive' | 'Loose' | 'None'

  // Locale
  "currency",
  "language",
  "nationality",

  // Pricing model
  "pricingByType",       // 'Person' | 'Total'
]);

function pickAllowed(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) {
    if (ALLOWED_FETCH_KEYS.has(k)) {
      const v = obj[k];
      // Skip empty strings, null, undefined, and zero-length arrays.
      // A zero is allowed (e.g. ratingMin: 0).
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
  }
  return out;
}

/**
 * Fetch offers from the tg-widgets proxy.
 *
 * @param {Object} fetchParams - Travelify-spec filters (allowlisted)
 * @param {number} [limit] - Cap on returned offers (1..MAX_OFFERS)
 * @returns {Promise<{offers: Array, error: string|null}>}
 */
async function fetchOffers(fetchParams = {}, limit = 6) {
  const safeLimit = Math.max(1, Math.min(MAX_OFFERS, Number(limit) || 6));
  const safeParams = pickAllowed(fetchParams);

  // Defaults — same defaults the offers widget uses
  const payload = {
    type: "Accommodation",
    deduping: "Aggressive",
    currency: "GBP",
    language: "en",
    nationality: "GB",
    rollingDates: true,
    DatesMin: 7,
    DatesMax: 90,
    pricingByType: "Person",
    sort: "price:asc",
    ...safeParams,
    // Always cap maxOffers at our limit, regardless of what was passed
    maxOffers: safeLimit,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(TG_WIDGETS_OFFERS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Travelgenix-Email-Renderer/1.0",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        offers: [],
        error: `Offers proxy returned ${res.status}`,
      };
    }

    const data = await res.json();

    // Travelify response shape: { results: [...] }, sometimes wrapped
    // by the proxy. Defensive about both.
    const rawOffers =
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.offers) && data.offers) ||
      (Array.isArray(data) && data) ||
      [];

    const normalised = rawOffers
      .slice(0, safeLimit)
      .map(normaliseOffer)
      .filter(Boolean);

    return { offers: normalised, error: null };
  } catch (err) {
    clearTimeout(timer);
    return {
      offers: [],
      error: err.name === "AbortError" ? "Offers fetch timed out" : "Offers fetch failed",
    };
  }
}

/**
 * Reduce a raw Travelify offer to the small shape the email blocks render
 * from. Defensive — every field is checked, nothing fabricated. If a
 * required field is missing the offer is dropped (returns null).
 */
function normaliseOffer(o) {
  if (!o || typeof o !== "object") return null;

  const acc = o.accommodation || {};
  const flight = o.flight || {};
  const accImg = acc.image && typeof acc.image === "object" ? acc.image.url : null;
  const flightImg = flight.image && typeof flight.image === "object" ? flight.image.url : null;
  const imageUrl = accImg || flightImg || null;

  const url = typeof o.url === "string" ? o.url : null;
  if (!url) return null; // No click-through = useless in an email

  const accPricing = acc.pricing || {};
  const wasNumber =
    accPricing.priceChanged === true && typeof accPricing.priceBeforeChange === "number"
      ? Math.round(accPricing.priceBeforeChange)
      : null;

  const dest = (acc.destination && typeof acc.destination === "object" && acc.destination) || {};
  const origin = (flight.origin && typeof flight.origin === "object" && flight.origin) || {};

  return {
    // Identity
    id: typeof o.id === "string" ? o.id : null,
    url,
    type: o.type || (acc && acc.name ? "Accommodation" : flight && flight.carrier ? "Flight" : "Offer"),

    // Headline
    name: typeof acc.name === "string" ? acc.name : "",
    rating: typeof acc.rating === "number" ? acc.rating : null,

    // Location
    destinationName: typeof dest.name === "string" ? dest.name : "",
    destinationCountry: typeof dest.countryCode === "string" ? dest.countryCode : "",

    // Stay details
    nights: typeof acc.nights === "number" ? acc.nights : null,
    boardBasis: typeof acc.boardBasis === "string" ? acc.boardBasis : "",
    checkinDate: typeof acc.checkinDate === "string" ? acc.checkinDate : "",
    propertyType: typeof acc.propertyType === "string" ? acc.propertyType : "",

    // Flight details (for packages)
    departureAirport: typeof origin.name === "string" ? origin.name : "",
    departureDate:
      typeof flight.outboundDate === "string" ? flight.outboundDate : "",

    // Pax
    adults: typeof o.adults === "number" ? o.adults : 0,
    children: typeof o.children === "number" ? o.children : 0,
    infants: typeof o.infants === "number" ? o.infants : 0,

    // Pricing — prefer the formatted strings from Travelify
    formattedPrice: typeof o.formattedPrice === "string" ? o.formattedPrice : "",
    formattedPPPrice: typeof o.formattedPPPrice === "string" ? o.formattedPPPrice : "",
    wasFormatted: wasNumber != null ? `£${wasNumber.toLocaleString("en-GB")}` : null,

    // Image
    imageUrl,
  };
}

module.exports = { fetchOffers, normaliseOffer, ALLOWED_FETCH_KEYS };

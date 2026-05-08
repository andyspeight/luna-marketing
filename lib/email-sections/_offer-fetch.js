// lib/email-sections/_offer-fetch.js
//
// Shared fetcher used by every offer-* section. Calls the existing
// tg-widgets offers proxy (which itself proxies the Travelify
// widgetsvc/traveloffers endpoint) and returns a normalised array of
// offers ready to render.
//
// Demo-data fallback: if the proxy fails for any reason (current state
// of play: persistent 401 from Travelify) the fetcher returns a
// deterministic set of demo offers so the editor's live preview always
// shows something useful. Real offers replace the demos transparently
// once auth is sorted — no code change needed.
//
// Returns: { offers: [...], error: null|string, isDemo: boolean }

const TG_WIDGETS_OFFERS_URL =
  process.env.TG_WIDGETS_OFFERS_URL ||
  "https://tg-widgets.vercel.app/api/offers";

const MAX_OFFERS = 12;
const FETCH_TIMEOUT_MS = 6000;

// Set DEMO_OFFERS_DISABLED=true in Vercel env to turn off the demo
// fallback (e.g. once Travelify is reliable and you'd rather see the
// empty-state row when something genuinely returns nothing).
const DEMO_DISABLED = String(process.env.DEMO_OFFERS_DISABLED || "").toLowerCase() === "true";

const ALLOWED_FETCH_KEYS = new Set([
  "type", "packageType",
  "destinations", "origins", "origin",
  "boardBases", "cabinClasses",
  "ratingMin", "budgetMin", "budgetMax", "durationMin", "durationMax",
  "rollingDates", "DatesMin", "DatesMax",
  "sort", "deduping",
  "currency", "language", "nationality", "pricingByType",
]);

function pickAllowed(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) {
    if (ALLOWED_FETCH_KEYS.has(k)) {
      const v = obj[k];
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
  }
  return out;
}

async function fetchOffers(fetchParams = {}, limit = 6) {
  const safeLimit = Math.max(1, Math.min(MAX_OFFERS, Number(limit) || 6));
  const safeParams = pickAllowed(fetchParams);

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
      return demoFallback(safeLimit, safeParams, `Offers proxy returned ${res.status}`);
    }

    const data = await res.json();
    const rawOffers =
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.offers) && data.offers) ||
      (Array.isArray(data) && data) ||
      [];

    const normalised = rawOffers
      .slice(0, safeLimit)
      .map(normaliseOffer)
      .filter(Boolean);

    if (normalised.length === 0) {
      return demoFallback(safeLimit, safeParams, "No offers returned");
    }

    return { offers: normalised, error: null, isDemo: false };
  } catch (err) {
    clearTimeout(timer);
    return demoFallback(
      safeLimit,
      safeParams,
      err.name === "AbortError" ? "Offers fetch timed out" : "Offers fetch failed"
    );
  }
}

function demoFallback(limit, params, reason) {
  if (DEMO_DISABLED) {
    return { offers: [], error: reason, isDemo: false };
  }
  const filtered = filterDemoOffers(DEMO_OFFERS, params).slice(0, limit);
  const offers = filtered.length > 0 ? filtered : DEMO_OFFERS.slice(0, limit);
  return {
    offers: offers.map((o) => ({ ...o, _isDemo: true })),
    error: reason,
    isDemo: true,
  };
}

function filterDemoOffers(pool, params) {
  let out = pool.slice();
  if (Array.isArray(params.destinations) && params.destinations.length) {
    const wanted = params.destinations.map((d) => String(d).toLowerCase());
    out = out.filter((o) =>
      wanted.some(
        (w) =>
          o.destinationCountry.toLowerCase().includes(w) ||
          o.destinationName.toLowerCase().includes(w) ||
          (o._countryName || "").toLowerCase().includes(w)
      )
    );
  }
  if (params.type === "Flights") {
    out = out.filter((o) => o.type === "Flight");
  } else if (params.type === "Accommodation") {
    out = out.filter((o) => o.type === "Accommodation");
  }
  if (typeof params.ratingMin === "number" && params.ratingMin > 0) {
    out = out.filter((o) => (o.rating || 0) >= params.ratingMin);
  }
  if (typeof params.budgetMax === "number" && params.budgetMax > 0) {
    out = out.filter((o) => {
      const num = parsePoundString(o.formattedPPPrice);
      return num != null && num <= params.budgetMax;
    });
  }
  if (params.sort === "price:desc") {
    out.sort((a, b) =>
      (parsePoundString(b.formattedPPPrice) || 0) -
      (parsePoundString(a.formattedPPPrice) || 0)
    );
  } else if (params.sort === "random") {
    out.sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  } else {
    out.sort((a, b) =>
      (parsePoundString(a.formattedPPPrice) || 0) -
      (parsePoundString(b.formattedPPPrice) || 0)
    );
  }
  return out;
}

function parsePoundString(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function normaliseOffer(o) {
  if (!o || typeof o !== "object") return null;
  const acc = o.accommodation || {};
  const flight = o.flight || {};
  const accImg = acc.image && typeof acc.image === "object" ? acc.image.url : null;
  const flightImg = flight.image && typeof flight.image === "object" ? flight.image.url : null;
  const imageUrl = accImg || flightImg || null;
  const url = typeof o.url === "string" ? o.url : null;
  if (!url) return null;
  const accPricing = acc.pricing || {};
  const wasNumber =
    accPricing.priceChanged === true && typeof accPricing.priceBeforeChange === "number"
      ? Math.round(accPricing.priceBeforeChange)
      : null;
  const dest = (acc.destination && typeof acc.destination === "object" && acc.destination) || {};
  const origin = (flight.origin && typeof flight.origin === "object" && flight.origin) || {};

  return {
    id: typeof o.id === "string" ? o.id : null,
    url,
    type: o.type || (acc && acc.name ? "Accommodation" : flight && flight.carrier ? "Flight" : "Offer"),
    name: typeof acc.name === "string" ? acc.name : "",
    rating: typeof acc.rating === "number" ? acc.rating : null,
    destinationName: typeof dest.name === "string" ? dest.name : "",
    destinationCountry: typeof dest.countryCode === "string" ? dest.countryCode : "",
    nights: typeof acc.nights === "number" ? acc.nights : null,
    boardBasis: typeof acc.boardBasis === "string" ? acc.boardBasis : "",
    checkinDate: typeof acc.checkinDate === "string" ? acc.checkinDate : "",
    propertyType: typeof acc.propertyType === "string" ? acc.propertyType : "",
    departureAirport: typeof origin.name === "string" ? origin.name : "",
    departureDate: typeof flight.outboundDate === "string" ? flight.outboundDate : "",
    adults: typeof o.adults === "number" ? o.adults : 0,
    children: typeof o.children === "number" ? o.children : 0,
    infants: typeof o.infants === "number" ? o.infants : 0,
    formattedPrice: typeof o.formattedPrice === "string" ? o.formattedPrice : "",
    formattedPPPrice: typeof o.formattedPPPrice === "string" ? o.formattedPPPrice : "",
    wasFormatted: wasNumber != null ? `£${wasNumber.toLocaleString("en-GB")}` : null,
    imageUrl,
  };
}

// ──────────────────────────────────────────────────────────────────────
// DEMO OFFERS
// ──────────────────────────────────────────────────────────────────────

const DEMO_OFFERS = [
  {
    id: "demo-cy-paphos", url: "https://example.travel/offers/paphos", type: "Accommodation",
    name: "Annabelle", rating: 5,
    destinationName: "Paphos", destinationCountry: "CY", _countryName: "Cyprus",
    nights: 7, boardBasis: "HalfBoard", checkinDate: "2026-05-10", propertyType: "Hotel",
    departureAirport: "London Heathrow", departureDate: "2026-05-10",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£1,198", formattedPPPrice: "£599", wasFormatted: "£819",
    imageUrl: "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200&q=80",
  },
  {
    id: "demo-es-tenerife", url: "https://example.travel/offers/tenerife", type: "Accommodation",
    name: "Iberostar Selection Sábila", rating: 5,
    destinationName: "Costa Adeje", destinationCountry: "ES", _countryName: "Spain",
    nights: 7, boardBasis: "AllInclusive", checkinDate: "2026-05-18", propertyType: "Hotel",
    departureAirport: "London Gatwick", departureDate: "2026-05-18",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£1,378", formattedPPPrice: "£689", wasFormatted: "£829",
    imageUrl: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1200&q=80",
  },
  {
    id: "demo-gr-chania", url: "https://example.travel/offers/chania", type: "Accommodation",
    name: "Domes Noruz Chania", rating: 5,
    destinationName: "Chania", destinationCountry: "GR", _countryName: "Greece",
    nights: 7, boardBasis: "BedAndBreakfast", checkinDate: "2026-05-24", propertyType: "Hotel",
    departureAirport: "Manchester", departureDate: "2026-05-24",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£1,498", formattedPPPrice: "£749", wasFormatted: null,
    imageUrl: "https://images.unsplash.com/photo-1533104816931-20fa691ff6ca?w=1200&q=80",
  },
  {
    id: "demo-tr-bodrum", url: "https://example.travel/offers/bodrum", type: "Accommodation",
    name: "Mandarin Oriental Bodrum", rating: 5,
    destinationName: "Bodrum", destinationCountry: "TR", _countryName: "Turkey",
    nights: 7, boardBasis: "HalfBoard", checkinDate: "2026-06-12", propertyType: "Resort",
    departureAirport: "Birmingham", departureDate: "2026-06-12",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£1,798", formattedPPPrice: "£899", wasFormatted: "£1,049",
    imageUrl: "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=80",
  },
  {
    id: "demo-it-amalfi", url: "https://example.travel/offers/amalfi", type: "Accommodation",
    name: "Hotel Marincanto", rating: 4,
    destinationName: "Positano", destinationCountry: "IT", _countryName: "Italy",
    nights: 5, boardBasis: "BedAndBreakfast", checkinDate: "2026-06-20", propertyType: "Boutique",
    departureAirport: "London Heathrow", departureDate: "2026-06-20",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£2,098", formattedPPPrice: "£1,049", wasFormatted: null,
    imageUrl: "https://images.unsplash.com/photo-1513735492246-483525079686?w=1200&q=80",
  },
  {
    id: "demo-pt-albufeira", url: "https://example.travel/offers/albufeira", type: "Accommodation",
    name: "Pine Cliffs Resort", rating: 5,
    destinationName: "Albufeira", destinationCountry: "PT", _countryName: "Portugal",
    nights: 10, boardBasis: "HalfBoard", checkinDate: "2026-06-04", propertyType: "Resort",
    departureAirport: "Birmingham", departureDate: "2026-06-04",
    adults: 2, children: 2, infants: 0,
    formattedPrice: "£4,596", formattedPPPrice: "£1,149", wasFormatted: "£1,349",
    imageUrl: "https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=1200&q=80",
  },
  {
    id: "demo-mx-cancun", url: "https://example.travel/offers/cancun", type: "Accommodation",
    name: "Iberostar Selection Cancún", rating: 5,
    destinationName: "Cancún", destinationCountry: "MX", _countryName: "Mexico",
    nights: 10, boardBasis: "AllInclusive", checkinDate: "2026-09-08", propertyType: "Resort",
    departureAirport: "London Gatwick", departureDate: "2026-09-08",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£2,598", formattedPPPrice: "£1,299", wasFormatted: "£1,499",
    imageUrl: "https://images.unsplash.com/photo-1510097467424-192d713fd8b2?w=1200&q=80",
  },
  {
    id: "demo-es-mallorca", url: "https://example.travel/offers/mallorca", type: "Accommodation",
    name: "Sant Francesc Hotel Singular", rating: 5,
    destinationName: "Palma", destinationCountry: "ES", _countryName: "Spain",
    nights: 5, boardBasis: "BedAndBreakfast", checkinDate: "2026-05-22", propertyType: "Boutique",
    departureAirport: "Edinburgh", departureDate: "2026-05-22",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£1,098", formattedPPPrice: "£549", wasFormatted: null,
    imageUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80",
  },
  {
    id: "demo-gr-santorini", url: "https://example.travel/offers/santorini", type: "Accommodation",
    name: "Canaves Oia Suites", rating: 5,
    destinationName: "Oia", destinationCountry: "GR", _countryName: "Greece",
    nights: 5, boardBasis: "BedAndBreakfast", checkinDate: "2026-06-25", propertyType: "Boutique",
    departureAirport: "London Gatwick", departureDate: "2026-06-25",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£2,198", formattedPPPrice: "£1,099", wasFormatted: "£1,299",
    imageUrl: "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=1200&q=80",
  },
  {
    id: "demo-cy-ayianapa", url: "https://example.travel/offers/ayia-napa", type: "Accommodation",
    name: "Olympic Lagoon Resort", rating: 5,
    destinationName: "Ayia Napa", destinationCountry: "CY", _countryName: "Cyprus",
    nights: 7, boardBasis: "AllInclusive", checkinDate: "2026-06-08", propertyType: "Resort",
    departureAirport: "Manchester", departureDate: "2026-06-08",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£1,318", formattedPPPrice: "£659", wasFormatted: "£779",
    imageUrl: "https://images.unsplash.com/photo-1601581875309-fafbf2d3ed3a?w=1200&q=80",
  },
  {
    id: "demo-pt-lisbon", url: "https://example.travel/offers/lisbon", type: "Accommodation",
    name: "Bairro Alto Hotel", rating: 5,
    destinationName: "Lisbon", destinationCountry: "PT", _countryName: "Portugal",
    nights: 4, boardBasis: "BedAndBreakfast", checkinDate: "2026-05-15", propertyType: "Boutique",
    departureAirport: "Bristol", departureDate: "2026-05-15",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£818", formattedPPPrice: "£409", wasFormatted: null,
    imageUrl: "https://images.unsplash.com/photo-1555992336-fb0d29498b13?w=1200&q=80",
  },
  {
    id: "demo-us-keywest", url: "https://example.travel/offers/florida-keys", type: "Accommodation",
    name: "Casa Marina", rating: 4,
    destinationName: "Key West", destinationCountry: "US", _countryName: "United States",
    nights: 7, boardBasis: "RoomOnly", checkinDate: "2026-10-12", propertyType: "Resort",
    departureAirport: "London Heathrow", departureDate: "2026-10-12",
    adults: 2, children: 0, infants: 0,
    formattedPrice: "£2,798", formattedPPPrice: "£1,399", wasFormatted: null,
    imageUrl: "https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=1200&q=80",
  },
];

module.exports = { fetchOffers, normaliseOffer, ALLOWED_FETCH_KEYS, DEMO_OFFERS };

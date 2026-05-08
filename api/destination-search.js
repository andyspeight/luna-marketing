// api/destination-search.js
//
// Typeahead endpoint for the email-builder's destination chip input.
// Searches Andy's destination database (appuZdlMJ7HKUt6qS) which holds
// ~51 countries, 278 cities, 483 resorts. Returns up to 12 matches
// across all three tables, ranked by what the user typed.
//
// GET /api/destination-search?q=alga
//
// Returns: { results: [{ label, value, kind, country }] }
//   - label: human-readable for the chip ("Albufeira, Portugal")
//   - value: what gets stored in destinations[] ("Albufeira")
//   - kind:  'country' | 'city' | 'resort' (used for icon/grouping)
//   - country: parent country name (for context)
//
// Cached client-side after first hit so subsequent searches are
// instant. Rate-limited via the simple per-IP map below.

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const DEST_BASE = "appuZdlMJ7HKUt6qS";
const COUNTRIES_TABLE = "tblsxbqbyhTDoWhbo";
const CITIES_TABLE = "tblTkKujdVZgWPAQe";
const RESORTS_TABLE = "tblwV9gnbVEyZ99gI";

const MAX_RESULTS = 12;
const CACHE_TTL_MS = 10 * 60 * 1000;

// In-memory cache. The dataset is small (~810 records) so we can hold
// all three tables in memory and search locally — way faster than
// hitting Airtable on every keystroke and a fraction of the API quota.
let cachedAt = 0;
let cachedCountries = [];
let cachedCities = [];
let cachedResorts = [];

// Trivial per-IP rate limiter — 60 requests per minute is plenty for
// typeahead. Resets the bucket as keys age out.
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;

function rateLimit(ip) {
  const now = Date.now();
  const entry = rateBuckets.get(ip) || { count: 0, started: now };
  if (now - entry.started > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.started = now;
  }
  entry.count++;
  rateBuckets.set(ip, entry);
  // Trim every 100th call so the map can't grow unbounded
  if (rateBuckets.size > 1000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.started > RATE_WINDOW_MS * 5) rateBuckets.delete(k);
    }
  }
  return entry.count <= RATE_LIMIT;
}

async function airtablePage(table, fields) {
  const out = [];
  let offset = "";
  // Pull with field filtering to keep payload small
  const fieldsQs = fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
  for (let i = 0; i < 10; i++) {
    const url = `https://api.airtable.com/v0/${DEST_BASE}/${table}?pageSize=100&${fieldsQs}${offset ? `&offset=${offset}` : ""}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    });
    if (!r.ok) {
      throw new Error(`Airtable ${r.status}`);
    }
    const data = await r.json();
    out.push(...(data.records || []));
    if (!data.offset) break;
    offset = data.offset;
  }
  return out;
}

async function refreshCache() {
  // Field names per the destination-spotlight skills. "Name" is the
  // canonical field on every table; "Country" is on cities and resorts.
  const [countries, cities, resorts] = await Promise.all([
    airtablePage(COUNTRIES_TABLE, ["Name"]),
    airtablePage(CITIES_TABLE, ["Name", "Country"]),
    airtablePage(RESORTS_TABLE, ["Name", "Country"]),
  ]);

  cachedCountries = countries
    .map((r) => ({
      label: r.fields?.Name || "",
      value: r.fields?.Name || "",
      kind: "country",
      country: r.fields?.Name || "",
    }))
    .filter((x) => x.label);

  cachedCities = cities
    .map((r) => {
      const name = r.fields?.Name || "";
      const country = (Array.isArray(r.fields?.Country) ? r.fields.Country[0] : r.fields?.Country) || "";
      return {
        label: country ? `${name}, ${country}` : name,
        value: name,
        kind: "city",
        country,
      };
    })
    .filter((x) => x.label);

  cachedResorts = resorts
    .map((r) => {
      const name = r.fields?.Name || "";
      const country = (Array.isArray(r.fields?.Country) ? r.fields.Country[0] : r.fields?.Country) || "";
      return {
        label: country ? `${name}, ${country}` : name,
        value: name,
        kind: "resort",
        country,
      };
    })
    .filter((x) => x.label);

  cachedAt = Date.now();
}

function search(q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return [];
  const all = [...cachedCountries, ...cachedCities, ...cachedResorts];

  // Two-pass scoring — exact-prefix matches always beat substring matches
  const prefix = [];
  const contains = [];
  for (const item of all) {
    const hay = item.label.toLowerCase();
    if (hay.startsWith(needle)) prefix.push(item);
    else if (hay.includes(needle)) contains.push(item);
  }

  // Within each tier: countries first, then cities, then resorts.
  // Inside a kind, alphabetical.
  const order = { country: 0, city: 1, resort: 2 };
  const cmp = (a, b) =>
    order[a.kind] - order[b.kind] || a.label.localeCompare(b.label);
  prefix.sort(cmp);
  contains.sort(cmp);

  return [...prefix, ...contains].slice(0, MAX_RESULTS);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const q = String(req.query?.q || "").slice(0, 60);
  if (!q || q.length < 1) {
    return res.status(200).json({ results: [] });
  }

  try {
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
      await refreshCache();
    }
    const results = search(q);
    return res.status(200).json({ results });
  } catch (e) {
    console.error("[destination-search] error:", e.message);
    return res.status(500).json({ error: "Search failed" });
  }
};

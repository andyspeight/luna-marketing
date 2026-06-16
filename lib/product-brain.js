// lib/product-brain.js
//
// Product Brain — the knowledge core that keeps Luna's understanding of every
// Travelgenix product current.
//
// What this does:
//   - Fetches a product's dedicated page(s) (Source URLs) plus the main website
//   - Extracts the latest facts via Claude
//   - Merges them into a consolidated "Brain Summary" (latest facts the
//     composer reads alongside the canonical copy)
//   - Diffs the site against the canonical One-liner / Problem / Proof copy and
//     writes a Change Log of SUGGESTIONS for human review
//
// What this does NOT do:
//   - Overwrite the canonical humanised fields (One-liner / Problem / Proof).
//     Those are voice-matched by hand. The refresh only ever proposes changes
//     in the Change Log; a human applies them from the dashboard.
//   - Touch the Supplement field. That is the owner's authoritative input and
//     is fed to the extractor as ground truth, never edited.
//   - Handle HTTP, auth, or scheduling (those live in the api/ wrappers).
//
// Reused by:
//   - api/cron-product-brain.js   (daily, all products)
//   - api/product-brain.js        (on-demand "Refresh now" from the dashboard)
//
// Author: Travelgenix
// Date:   16 June 2026

const Anthropic = require("@anthropic-ai/sdk").default;

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const PRODUCTS_TABLE = "tblGBl8X3RIVnCwDM";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

// Extraction is factual, bulk (up to ~25 products/day) and runs unattended, so
// Sonnet is the right cost/quality point. Override with PRODUCT_BRAIN_MODEL.
const BRAIN_MODEL = process.env.PRODUCT_BRAIN_MODEL || "claude-sonnet-4-6";
const BRAIN_MAX_TOKENS = 2000;

// Field IDs for Product Library. Captured 16 June 2026. IDs survive renames.
const PL_FIELDS = {
  name:          "fldnm50uGn1DSddGr",
  oneLiner:      "fldXV1tORnZFlleRS",
  problem:       "fldc9vMT37lrqgLGq",
  proof:         "fldHQ828t2c8gVfAt",
  topics:        "fldtCzXIEVVja0FFD",
  status:        "fldiHSJWbQ8BGg37o",
  sourceUrls:    "fldhGDqtWNSoYCEE9",
  supplement:    "fldUUtnKa0rm5Bkk2",
  brainSummary:  "fldfYChzx3ixpLIb9",
  brainChangeLog:"fldwc7I8d7kOOwNOZ",
  brainRefreshed:"fldjIrS6hl32djXlA",
  brainStatus:   "fldsF2OdtTEKgdoDO"
};

// How long the Brain Summary is considered "Fresh" before it goes "Stale".
const FRESH_WINDOW_MS = 8 * 24 * 60 * 60 * 1000; // 8 days — a daily cron keeps it green

// Per-page fetch limits.
const FETCH_TIMEOUT_MS = 15000;
const MAX_PAGE_CHARS = 8000;   // readable text kept per page
const MAX_PAGES = 5;           // safety cap per product per run

// ─────────────────────────────────────────────────────────────────────
// AIRTABLE
// ─────────────────────────────────────────────────────────────────────

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Airtable ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Load the main website URL for a tenant (used as a fallback scan source so a
 * product with no dedicated Source URLs still gets refreshed from the homepage).
 */
async function loadMainWebsiteUrl(tenantId) {
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${tenantId}`;
    const rec = await airtableFetch(url);
    return (rec.fields && rec.fields["Website URL"]) || "";
  } catch (e) {
    console.warn("[product-brain] Couldn't load main website URL:", e.message);
    return "";
  }
}

/**
 * Fetch Active products for a tenant that have at least one Source URL.
 * Returns the raw Airtable records.
 */
async function listScannableProducts(tenantId) {
  const all = [];
  let offset = null;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCTS_TABLE}?${params.toString()}`;
    const data = await airtableFetch(url);
    (data.records || []).forEach(rec => all.push(rec));
    offset = data.offset;
  } while (offset);

  return all.filter(rec => {
    const f = rec.fields || {};
    const tenants = f["Tenant"] || [];
    if (!tenants.includes(tenantId)) return false;
    const statusName = typeof f["Status"] === "object" ? (f["Status"] && f["Status"].name) : f["Status"];
    if (statusName && statusName !== "Active") return false; // only Active products
    const urls = parseSourceUrls(f["Source URLs"]);
    return urls.length > 0;
  });
}

/**
 * Write the refreshed brain fields back to a product record.
 */
async function saveBrain(productId, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCTS_TABLE}/${productId}`;
  await airtableFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true })
  });
}

// ─────────────────────────────────────────────────────────────────────
// WEB FETCH + READABILITY
// ─────────────────────────────────────────────────────────────────────

function parseSourceUrls(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(u => (u.startsWith("http") ? u : "https://" + u))
    .filter(u => /^https?:\/\/[^\s]+$/i.test(u))
    .slice(0, MAX_PAGES);
}

/**
 * Strip an HTML document to readable plain text. Deliberately simple: removes
 * scripts/styles/markup, decodes the common entities, collapses whitespace,
 * and truncates. Good enough to feed an extractor without a heavy DOM dep.
 */
function htmlToReadableText(html) {
  if (!html) return "";
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&pound;/g, "£")
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)));

  text = text
    .split("\n")
    .map(l => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();

  return text.slice(0, MAX_PAGE_CHARS);
}

async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LunaMarketing/1.0; ProductBrain)", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}`, text: "" };
    const html = await res.text();
    return { url, ok: true, text: htmlToReadableText(html) };
  } catch (err) {
    return { url, ok: false, error: err.message || "fetch failed", text: "" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// EXTRACTION
// ─────────────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM = `You are Luna's product-knowledge librarian for Travelgenix, a travel technology company. Your job is to keep an accurate, current internal fact sheet ("Brain Summary") about ONE product, drawn from the company's own website pages.

This is an INTERNAL knowledge record, not customer-facing copy. Write it plainly and densely. UK English.

ABSOLUTE RULES:
- Only record facts that appear in the SCRAPED PAGES, the SUPPLEMENT, or the EXISTING canonical fields below. Never invent features, numbers, prices, integrations, partners, awards or claims.
- The SUPPLEMENT is owner-provided ground truth. It outranks the website if they ever conflict. Never contradict or discard it.
- If the pages are thin, empty, or failed to load, keep the existing summary and say so. Do not pad with guesses.
- Capture concrete specifics the marketing engine will need: what the product is and does, the problem it solves, proof points (real numbers, integrations, supplier counts, pricing), who it suits, primary calls to action, and any notable recent changes visible on the page.
- Do NOT name competitors.

You return STRICT JSON, no markdown fences, no preamble.`;

function buildExtractionUserMessage(product, pages) {
  const f = product.fields || {};
  const name = f["Name"] || "(unnamed product)";
  const lines = [];

  lines.push(`PRODUCT: ${name}`);
  lines.push("");
  lines.push("EXISTING CANONICAL COPY (carefully voice-matched by a human — do NOT rewrite, only compare against):");
  lines.push(`- One-liner: ${f["One-liner"] || "(blank)"}`);
  lines.push(`- Problem solved: ${f["Problem solved"] || "(blank)"}`);
  lines.push(`- Proof point: ${f["Proof point"] || "(blank)"}`);
  if (f["Topics"]) lines.push(`- Topics: ${f["Topics"]}`);
  lines.push("");
  lines.push("OWNER SUPPLEMENT (authoritative ground truth — outranks the website):");
  lines.push(f["Supplement"] ? f["Supplement"] : "(none provided)");
  lines.push("");
  lines.push("PREVIOUS BRAIN SUMMARY (your last understanding — update it, don't discard what's still true):");
  lines.push(f["Brain Summary"] ? f["Brain Summary"] : "(none yet)");
  lines.push("");
  lines.push("SCRAPED PAGES (latest content from the company's own site):");
  if (pages.length === 0) {
    lines.push("(no pages were fetched)");
  } else {
    pages.forEach(p => {
      lines.push(`\n----- PAGE: ${p.url} ${p.ok ? "" : `(FETCH FAILED: ${p.error})`} -----`);
      lines.push(p.text ? p.text : "(no readable content)");
    });
  }
  lines.push("");
  lines.push(`Return this exact JSON shape:
{
  "summary": "The updated Brain Summary. Plain, dense, factual bullet-style prose covering what the product is, the problem it solves, proof points, who it suits, the primary CTA, and any notable recent changes. Internal use.",
  "changes": [
    {
      "field": "One-liner | Problem solved | Proof point",
      "observation": "What the website now says that differs from the canonical copy above.",
      "suggestion": "A concise suggested replacement value, in Travelgenix voice. Omit if you only want to flag, not propose.",
      "confidence": "high | medium | low"
    }
  ],
  "fetchQuality": "good | partial | poor",
  "notes": "One short sentence on coverage, e.g. which pages were thin or failed."
}

If nothing material differs from the canonical copy, return an empty "changes" array. Output ONLY the JSON.`);

  return lines.join("\n");
}

function parseExtraction(rawText) {
  if (!rawText || typeof rawText !== "string") return { error: "empty response" };
  let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const first = cleaned.indexOf("{");
  if (first > 0) cleaned = cleaned.slice(first);
  // Match outermost braces
  let depth = 0, end = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end > 0) cleaned = cleaned.slice(0, end + 1);
  try {
    return { data: JSON.parse(cleaned) };
  } catch (e) {
    return { error: `JSON parse error: ${e.message}` };
  }
}

/**
 * Format a change-log block for the Airtable field. Newest run on top; we keep
 * only the most recent run's findings to stay readable (the dashboard shows
 * this verbatim).
 */
function formatChangeLog(changes, meta) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const head = `[${stamp}] ${meta.fetchQuality || "?"} fetch · ${meta.scannedCount} page(s)` +
    (meta.notes ? ` · ${meta.notes}` : "");
  if (!Array.isArray(changes) || changes.length === 0) {
    return `${head}\nNo suggested changes to canonical copy.`;
  }
  const body = changes.map(c => {
    const parts = [`• ${c.field} [${c.confidence || "?"}]`, `   site: ${c.observation || ""}`];
    if (c.suggestion) parts.push(`   suggested: ${c.suggestion}`);
    return parts.join("\n");
  }).join("\n");
  return `${head}\n${body}`;
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: refresh one product
// ─────────────────────────────────────────────────────────────────────

/**
 * Refresh a single product's brain.
 *
 * @param {Object} opts
 * @param {Object} opts.product        — the Airtable product record ({id, fields})
 * @param {string} [opts.mainWebsiteUrl] — tenant homepage, scanned as a fallback
 * @param {Anthropic} [opts.anthropic] — reusable client (created if absent)
 * @param {boolean} [opts.persist=true] — write results back to Airtable
 * @returns {Promise<Object>} result { ok, status, summary, changes, fields, error, scannedUrls }
 */
async function refreshProductBrain(opts) {
  const { product, persist = true } = opts;
  if (!product || !product.id) throw new Error("product record is required");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const anthropic = opts.anthropic || new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const f = product.fields || {};
  const name = f["Name"] || product.id;

  // Build the scan list: the product's own Source URLs, plus the main website
  // as a fallback context source (deduped).
  const urls = parseSourceUrls(f["Source URLs"]);
  if (opts.mainWebsiteUrl) {
    const main = opts.mainWebsiteUrl.startsWith("http") ? opts.mainWebsiteUrl : "https://" + opts.mainWebsiteUrl;
    if (!urls.includes(main)) urls.push(main);
  }
  const scanUrls = urls.slice(0, MAX_PAGES);

  if (scanUrls.length === 0) {
    return { ok: false, status: "Never", error: "No Source URLs to scan", scannedUrls: [] };
  }

  // Fetch all pages (parallel).
  const pages = await Promise.all(scanUrls.map(fetchPageText));
  const anyContent = pages.some(p => p.ok && p.text && p.text.length > 50);

  if (!anyContent) {
    const errFields = {
      [PL_FIELDS.brainStatus]: "Error",
      [PL_FIELDS.brainChangeLog]: formatChangeLog([], {
        fetchQuality: "poor",
        scannedCount: pages.length,
        notes: "All pages failed or returned no readable content."
      })
    };
    if (persist) await saveBrain(product.id, errFields);
    return {
      ok: false,
      status: "Error",
      error: "No readable content fetched from any source URL",
      scannedUrls: scanUrls,
      pages
    };
  }

  // Extract via Claude.
  const response = await anthropic.messages.create({
    model: BRAIN_MODEL,
    max_tokens: BRAIN_MAX_TOKENS,
    system: EXTRACTION_SYSTEM,
    messages: [{ role: "user", content: buildExtractionUserMessage(product, pages) }]
  });

  let rawText = "";
  for (const block of response.content) if (block.type === "text") rawText += block.text;

  const { data, error } = parseExtraction(rawText);
  if (error || !data || !data.summary) {
    const errFields = {
      [PL_FIELDS.brainStatus]: "Error",
      [PL_FIELDS.brainChangeLog]: formatChangeLog([], {
        fetchQuality: "partial",
        scannedCount: pages.length,
        notes: `Extractor returned unparseable output: ${error || "no summary"}`
      })
    };
    if (persist) await saveBrain(product.id, errFields);
    return { ok: false, status: "Error", error: error || "Extractor returned no summary", scannedUrls: scanUrls };
  }

  const changes = Array.isArray(data.changes) ? data.changes.filter(c => c && c.field) : [];
  const meta = {
    fetchQuality: data.fetchQuality || (pages.every(p => p.ok) ? "good" : "partial"),
    scannedCount: pages.filter(p => p.ok).length,
    notes: data.notes || ""
  };

  const fields = {
    [PL_FIELDS.brainSummary]: String(data.summary).slice(0, 95000),
    [PL_FIELDS.brainChangeLog]: formatChangeLog(changes, meta),
    [PL_FIELDS.brainRefreshed]: new Date().toISOString(),
    [PL_FIELDS.brainStatus]: "Fresh"
  };

  if (persist) await saveBrain(product.id, fields);

  return {
    ok: true,
    status: "Fresh",
    productId: product.id,
    name,
    summary: fields[PL_FIELDS.brainSummary],
    changes,
    changeLog: fields[PL_FIELDS.brainChangeLog],
    fetchQuality: meta.fetchQuality,
    scannedUrls: scanUrls,
    usage: response.usage
  };
}

/**
 * Compute the freshness status for a product based on its last-refreshed date.
 * Pure helper used by the dashboard so the UI and cron agree on "Stale".
 */
function freshnessFor(lastRefreshedIso) {
  if (!lastRefreshedIso) return "Never";
  const age = Date.now() - new Date(lastRefreshedIso).getTime();
  return age <= FRESH_WINDOW_MS ? "Fresh" : "Stale";
}

module.exports = {
  refreshProductBrain,
  listScannableProducts,
  loadMainWebsiteUrl,
  parseSourceUrls,
  htmlToReadableText,
  freshnessFor,
  saveBrain,
  PL_FIELDS,
  OWNER_CLIENT_ID,
  FRESH_WINDOW_MS,
  // exported for tests
  _internals: { buildExtractionUserMessage, parseExtraction, formatChangeLog }
};

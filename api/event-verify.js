/* ══════════════════════════════════════════
   LUNA MARKETING — SINGLE EVENT VERIFIER

   Verifies one event's existence, dates and location against authoritative
   web sources. Uses Claude Sonnet 4.6 with web search.

   Called internally by /api/events-verify-batch and exposed for one-off
   debugging. SSO-cookie auth, owner-gated.

   Request:
     POST /api/event-verify
     body: { id, name, dateStart, dateEnd, countries }
       id          — Airtable record id (for logging/return only)
       name        — Event name (e.g. "Monaco Grand Prix 2026")
       dateStart   — Stored start date (YYYY-MM-DD)
       dateEnd     — Stored end date (YYYY-MM-DD), optional
       countries   — Country/region string for sanity check, optional

   Response:
     {
       success: true,
       result: {
         confidence: "high" | "medium" | "low" | "not_found",
         datesMatch: boolean,
         verifiedDateStart: "YYYY-MM-DD" | null,
         verifiedDateEnd:   "YYYY-MM-DD" | null,
         sources: [ { url, publisher, claim } ],
         summary: "...",
         recommendedAction: "approve" | "update_dates" | "manual_review" | "reject"
       }
     }
   ══════════════════════════════════════════ */

const ID_HOST = "https://id.travelify.io";
const AT_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";
const ANTHROPIC_MODEL = "claude-sonnet-4-6"; // Sonnet 4.6 — far higher rate limit than Haiku

const ALLOWED_ORIGINS = [
  "https://luna-marketing.vercel.app",
  "https://marketing.travelify.io"
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function escFormula(s) {
  return String(s || "").replace(/'/g, "\\'");
}

// Same SSO-owner check as events-admin.js.
async function verifyOwner(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  let meData;
  try {
    const meRes = await fetch(ID_HOST + "/api/auth/me", {
      method: "GET",
      headers: { cookie: cookie }
    });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    meData = await meRes.json();
  } catch (e) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
  if (!meData || !meData.ok || !meData.user || !meData.user.email) {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const email = String(meData.user.email).trim().toLowerCase();
  const atKey = process.env.AIRTABLE_KEY;
  if (!atKey) return { ok: false, status: 500, error: "Server not configured" };

  const formula = encodeURIComponent(
    "LOWER({Monthly Report Email})='" + escFormula(email) + "'"
  );
  const url = "https://api.airtable.com/v0/" + AT_BASE + "/" + CLIENTS_TABLE
    + "?filterByFormula=" + formula + "&maxRecords=10";

  let records = [];
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + atKey } });
    if (!r.ok) return { ok: false, status: 502, error: "Client lookup failed" };
    const data = await r.json();
    records = (data && data.records) || [];
  } catch (e) {
    return { ok: false, status: 502, error: "Client lookup failed" };
  }

  if (records.length === 0) {
    return { ok: false, status: 403, error: "No client linked to your account" };
  }
  const isOwner = records.some(function (rec) { return rec.id === OWNER_CLIENT_ID; });
  if (!isOwner) return { ok: false, status: 403, error: "Not authorised" };
  return { ok: true, email: email };
}

// ── Claude verifier ─────────────────────────────────

function buildPrompt(event) {
  const lines = [
    "You are verifying an event for a UK travel marketing calendar. Your job is to check whether the event exists, when it actually takes place, and whether the stored dates are correct. Use web search to find authoritative sources.",
    "",
    "EVENT TO VERIFY:",
    "Name: " + (event.name || "(unknown)"),
    "Stored start date: " + (event.dateStart || "(none)"),
    "Stored end date: " + (event.dateEnd || "(none)"),
    "Stored country/region: " + (event.countries || "(none)"),
    "",
    "RULES:",
    "1. Use web search. Find at least 2 independent authoritative sources (official event site, governing body, major news, Wikipedia). Do NOT rely on travel blogs, booking sites, or aggregators.",
    "2. Cross-check the dates AND the location. A different event with the same name in the wrong country is not a match.",
    "3. CONFIDENCE RUBRIC:",
    "   - high      = 2+ authoritative sources agree exactly on the dates",
    "   - medium    = 1 authoritative source, OR 2+ sources with minor disagreement (a few days)",
    "   - low       = sources exist but disagree, or only weak sources found",
    "   - not_found = no credible evidence the event exists in the year of the stored start date",
    "4. If the stored dates are confirmed correct → datesMatch=true",
    "5. If the event is real but on different dates → datesMatch=false, fill verifiedDateStart/End",
    "6. If the event does not exist → confidence=not_found, datesMatch=false",
    "",
    "RETURN A JSON OBJECT — and ONLY that JSON object, no markdown, no preamble, no code fences:",
    "{",
    '  "confidence": "high" | "medium" | "low" | "not_found",',
    '  "datesMatch": true | false,',
    '  "verifiedDateStart": "YYYY-MM-DD" | null,',
    '  "verifiedDateEnd": "YYYY-MM-DD" | null,',
    '  "sources": [',
    '    { "url": "...", "publisher": "...", "claim": "Says event runs DD-DD MMM YYYY" }',
    '  ],',
    '  "summary": "One short paragraph: what you found, key sources, why this confidence level."',
    "}"
  ];
  return lines.join("\n");
}

async function callClaude(event) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    messages: [
      { role: "user", content: buildPrompt(event) }
    ]
  };

  // Retry once on 429 with backoff. Anthropic returns retry-after in seconds;
  // if absent, default to 35s so the per-minute window has time to drain.
  const maxAttempts = 2;
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (r.ok) {
      const data = await r.json();
      const textOut = (data.content || [])
        .filter(function (b) { return b && b.type === "text"; })
        .map(function (b) { return b.text || ""; })
        .join("\n")
        .trim();
      return textOut;
    }

    const txt = await r.text().catch(function () { return ""; });
    lastErr = "anthropic-" + r.status + ": " + txt.slice(0, 300);

    // Only retry on 429 and 529 (overloaded). Honour retry-after if provided.
    if ((r.status === 429 || r.status === 529) && attempt < maxAttempts) {
      const retryAfterSec = parseInt(r.headers.get("retry-after") || "0", 10);
      const waitMs = retryAfterSec > 0 ? Math.min(retryAfterSec * 1000, 65000) : 35000;
      await new Promise(function (resolve) { setTimeout(resolve, waitMs); });
      continue;
    }
    break;
  }

  throw new Error(lastErr || "anthropic-unknown-error");
}

function parseClaudeJson(text) {
  if (!text) return null;
  // Strip code fences if any leaked through.
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  // If there's prose around the JSON, grab the first {...} block.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    return null;
  }
}

function deriveAction(parsed) {
  if (!parsed) return "manual_review";
  const c = (parsed.confidence || "").toLowerCase();
  if (c === "not_found") return "reject";
  if (c === "high" && parsed.datesMatch === true) return "approve";
  if (c === "high" && parsed.datesMatch === false &&
      parsed.verifiedDateStart) return "update_dates";
  return "manual_review";
}

// Public — used by events-verify-batch.
async function verifyOne(event) {
  const text = await callClaude(event);
  const parsed = parseClaudeJson(text);
  if (!parsed) {
    return {
      confidence: "low",
      datesMatch: false,
      verifiedDateStart: null,
      verifiedDateEnd: null,
      sources: [],
      summary: "Could not parse verifier response. Raw: " + (text || "").slice(0, 500),
      recommendedAction: "manual_review"
    };
  }
  return {
    confidence: parsed.confidence || "low",
    datesMatch: !!parsed.datesMatch,
    verifiedDateStart: parsed.verifiedDateStart || null,
    verifiedDateEnd: parsed.verifiedDateEnd || null,
    sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 6) : [],
    summary: String(parsed.summary || "").slice(0, 1500),
    recommendedAction: deriveAction(parsed)
  };
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "method not allowed" });
  }

  const auth = await verifyOwner(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  const event = {
    id: body.id || "",
    name: body.name || "",
    dateStart: body.dateStart || "",
    dateEnd: body.dateEnd || "",
    countries: body.countries || ""
  };
  if (!event.name) {
    return res.status(400).json({ success: false, error: "name is required" });
  }

  try {
    const result = await verifyOne(event);
    return res.status(200).json({ success: true, id: event.id, result: result });
  } catch (err) {
    console.error("event-verify error", err);
    return res.status(500).json({
      success: false,
      error: String((err && err.message) || err).slice(0, 300)
    });
  }
};

// Export for events-verify-batch.js to import.
module.exports.verifyOne = verifyOne;

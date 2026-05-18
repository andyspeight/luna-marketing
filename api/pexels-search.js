// api/pexels-search.js
//
// Search Pexels for stock photography. Used for lifestyle imagery where AI
// generation isn't appropriate (beaches, people, real places).
//
// POST /api/pexels-search
// Body: {
//   tenantId: "recXXX",   // for auth, not used by Pexels
//   query: "greek islands beach sunset",
//   slot: "hero" | "feature-story" | etc — determines orientation/size,
//   perPage: 12  // optional, max 20
// }
//
// Returns: { ok, photos: [{id, url, photographer, photographerUrl, pexelsPageUrl, alt}] }
//
// Pexels licence: free for commercial use, attribution appreciated but not required.
// We auto-add a credit line in the email footer when Pexels images are used.
//
// Auth: session cookie. Read-only operation.
//
// Author: Travelgenix
// Date:   18 May 2026

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";

const PEXELS_API = "https://api.pexels.com/v1/search";
const MAX_QUERY_LEN = 200;
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 20;

// Maps slot keys to Pexels orientation preference
const SLOT_ORIENTATION = {
  "hero": "landscape",
  "hero-square": "square",
  "feature-story": "landscape",
  "card": "landscape",
  "thumbnail": "square",
  "banner": "landscape"
};

async function validateSession(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  try {
    const meRes = await fetch(`${ID_HOST}/api/auth/me`, {
      method: "GET",
      headers: { cookie: cookie }
    });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    const data = await meRes.json();
    if (!data || !data.ok || !data.user || !data.user.email) {
      return { ok: false, status: 401, error: "Invalid session" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    if (!PEXELS_API_KEY) {
      return res.status(500).json({ error: "PEXELS_API_KEY not configured" });
    }

    const body = req.body || {};
    if (!body.query || typeof body.query !== "string" || body.query.trim().length === 0) {
      return res.status(400).json({ error: "query is required" });
    }
    if (body.query.length > MAX_QUERY_LEN) {
      return res.status(400).json({ error: `query too long (max ${MAX_QUERY_LEN})` });
    }

    const session = await validateSession(req);
    if (!session.ok) return res.status(session.status).json({ error: session.error });

    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(body.perPage, 10) || DEFAULT_PER_PAGE));
    const orientation = body.slot && SLOT_ORIENTATION[body.slot] ? SLOT_ORIENTATION[body.slot] : "landscape";

    const url = `${PEXELS_API}?query=${encodeURIComponent(body.query)}&per_page=${perPage}&orientation=${orientation}`;
    const pexelsRes = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY }
    });

    if (!pexelsRes.ok) {
      const txt = await pexelsRes.text().catch(() => "");
      return res.status(502).json({ error: `Pexels API error: ${pexelsRes.status} ${txt.slice(0, 200)}` });
    }

    const data = await pexelsRes.json();
    const photos = (data.photos || []).map(p => ({
      id: p.id,
      url: p.src.large,                  // 940px wide — good email size
      thumbnailUrl: p.src.medium,        // 350px for picker grid
      width: p.width,
      height: p.height,
      photographer: p.photographer,
      photographerUrl: p.photographer_url,
      pexelsPageUrl: p.url,
      alt: p.alt || body.query,
      avgColor: p.avg_color
    }));

    return res.status(200).json({
      ok: true,
      query: body.query,
      orientation,
      photos,
      total: data.total_results || photos.length
    });

  } catch (err) {
    console.error("[pexels-search] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

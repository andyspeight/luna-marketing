// api/promotion-decide.js
//
// Vercel API route for the Promotion Engine.
//
// Authentication: internal-only via shared secret header.
//   Header: x-promotion-secret: <PROMOTION_ENGINE_SECRET env var>
//
// This route is NOT public. It is called by:
//   - cron-generate.js (when drafting social posts)
//   - api/email-compose.js (when drafting emails)
//   - api/blog-generate.js (when drafting blog posts)
//
// Author: Travelgenix
// Date:   14 May 2026

const { decide } = require("../lib/promotion-engine");

// ============================================================================
// SECURITY HEADERS
// ============================================================================

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

// ============================================================================
// AUTH
// ============================================================================

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function authorise(req) {
  const expected = process.env.PROMOTION_ENGINE_SECRET;
  if (!expected) {
    // Misconfigured server — fail closed.
    return { ok: false, reason: "PROMOTION_ENGINE_SECRET not configured" };
  }
  const provided = req.headers["x-promotion-secret"] || "";
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "Invalid or missing x-promotion-secret header" };
  }
  return { ok: true };
}

// ============================================================================
// HANDLER
// ============================================================================

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  // Method check
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check
  const auth = authorise(req);
  if (!auth.ok) {
    // Log internally, return generic to client
    console.warn(`[promotion-decide] Unauthorised request: ${auth.reason}`);
    return res.status(401).json({ error: "Unauthorised" });
  }

  // Parse body (Vercel parses JSON if Content-Type is application/json)
  let input;
  try {
    input = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  if (!input || typeof input !== "object") {
    return res.status(400).json({ error: "Body must be a JSON object" });
  }

  // Call the engine
  try {
    const decision = await decide(input);
    return res.status(200).json(decision);
  } catch (err) {
    // Log full error server-side, return generic to client
    console.error("[promotion-decide] Engine error:", err);
    return res.status(500).json({
      error: "Engine error",
      // Only include error detail in non-production environments
      detail: process.env.VERCEL_ENV === "production" ? undefined : String(err.message || err)
    });
  }
};

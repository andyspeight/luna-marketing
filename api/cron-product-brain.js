// api/cron-product-brain.js
//
// Daily Product Brain refresh.
//
// For the Travelgenix tenant (and any tenant passed via ?tenant=recXXX), scans
// every Active product that has Source URLs, re-extracts the latest facts from
// those pages, and updates the Brain Summary + Change Log + freshness on each
// Product Library record.
//
// It is "refresh only": it never rewrites the canonical One-liner / Problem /
// Proof copy. Differences against the website are logged as suggestions for the
// owner to apply from the Product Brain dashboard.
//
// Triggered by Vercel cron (see vercel.json). Vercel sends
//   Authorization: Bearer <CRON_SECRET>
// automatically when CRON_SECRET is set, matching the existing crons.
//
// Manual run (owner): POST with the same bearer header, optional body
//   { tenantId, productIds: [...] } to scope the run.
//
// Author: Travelgenix
// Date:   16 June 2026

const Anthropic = require("@anthropic-ai/sdk").default;
const {
  refreshProductBrain,
  listScannableProducts,
  loadMainWebsiteUrl,
  OWNER_CLIENT_ID
} = require("../lib/product-brain");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const AUDIT_LOG_TABLE = "Audit Log";

// Stay well inside the 300s function budget: process sequentially, stop early
// if we are running low on time, and leave the rest for tomorrow's run.
const TIME_BUDGET_MS = 270 * 1000;
// Small gap between products to be gentle on the website + Anthropic rate limits.
const INTER_PRODUCT_DELAY_MS = 400;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function writeAuditLog(details) {
  if (!AIRTABLE_KEY) return;
  try {
    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`;
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [{
          fields: {
            "Event ID": eventId,
            "Timestamp": new Date().toISOString(),
            "Actor": "product-brain-cron",
            "Action": "edit",
            "Subject Type": "product",
            "Details": JSON.stringify(details).slice(0, 5000)
          }
        }],
        typecast: true
      })
    });
  } catch (e) {
    console.error("[cron-product-brain] audit log failed (non-fatal):", e.message);
  }
}

module.exports = async (req, res) => {
  // Auth — same bearer pattern as the other crons.
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!ANTHROPIC_API_KEY || !AIRTABLE_KEY) {
    return res.status(500).json({ error: "Service not configured (missing keys)" });
  }

  const startedAt = Date.now();
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const tenantId = body.tenantId || req.query.tenant || OWNER_CLIENT_ID;
  const onlyIds = Array.isArray(body.productIds) ? body.productIds : null;

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const mainWebsiteUrl = await loadMainWebsiteUrl(tenantId);

    let products = await listScannableProducts(tenantId);
    if (onlyIds) products = products.filter(p => onlyIds.includes(p.id));

    const results = [];
    let refreshed = 0, failed = 0, skipped = 0;

    for (const product of products) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        skipped = products.length - results.length;
        console.warn(`[cron-product-brain] time budget reached, deferring ${skipped} product(s)`);
        break;
      }
      const name = (product.fields && product.fields["Name"]) || product.id;
      try {
        const r = await refreshProductBrain({ product, mainWebsiteUrl, anthropic, persist: true });
        if (r.ok) {
          refreshed++;
          results.push({ id: product.id, name, status: r.status, changes: (r.changes || []).length, fetchQuality: r.fetchQuality });
        } else {
          failed++;
          results.push({ id: product.id, name, status: r.status, error: r.error });
        }
      } catch (e) {
        failed++;
        console.error(`[cron-product-brain] ${name} failed:`, e.message);
        results.push({ id: product.id, name, status: "Error", error: e.message });
      }
      await sleep(INTER_PRODUCT_DELAY_MS);
    }

    const summary = {
      tenantId,
      total: products.length,
      refreshed,
      failed,
      skipped,
      elapsedMs: Date.now() - startedAt
    };
    await writeAuditLog({ type: "product-brain-refresh", ...summary, results });

    return res.status(200).json({ ok: true, ...summary, results });
  } catch (err) {
    console.error("[cron-product-brain] fatal:", err);
    await writeAuditLog({ type: "product-brain-refresh", fatal: err.message, tenantId });
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};

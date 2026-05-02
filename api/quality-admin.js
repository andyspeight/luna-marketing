// api/quality-admin.js
// Day 6.5 quality admin endpoint. Lets Andy run quality operations from curl.
//
// PATCHED 2 May 2026 (Day 6.5 fix-2):
//   - Fixed the Airtable formula. ARRAYJOIN({Client}, ',') returns primary
//     field values (e.g. "Travelgenix") not record IDs, so FIND for the
//     record ID was always returning 0. Replaced with a primary-field match
//     against the client business name.
//
// Auth: Bearer CRON_SECRET
//
// Actions (POST body { action: '...' }):
//   - 'preview-delete': Lists all non-published posts for Travelgenix.
//   - 'nuclear-delete': Deletes all non-published Travelgenix posts.
//   - 'audit-existing': Runs the validator over Travelgenix's posts.
//   - 'validate-text': Validates a single piece of text.

const { validateContent, validatePost } = require("./validate-content.js");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const POST_QUEUE_TABLE = "Post Queue";
const TRAVELGENIX_CLIENT_ID = "recFXQY7be6gMr4In";
const TRAVELGENIX_BUSINESS_NAME = "Travelgenix";
const CRON_SECRET = process.env.CRON_SECRET;

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error ${r.status}: ${err}`);
  }
  return r.json();
}

async function listAll(table, params = "") {
  const all = [];
  let offset = "";
  let safety = 0;
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?${params}${offset ? `&offset=${offset}` : ""}`;
    const data = await airtableFetch(url);
    all.push(...(data.records || []));
    offset = data.offset || "";
    if (++safety > 50) break;
  } while (offset);
  return all;
}

// FIXED: ARRAYJOIN({Client}, ',') returns the primary field values of the
// linked records (e.g. "Travelgenix"), not the record IDs. So we match
// against the business name. If you ever rename the Travelgenix client
// record's primary field, update TRAVELGENIX_BUSINESS_NAME above.
async function getNonPublishedTravelgenixPosts() {
  const formula = encodeURIComponent(
    `AND(NOT({Status}='Published'), FIND('${TRAVELGENIX_BUSINESS_NAME}', ARRAYJOIN({Client}, ',')))`
  );
  return listAll(POST_QUEUE_TABLE, `filterByFormula=${formula}`);
}

async function deleteRecords(recordIds) {
  const deleted = [];
  for (let i = 0; i < recordIds.length; i += 10) {
    const batch = recordIds.slice(i, i + 10);
    const params = batch.map(id => `records[]=${id}`).join("&");
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(POST_QUEUE_TABLE)}?${params}`;
    const r = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Delete batch failed: ${r.status} ${err}`);
    }
    const data = await r.json();
    for (const rec of (data.records || [])) {
      if (rec.deleted) deleted.push(rec.id);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return deleted;
}

async function previewDelete() {
  const posts = await getNonPublishedTravelgenixPosts();
  return {
    success: true,
    action: "preview-delete",
    count: posts.length,
    breakdown: posts.reduce((acc, p) => {
      const status = p.fields["Status"] || "(no status)";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {}),
    sample: posts.slice(0, 5).map(p => ({
      id: p.id,
      title: p.fields["Post Title"] || "(untitled)",
      status: p.fields["Status"],
      scheduledDate: p.fields["Scheduled Date"],
    })),
    message: `Would delete ${posts.length} posts. Run 'nuclear-delete' to proceed.`,
  };
}

async function nuclearDelete() {
  const posts = await getNonPublishedTravelgenixPosts();
  if (posts.length === 0) {
    return { success: true, action: "nuclear-delete", deleted: 0, message: "Nothing to delete." };
  }
  const ids = posts.map(p => p.id);
  const deleted = await deleteRecords(ids);
  return {
    success: true,
    action: "nuclear-delete",
    deleted: deleted.length,
    requested: ids.length,
    message: `Deleted ${deleted.length} of ${ids.length} non-published Travelgenix posts.`,
  };
}

async function auditExisting() {
  const posts = await getNonPublishedTravelgenixPosts();
  const results = [];
  for (const post of posts) {
    const validation = validatePost(post.fields);
    if (validation.severity !== "pass") {
      results.push({
        id: post.id,
        title: post.fields["Post Title"] || "(untitled)",
        status: post.fields["Status"],
        severity: validation.severity,
        issues: validation.issues.map(i => `[${i.field}] ${i.code}: ${i.detail.slice(0, 100)}`),
      });
    }
  }
  const failCount = results.filter(r => r.severity === "fail").length;
  const warnCount = results.filter(r => r.severity === "warn").length;
  return {
    success: true,
    action: "audit-existing",
    totalPosts: posts.length,
    cleanCount: posts.length - results.length,
    failCount,
    warnCount,
    results: results.slice(0, 50),
    message: `Audited ${posts.length} posts. ${failCount} would be blocked. ${warnCount} have warnings.`,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body || {};
    const action = body.action;

    switch (action) {
      case "preview-delete":
        return res.status(200).json(await previewDelete());

      case "nuclear-delete":
        return res.status(200).json(await nuclearDelete());

      case "audit-existing":
        return res.status(200).json(await auditExisting());

      case "validate-text":
        if (!body.text) return res.status(400).json({ error: "text required" });
        return res.status(200).json({
          success: true,
          action: "validate-text",
          ...validateContent(body.text),
        });

      default:
        return res.status(400).json({
          error: `Unknown action: ${action}`,
          availableActions: ["preview-delete", "nuclear-delete", "audit-existing", "validate-text"],
        });
    }
  } catch (e) {
    console.error("Quality admin error:", e);
    return res.status(500).json({ error: e.message });
  }
};

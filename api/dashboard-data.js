// api/dashboard-data.js
// Aggregates dashboard KPIs, actions, leads, posts and activity for a single client.
// Called by the client portal Dashboard tab.
//
// GET /api/dashboard-data?clientId=recXXX
//
// No auth required — same model as other client portal endpoints (the clientId acts
// as the access scope). The portal already authenticates the user separately.

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const POST_QUEUE_TABLE = "tblbhyiuULvedva0K";
const HOT_LEADS_TABLE = "tblIVV8MVyji3UmUV";
const ATTRIBUTION_TABLE = "tbldTine226HJbsxV";

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Airtable error: ${r.status} ${r.statusText}`);
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
    if (++safety > 20) break;
  } while (offset);
  return all;
}

async function getClient(clientId) {
  const r = await airtableFetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${clientId}`
  );
  return r;
}

async function getPostsByBusinessName(businessName) {
  if (!businessName) return [];
  const safeName = businessName.replace(/'/g, "\\'");
  const formula = encodeURIComponent(
    `FIND('${safeName}', ARRAYJOIN({Client}, ','))`
  );
  return listAll(POST_QUEUE_TABLE, `filterByFormula=${formula}&pageSize=100`);
}

async function getRecentLeads(limit = 10) {
  const sortQuery = "&sort%5B0%5D%5Bfield%5D=Captured&sort%5B0%5D%5Bdirection%5D=desc";
  return listAll(HOT_LEADS_TABLE, `pageSize=${limit}${sortQuery}`);
}

async function getRecentAttribution(limit = 50) {
  const sortQuery = "&sort%5B0%5D%5Bfield%5D=Event Date&sort%5B0%5D%5Bdirection%5D=desc";
  return listAll(ATTRIBUTION_TABLE, `pageSize=${limit}${sortQuery}`);
}

// Score a post for action prioritisation
function scorePostAction(post) {
  const status = post.fields["Status"] || "";
  const channel = post.fields["Target Channel"] || "";
  const scheduled = post.fields["Scheduled Date"];
  
  let score = 0;
  let action = null;
  
  if (status === "Quality Hold") {
    score = 100;
    action = "Review Quality Hold";
  } else if (status === "Awaiting Approval" || status === "Queued") {
    score = 50;
    action = "Approve and schedule";
  } else if (status === "Approved" && channel === "LinkedIn Personal" && scheduled) {
    const today = new Date().toISOString().split("T")[0];
    if (scheduled <= today) {
      score = 75;
      action = "Post first comment";
    }
  } else if (status === "Failed") {
    score = 60;
    action = "Retry or rewrite";
  }
  
  return { score, action };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const clientId = req.query.clientId;
    if (!clientId || !clientId.startsWith("rec")) {
      return res.status(400).json({ error: "Valid clientId is required" });
    }

    // Load client first to get the business name (primary field).
    // We need it before querying posts because Airtable's ARRAYJOIN on
    // multipleRecordLinks returns primary field VALUES, not record IDs.
    const client = await getClient(clientId).catch(() => null);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    const clientFields = client.fields || {};
    const businessName = clientFields["Business Name"] || "Client";

    // Now load the rest in parallel
    const [posts, leads, attribution] = await Promise.all([
      getPostsByBusinessName(businessName).catch(() => []),
      getRecentLeads(10).catch(() => []),
      getRecentAttribution(50).catch(() => []),
    ]);

    // ── KPIs ──
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const postsLast7 = posts.filter(p => {
      const date = p.fields["Scheduled Date"];
      return date && new Date(date) >= sevenDaysAgo;
    }).length;

    const publishedLast7 = posts.filter(p => {
      const date = p.fields["Scheduled Date"];
      return p.fields["Status"] === "Published" && date && new Date(date) >= sevenDaysAgo;
    }).length;

    const awaitingApproval = posts.filter(p =>
      p.fields["Status"] === "Awaiting Approval" || p.fields["Status"] === "Queued"
    ).length;

    const qualityHold = posts.filter(p => p.fields["Status"] === "Quality Hold").length;

    const newLeadsCount = leads.filter(l => {
      const captured = l.fields["Captured"];
      return l.fields["Status"] === "New" && captured && new Date(captured) >= sevenDaysAgo;
    }).length;

    // Engagement totals across last 30 days of published posts
    const recentPublished = posts.filter(p => {
      const date = p.fields["Scheduled Date"];
      return p.fields["Status"] === "Published" && date && new Date(date) >= thirtyDaysAgo;
    });

    const totalReach = recentPublished.reduce((s, p) => s + (p.fields["Reach"] || 0), 0);
    const totalLikes = recentPublished.reduce((s, p) => s + (p.fields["Likes"] || 0), 0);
    const totalComments = recentPublished.reduce((s, p) => s + (p.fields["Comments"] || 0), 0);
    const totalClicks = recentPublished.reduce((s, p) => s + (p.fields["Clicks"] || 0), 0);

    // Conversions from attribution
    const recentConversions = attribution.filter(a => {
      const date = a.fields["Event Date"];
      return date && new Date(date) >= thirtyDaysAgo;
    });

    const kpis = {
      postsScheduled: postsLast7,
      postsPublished: publishedLast7,
      awaitingApproval,
      qualityHold,
      newLeads: newLeadsCount,
      totalReach30d: totalReach,
      totalEngagement30d: totalLikes + totalComments,
      totalClicks30d: totalClicks,
      conversions30d: recentConversions.length,
    };

    // ── Actions (top 5 things to do today) ──
    const actions = posts
      .map(p => {
        const { score, action } = scorePostAction(p);
        if (!action) return null;
        return {
          id: p.id,
          title: p.fields["Post Title"] || "(untitled)",
          status: p.fields["Status"],
          channel: p.fields["Target Channel"] || "",
          scheduledDate: p.fields["Scheduled Date"] || null,
          action,
          score,
          qualityIssues: p.fields["Quality Issues"] || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // ── Leads (top 5 most recent) ──
    const recentLeads = leads.slice(0, 5).map(l => ({
      id: l.id,
      title: l.fields["Lead Title"] || "",
      authorName: l.fields["Author Name"] || "",
      authorTitle: l.fields["Author Title"] || "",
      authorCompany: l.fields["Author Company"] || "",
      leadType: l.fields["Lead Type"] || "",
      score: l.fields["Score"] || 0,
      status: l.fields["Status"] || "",
      capturedAt: l.fields["Captured"] || null,
      hasComment: !!l.fields["Suggested Comment"],
    }));

    // ── Recent activity (last 10 events) ──
    const activity = [
      ...recentPublished.slice(0, 5).map(p => ({
        type: "post_published",
        timestamp: p.fields["Scheduled Date"] || "",
        title: p.fields["Post Title"] || "",
        channel: p.fields["Target Channel"] || "",
      })),
      ...recentConversions.slice(0, 5).map(a => ({
        type: "conversion",
        timestamp: a.fields["Event Date"] || "",
        title: a.fields["Event Type"] || "Conversion",
        source: a.fields["UTM Source"] || "",
      })),
    ]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);

    return res.status(200).json({
      success: true,
      client: {
        id: clientId,
        name: businessName,
        type: clientFields["Client Type"] || "b2c-travel",
        package: clientFields["Package"] || "",
        primaryColor: clientFields["Primary Colour"] || "#0ABAB5",
      },
      kpis,
      actions,
      recentLeads,
      activity,
    });
  } catch (e) {
    console.error("Dashboard data error:", e);
    return res.status(500).json({ error: e.message });
  }
};

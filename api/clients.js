const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const QUEUE_TABLE = "tblbhyiuULvedva0K";

async function fetchAllClients() {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!res.ok) throw new Error("Failed to fetch clients: " + res.statusText);
  const data = await res.json();
  return data.records || [];
}

async function fetchPostStats() {
  // Get all posts from the queue
  let allRecords = [];
  let offset = null;

  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}?fields%5B%5D=Client&fields%5B%5D=Status&fields%5B%5D=Reach&fields%5B%5D=Likes&fields%5B%5D=Comments&fields%5B%5D=Shares&fields%5B%5D=Clicks&fields%5B%5D=Image%20URL&fields%5B%5D=Destination&fields%5B%5D=Content%20Type&pageSize=100${offset ? "&offset=" + offset : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    allRecords = allRecords.concat(data.records || []);
    offset = data.offset || null;
  } while (offset);

  return allRecords;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const [clients, posts] = await Promise.all([
      fetchAllClients(),
      fetchPostStats(),
    ]);

    // Build stats per client
    const clientStats = {};
    for (const post of posts) {
      const clientLinks = post.fields.Client || [];
      const clientId = clientLinks[0] || "unknown";

      if (!clientStats[clientId]) {
        clientStats[clientId] = {
          total_posts: 0,
          queued: 0,
          published: 0,
          suppressed: 0,
          failed: 0,
          total_reach: 0,
          total_likes: 0,
          total_comments: 0,
          total_shares: 0,
          total_clicks: 0,
          has_images: 0,
        };
      }

      const stats = clientStats[clientId];
      stats.total_posts++;

      const status = post.fields.Status;
      const statusName =
        typeof status === "object" ? status.name : status || "";
      if (statusName === "Queued") stats.queued++;
      else if (statusName === "Published") stats.published++;
      else if (statusName === "Suppressed") stats.suppressed++;
      else if (statusName === "Failed") stats.failed++;

      stats.total_reach += post.fields.Reach || 0;
      stats.total_likes += post.fields.Likes || 0;
      stats.total_comments += post.fields.Comments || 0;
      stats.total_shares += post.fields.Shares || 0;
      stats.total_clicks += post.fields.Clicks || 0;

      if (post.fields["Image URL"]) stats.has_images++;
    }

    // Format client list
    const clientList = clients.map((c) => {
      const f = c.fields;
      const stats = clientStats[c.id] || {
        total_posts: 0,
        queued: 0,
        published: 0,
        suppressed: 0,
        failed: 0,
        total_reach: 0,
        total_likes: 0,
        total_comments: 0,
        total_shares: 0,
        total_clicks: 0,
        has_images: 0,
      };

      const statusVal = f.Status;
      const statusName =
        typeof statusVal === "object" ? statusVal.name : statusVal || "";
      const packageVal = f.Package;
      const packageName =
        typeof packageVal === "object" ? packageVal.name : packageVal || "";

      return {
        id: c.id,
        business_name: f["Business Name"] || "",
        trading_name: f["Trading Name"] || "",
        website: f["Website URL"] || "",
        status: statusName,
        package: packageName,
        destinations: f.Destinations || "",
        specialisms: Array.isArray(f.Specialisms)
          ? f.Specialisms.map((s) => (typeof s === "object" ? s.name : s))
          : [],
        posting_frequency: f["Posting Frequency"] || 3,
        tone: f["Tone Keywords"] || "",
        fb_connected: !!f["FB Page ID"],
        ig_connected: !!f["IG Account ID"],
        li_connected: !!f["LinkedIn Page ID"],
        stats,
      };
    });

    // Aggregate totals
    const totals = {
      total_clients: clientList.length,
      active: clientList.filter((c) => c.status === "Active").length,
      paused: clientList.filter((c) => c.status === "Paused").length,
      onboarding: clientList.filter((c) => c.status === "Onboarding").length,
      error: clientList.filter((c) => c.status === "Error").length,
      total_posts: posts.length,
      total_queued: posts.filter((p) => {
        const s = p.fields.Status;
        return (typeof s === "object" ? s.name : s) === "Queued";
      }).length,
      total_published: posts.filter((p) => {
        const s = p.fields.Status;
        return (typeof s === "object" ? s.name : s) === "Published";
      }).length,
      total_suppressed: posts.filter((p) => {
        const s = p.fields.Status;
        return (typeof s === "object" ? s.name : s) === "Suppressed";
      }).length,
    };

    return res.status(200).json({
      success: true,
      totals,
      clients: clientList,
    });
  } catch (err) {
    console.error("Clients API error:", err);
    return res.status(500).json({ error: err.message });
  }
};

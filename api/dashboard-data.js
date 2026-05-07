// api/dashboard-data.js
// Aggregated data feed for the Luna Marketing dashboard tab inside the client portal.
//
// PATCHED 2 May 2026: matches by business name primary field instead of record ID
// because ARRAYJOIN of a multipleRecordLinks field returns primary field VALUES.
//
// Auth: clientId in query/body. Looks up the client and only serves data if
// Client Type is 'b2b-saas' (Travelgenix today, future B2B clients tomorrow).
//
// Returns:
//   - client (name, package)
//   - kpis (last 30d metrics with delta vs previous 30d)
//   - actions (counts for the action cards)
//   - pendingPosts (top 8 posts awaiting approval)
//   - hotLeads (top 3 drafted hot leads)
//   - pendingEmails (top emails awaiting approval)
//   - recentActivity (last 10 timeline events)
//   - topPost (best post in last 30d by reach)

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const CLIENTS_TABLE = "Clients";
const POST_QUEUE_TABLE = "Post Queue";
const HOT_LEADS_TABLE = "Hot Leads";
const EMAIL_QUEUE_TABLE = "Email Queue";
const ATTRIBUTION_TABLE = "Attribution";

// ── Airtable helpers ──

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error: ${r.status} ${err}`);
  }
  return r.json();
}

async function listAll(table, params = "") {
  const allRecords = [];
  let offset = "";
  let safety = 0;
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?${params}${offset ? `&offset=${offset}` : ""}`;
    const data = await airtableFetch(url);
    allRecords.push(...(data.records || []));
    offset = data.offset || "";
    if (++safety > 20) break;
  } while (offset);
  return allRecords;
}

// Escape single quotes for safe inclusion in Airtable formulas
function escapeForFormula(value) {
  return String(value || "").replace(/'/g, "\\'");
}

// ── Auth ──
// Look up the client by recordId and confirm Client Type is b2b-saas.

async function authenticateClient(clientId) {
  if (!clientId || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(CLIENTS_TABLE)}/${clientId}`;
  try {
    const data = await airtableFetch(url);
    if (!data || !data.fields) return null;
    const clientType = (data.fields["Client Type"] || "").toLowerCase();
    if (clientType !== "b2b-saas") return null;
    return { id: data.id, ...data.fields };
  } catch {
    return null;
  }
}

// ── Date helpers ──

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function timeAgo(dateString) {
  if (!dateString) return "";
  const then = new Date(dateString).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "1 day ago";
  if (diffDay < 7) return `${diffDay} days ago`;
  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 4) return `${diffWk} wk ago`;
  return new Date(dateString).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatScheduled(dateStr, timeStr) {
  if (!dateStr) return "Not scheduled";
  const d = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = d.toDateString() === now.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  let day;
  if (isToday) day = "Today";
  else if (isTomorrow) day = "Tomorrow";
  else day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return timeStr ? `${day} ${timeStr}` : day;
}

function pctDelta(current, previous) {
  if (previous === 0 || !previous) return current > 0 ? "+100%" : "0%";
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta)}%`;
}

// ── Builders ──
//
// IMPORTANT: All client filters now use the business name (not record ID) because
// ARRAYJOIN({Client}, ',') returns primary field values, not IDs.

async function buildKpis(businessName) {
  const safeName = escapeForFormula(businessName);
  const last30Start = isoDaysAgo(30);
  const prev30Start = isoDaysAgo(60);

  // Posts published in last 60 days for this client (split into current/previous)
  const postsParams = `filterByFormula=${encodeURIComponent(
    `AND({Status}='Published', IS_AFTER({Scheduled Date}, '${prev30Start}'), FIND('${safeName}', ARRAYJOIN({Client}, ',')))`
  )}`;
  const posts = await listAll(POST_QUEUE_TABLE, postsParams);

  const current = posts.filter(p => {
    const d = p.fields["Scheduled Date"];
    return d && d >= last30Start.split("T")[0];
  });
  const previous = posts.filter(p => {
    const d = p.fields["Scheduled Date"];
    return d && d < last30Start.split("T")[0] && d >= prev30Start.split("T")[0];
  });

  const sumField = (recs, field) => recs.reduce((s, r) => s + (Number(r.fields[field]) || 0), 0);

  const currentReach = sumField(current, "Reach");
  const previousReach = sumField(previous, "Reach");
  const currentClicks = sumField(current, "Clicks");
  const previousClicks = sumField(previous, "Clicks");

  // Attribution events (last 30d vs previous 30d)
  const attribParams = `filterByFormula=${encodeURIComponent(
    `IS_AFTER({Event Date}, '${prev30Start}')`
  )}`;
  const attribEvents = await listAll(ATTRIBUTION_TABLE, attribParams);

  const currentAttrib = attribEvents.filter(e => {
    const d = e.fields["Event Date"];
    return d && d >= last30Start;
  });
  const previousAttrib = attribEvents.filter(e => {
    const d = e.fields["Event Date"];
    return d && d < last30Start && d >= prev30Start;
  });

  const currentDemos = currentAttrib.filter(e => e.fields["Event Type"] === "Calendly Booking").length;
  const previousDemos = previousAttrib.filter(e => e.fields["Event Type"] === "Calendly Booking").length;
  const currentVisits = currentAttrib.filter(e => e.fields["Event Type"] === "Page Visit").length;
  const previousVisits = previousAttrib.filter(e => e.fields["Event Type"] === "Page Visit").length;

  // Email metrics — sent in last 30d
  const emailParams = `filterByFormula=${encodeURIComponent(
    `AND({Status}='Sent', IS_AFTER({Sent At}, '${last30Start}'))`
  )}`;
  const sentEmails = await listAll(EMAIL_QUEUE_TABLE, emailParams);
  const totalRecipients = sumField(sentEmails, "Recipients Count");
  const totalOpens = sumField(sentEmails, "Opens");
  const totalEmailClicks = sumField(sentEmails, "Clicks");

  const openRate = totalRecipients > 0 ? ((totalOpens / totalRecipients) * 100).toFixed(1) : "0.0";
  const ctr = totalOpens > 0 ? ((totalEmailClicks / totalOpens) * 100).toFixed(1) : "0.0";

  return {
    postsPublished: current.length,
    postsPublishedDelta: pctDelta(current.length, previous.length),
    postReach: currentReach,
    postReachDelta: pctDelta(currentReach, previousReach),
    profileVisits: currentVisits,
    profileVisitsDelta: pctDelta(currentVisits, previousVisits),
    websiteClicks: currentClicks,
    websiteClicksDelta: pctDelta(currentClicks, previousClicks),
    demoBookings: currentDemos,
    demoBookingsDelta: pctDelta(currentDemos, previousDemos),
    emailOpenRate: openRate + "%",
    emailClickRate: ctr + "%",
  };
}

async function buildActions(businessName) {
  const safeName = escapeForFormula(businessName);
  const clientFilter = `FIND('${safeName}', ARRAYJOIN({Client}, ','))`;

  const pendingPostsParams = `filterByFormula=${encodeURIComponent(
    `AND(OR({Status}='Awaiting Approval', {Status}='Generated', {Status}='Pending', {Status}='Queued'), ${clientFilter})`
  )}&fields%5B%5D=Status&maxRecords=100`;
  const pendingPosts = await listAll(POST_QUEUE_TABLE, pendingPostsParams);

  const qualityHoldParams = `filterByFormula=${encodeURIComponent(
    `AND({Status}='Quality Hold', ${clientFilter})`
  )}&fields%5B%5D=Status&maxRecords=100`;
  const qualityHoldPosts = await listAll(POST_QUEUE_TABLE, qualityHoldParams);

  const draftedLeadsParams = `filterByFormula=${encodeURIComponent(
    `{Status}='Drafted'`
  )}&fields%5B%5D=Status&maxRecords=100`;
  const draftedLeads = await listAll(HOT_LEADS_TABLE, draftedLeadsParams);

  const pendingEmailsParams = `filterByFormula=${encodeURIComponent(
    `{Status}='Awaiting Approval'`
  )}&fields%5B%5D=Status&maxRecords=100`;
  const pendingEmails = await listAll(EMAIL_QUEUE_TABLE, pendingEmailsParams);

  const newLeadsParams = `filterByFormula=${encodeURIComponent(
    `{Status}='New'`
  )}&fields%5B%5D=Status&maxRecords=100`;
  const newLeads = await listAll(HOT_LEADS_TABLE, newLeadsParams);

  return {
    postsAwaitingApproval: pendingPosts.length,
    qualityHoldPosts: qualityHoldPosts.length,
    hotLeadsToReview: draftedLeads.length,
    emailsToApprove: pendingEmails.length,
    newLeadsAwaitingDraft: newLeads.length,
    total: pendingPosts.length + qualityHoldPosts.length + draftedLeads.length + pendingEmails.length,
  };
}

async function buildPendingPosts(businessName) {
  const safeName = escapeForFormula(businessName);
  const clientFilter = `FIND('${safeName}', ARRAYJOIN({Client}, ','))`;
  const params = `filterByFormula=${encodeURIComponent(
    `AND(OR({Status}='Awaiting Approval', {Status}='Generated', {Status}='Pending', {Status}='Queued'), ${clientFilter})`
  )}&sort%5B0%5D%5Bfield%5D=Scheduled Date&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=8`;
  const posts = await listAll(POST_QUEUE_TABLE, params);

  // Today at 00:00 in server local time. Anything scheduled before this
  // is "overdue" — should have published by now but hasn't. We surface
  // these in the UI so they can be re-queued or rejected.
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const mapped = posts.map(p => {
    const dateStr = p.fields["Scheduled Date"];
    let scheduledIso = "";
    let isOverdue = false;
    if (dateStr) {
      const d = new Date(dateStr);
      scheduledIso = d.toISOString();
      isOverdue = d.getTime() < todayMidnight.getTime();
    }
    return {
      id: p.id,
      title: p.fields["Post Title"] || "(no title)",
      targetChannel: p.fields["Target Channel"] || "Unknown",
      contentPillar: p.fields["Content Pillar"] || p.fields["Content Type"] || "",
      scheduledFor: formatScheduled(p.fields["Scheduled Date"], p.fields["Scheduled Time"]),
      scheduledIso: scheduledIso,
      isOverdue: isOverdue,
    };
  });

  // Sort: overdue first (most urgent), then by ascending date for the rest.
  mapped.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return (a.scheduledIso || "").localeCompare(b.scheduledIso || "");
  });

  return mapped;
}

async function buildHotLeads() {
  const params = `filterByFormula=${encodeURIComponent(
    `{Status}='Drafted'`
  )}&sort%5B0%5D%5Bfield%5D=Score&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=3`;
  const leads = await listAll(HOT_LEADS_TABLE, params);
  return leads.map(l => ({
    id: l.id,
    author: l.fields["Author Name"] || "Unknown",
    title: l.fields["Author Title"] || "",
    company: l.fields["Author Company"] || "",
    score: l.fields["Score"] || 0,
    type: l.fields["Lead Type"] || "",
    snippet: (l.fields["Post Content"] || "").slice(0, 220),
    postUrl: l.fields["Post URL"] || "",
    suggestedComment: l.fields["Suggested Comment"] || "",
    capturedAgo: timeAgo(l.fields["Captured"]),
  }));
}

async function buildPendingEmails() {
  const params = `filterByFormula=${encodeURIComponent(
    `{Status}='Awaiting Approval'`
  )}&sort%5B0%5D%5Bfield%5D=Scheduled Send&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=5`;
  const emails = await listAll(EMAIL_QUEUE_TABLE, params);
  return emails.map(e => ({
    id: e.id,
    subject: e.fields["Subject"] || "(no subject)",
    type: e.fields["Email Type"] || "",
    audience: e.fields["Audience Segment"] || "",
    scheduledFor: formatScheduled(e.fields["Scheduled Send"], null),
  }));
}

async function buildRecentActivity(businessName) {
  const safeName = escapeForFormula(businessName);
  const since = isoDaysAgo(7);
  const items = [];

  // Recent leads
  const leadsParams = `filterByFormula=${encodeURIComponent(
    `IS_AFTER({Captured}, '${since}')`
  )}&sort%5B0%5D%5Bfield%5D=Captured&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=10`;
  const recentLeads = await listAll(HOT_LEADS_TABLE, leadsParams);
  for (const lead of recentLeads) {
    items.push({
      type: "lead",
      time: lead.fields["Captured"],
      timeAgo: timeAgo(lead.fields["Captured"]),
      text: `New hot lead — <strong>${lead.fields["Author Name"] || "Unknown"}, score ${lead.fields["Score"] || 0}</strong>`,
    });
  }

  // Recent published posts (this client)
  const clientFilter = `FIND('${safeName}', ARRAYJOIN({Client}, ','))`;
  const postsParams = `filterByFormula=${encodeURIComponent(
    `AND({Status}='Published', IS_AFTER({Scheduled Date}, '${since}'), ${clientFilter})`
  )}&sort%5B0%5D%5Bfield%5D=Scheduled Date&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=10`;
  const recentPosts = await listAll(POST_QUEUE_TABLE, postsParams);
  for (const post of recentPosts) {
    const channel = post.fields["Target Channel"] || "social";
    items.push({
      type: "publish",
      time: post.fields["Scheduled Date"],
      timeAgo: timeAgo(post.fields["Scheduled Date"]),
      text: `Post published to ${channel} — <em>"${(post.fields["Post Title"] || "").slice(0, 60)}"</em>`,
    });
  }

  // Recent demos / calendly bookings
  const demosParams = `filterByFormula=${encodeURIComponent(
    `AND({Event Type}='Calendly Booking', IS_AFTER({Event Date}, '${since}'))`
  )}&sort%5B0%5D%5Bfield%5D=Event Date&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=5`;
  const recentDemos = await listAll(ATTRIBUTION_TABLE, demosParams);
  for (const demo of recentDemos) {
    items.push({
      type: "demo",
      time: demo.fields["Event Date"],
      timeAgo: timeAgo(demo.fields["Event Date"]),
      text: `Demo booked — <strong>${demo.fields["Identifier"] || "via web"}</strong>`,
    });
  }

  items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return items.slice(0, 10);
}

async function buildTopPost(businessName) {
  const safeName = escapeForFormula(businessName);
  const last30Start = isoDaysAgo(30);
  const clientFilter = `FIND('${safeName}', ARRAYJOIN({Client}, ','))`;
  const params = `filterByFormula=${encodeURIComponent(
    `AND({Status}='Published', IS_AFTER({Scheduled Date}, '${last30Start}'), ${clientFilter})`
  )}&sort%5B0%5D%5Bfield%5D=Reach&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`;
  const posts = await listAll(POST_QUEUE_TABLE, params);
  if (posts.length === 0) return null;
  const p = posts[0];
  return {
    title: p.fields["Post Title"] || "(no title)",
    targetChannel: p.fields["Target Channel"] || "Unknown",
    reach: p.fields["Reach"] || 0,
    engagement: (p.fields["Likes"] || 0) + (p.fields["Comments"] || 0) + (p.fields["Shares"] || 0),
    clicks: p.fields["Clicks"] || 0,
  };
}

// ── Main handler ──

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const clientId = (req.query && req.query.clientId)
      || (req.body && req.body.clientId);

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Dashboard not available for this client" });
    }

    // Use the Business Name (primary field) for all subsequent queries because
    // ARRAYJOIN of a multipleRecordLinks field returns primary field VALUES.
    const businessName = client["Business Name"] || "";

    const [kpis, actions, pendingPosts, hotLeads, pendingEmails, recentActivity, topPost] = await Promise.all([
      buildKpis(businessName),
      buildActions(businessName),
      buildPendingPosts(businessName),
      buildHotLeads(),
      buildPendingEmails(),
      buildRecentActivity(businessName),
      buildTopPost(businessName),
    ]);

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      client: {
        name: client["Trading Name"] || client["Business Name"] || "Travelgenix",
        package: client["Package"] || "",
      },
      kpis,
      actions,
      pendingPosts,
      hotLeads,
      pendingEmails,
      recentActivity,
      topPost,
    });
  } catch (e) {
    console.error("Dashboard data fetch failed:", e);
    return res.status(500).json({ error: e.message });
  }
};

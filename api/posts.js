const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const QUEUE_TABLE = "tblbhyiuULvedva0K";

// List queued posts, optionally filtered by client
async function listPosts(status, clientId) {
  let formula = "";
  if (status && clientId) {
    formula = `&filterByFormula=AND({Status}='${status}',RECORD_ID()!='')`;
  } else if (status) {
    formula = `&filterByFormula={Status}='${status}'`;
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}?sort%5B0%5D%5Bfield%5D=Scheduled%20Date&sort%5B0%5D%5Bdirection%5D=asc${formula}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!res.ok) throw new Error("Failed to fetch posts: " + res.statusText);
  const data = await res.json();
  return data.records || [];
}

// Update a post's status
async function updatePostStatus(recordId, newStatus, reason) {
  const fields = { Status: newStatus };
  if (reason) fields["Suppression Reason"] = reason;

  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}/${recordId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields, typecast: true }),
    }
  );
  if (!res.ok) throw new Error("Failed to update post: " + res.statusText);
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // GET: list posts
    if (req.method === "GET") {
      const status = req.query.status || "Queued";
      const clientId = req.query.clientId || null;
      const records = await listPosts(status, clientId);

      const posts = records.map(function (r) {
        var f = r.fields;
        var statusVal = f.Status;
        var statusName =
          typeof statusVal === "object" ? statusVal.name : statusVal || "";
        var contentType = f["Content Type"];
        var contentTypeName =
          typeof contentType === "object"
            ? contentType.name
            : contentType || "";
        var clientLinks = f.Client || [];

        return {
          id: r.id,
          title: f["Post Title"] || "",
          content_type: contentTypeName,
          destination: f.Destination || "",
          caption_facebook: f["Caption - Facebook"] || "",
          caption_instagram: f["Caption - Instagram"] || "",
          caption_linkedin: f["Caption - LinkedIn"] || "",
          caption_twitter: f["Caption - Twitter"] || "",
          caption_pinterest: f["Caption - Pinterest"] || "",
          caption_tiktok: f["Caption - TikTok"] || "",
          caption_gbp: f["Caption - GBP"] || "",
          blog_content: f["Blog Content"] || "",
          hashtags: f.Hashtags || "",
          cta_url: f["CTA URL"] || "",
          image_url: f["Image URL"] || "",
          image_position: f["Image Position"] || "50% 50%",
          video_url: f["Video URL"] || "",
          pinterest_image_url: f["Pinterest Image URL"] || "",
          scheduled_date: f["Scheduled Date"] || "",
          scheduled_time: f["Scheduled Time"] || "",
          status: statusName,
          suppression_reason: f["Suppression Reason"] || "",
          generated_week: f["Generated Week"] || "",
          event_source: f["Event Source"] || "",
          client_id: clientLinks[0] || "",
        };
      });

      return res.status(200).json({ success: true, posts, count: posts.length });
    }

    // PATCH: approve or reject a post
    if (req.method === "PATCH") {
      var body = req.body || {};
      var recordId = body.recordId;
      var action = body.action;
      var reason = body.reason || "";

      if (!recordId)
        return res.status(400).json({ error: "recordId is required" });
      if (!action || !["approve", "reject", "suppress"].includes(action))
        return res.status(400).json({
          error: "action must be approve, reject, or suppress",
        });

      var newStatus = "Queued";
      if (action === "approve") newStatus = "Queued";
      if (action === "reject") newStatus = "Replaced";
      if (action === "suppress") newStatus = "Suppressed";

      var updated = await updatePostStatus(recordId, newStatus, reason);

      return res.status(200).json({
        success: true,
        action: action,
        recordId: recordId,
        newStatus: newStatus,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Posts API error:", err);
    return res.status(500).json({ error: err.message });
  }
};

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const QUEUE_TABLE = "tblbhyiuULvedva0K";

async function listPosts(status) {
  var formula = status ? "&filterByFormula={Status}='" + status + "'" : "";
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + QUEUE_TABLE +
    "?sort%5B0%5D%5Bfield%5D=Scheduled%20Date&sort%5B0%5D%5Bdirection%5D=asc" + formula;
  var res = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!res.ok) throw new Error("Failed to fetch posts: " + res.statusText);
  var data = await res.json();
  return data.records || [];
}

async function updatePost(recordId, fields) {
  var res = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + QUEUE_TABLE + "/" + recordId,
    {
      method: "PATCH",
      headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: fields, typecast: true })
    }
  );
  if (!res.ok) throw new Error("Failed to update post: " + res.statusText);
  return res.json();
}

function getVal(f, key) {
  var v = f[key];
  if (typeof v === "object" && v !== null && v.name) return v.name;
  return v || "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      var status = req.query.status || "Queued";
      var records = await listPosts(status);
      var posts = records.map(function(r) {
        var f = r.fields;
        return {
          id: r.id,
          title: f["Post Title"] || "",
          content_type: getVal(f, "Content Type"),
          destination: f["Destination"] || "",
          caption_facebook: f["Caption - Facebook"] || "",
          caption_instagram: f["Caption - Instagram"] || "",
          caption_linkedin: f["Caption - LinkedIn"] || "",
          caption_twitter: f["Caption - Twitter"] || "",
          caption_pinterest: f["Caption - Pinterest"] || "",
          caption_tiktok: f["Caption - TikTok"] || "",
          caption_gbp: f["Caption - GBP"] || "",
          hashtags: f["Hashtags"] || "",
          cta_url: f["CTA URL"] || "",
          image_url: f["Image URL"] || "",
          image_position: f["Image Position"] || "50% 50%",
          pinterest_image_url: f["Pinterest Image URL"] || "",
          video_url: f["Video URL"] || "",
          scheduled_date: f["Scheduled Date"] || "",
          scheduled_time: f["Scheduled Time"] || "",
          status: getVal(f, "Status"),
          suppression_reason: f["Suppression Reason"] || "",
          generated_week: f["Generated Week"] || "",
          client_id: (f.Client || [])[0] || ""
        };
      });
      return res.status(200).json({ success: true, posts: posts, count: posts.length });
    }

    if (req.method === "PATCH") {
      var body = req.body || {};
      var recordId = body.recordId;
      if (!recordId) return res.status(400).json({ error: "recordId is required" });
      var action = body.action;

      if (action === "update_image") {
        var fields = {};
        if (body.imageUrl) fields["Image URL"] = body.imageUrl;
        if (body.imagePosition) fields["Image Position"] = body.imagePosition;
        if (body.pinterestImageUrl) fields["Pinterest Image URL"] = body.pinterestImageUrl;
        if (body.videoUrl) fields["Video URL"] = body.videoUrl;
        if (Object.keys(fields).length === 0) return res.status(400).json({ error: "No media fields provided" });
        await updatePost(recordId, fields);
        return res.status(200).json({ success: true, action: "update_image", recordId: recordId });
      }

      if (action === "update_position") {
        if (!body.imagePosition) return res.status(400).json({ error: "imagePosition required" });
        await updatePost(recordId, { "Image Position": body.imagePosition });
        return res.status(200).json({ success: true, action: "update_position", recordId: recordId, imagePosition: body.imagePosition });
      }

      if (!action || !["approve", "reject", "suppress"].includes(action))
        return res.status(400).json({ error: "action must be approve, reject, suppress, update_image, or update_position" });

      var newStatus = action === "approve" ? "Queued" : action === "reject" ? "Replaced" : "Suppressed";
      var statusFields = { Status: newStatus };
      if (body.reason) statusFields["Suppression Reason"] = body.reason;
      await updatePost(recordId, statusFields);
      return res.status(200).json({ success: true, action: action, recordId: recordId, newStatus: newStatus });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Posts API error:", err);
    return res.status(500).json({ error: err.message });
  }
};


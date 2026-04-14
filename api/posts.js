const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const QUEUE_TABLE = "tblbhyiuULvedva0K";

async function listPosts(status) {
  var formula = "";
  if (status) {
    formula = "&filterByFormula={Status}='" + status + "'";
  }
  var url =
    "https://api.airtable.com/v0/" +
    AIRTABLE_BASE +
    "/" +
    QUEUE_TABLE +
    "?sort%5B0%5D%5Bfield%5D=Scheduled%20Date&sort%5B0%5D%5Bdirection%5D=asc" +
    formula;
  var res = await fetch(url, {
    headers: { Authorization: "Bearer " + AIRTABLE_KEY },
  });
  if (!res.ok) throw new Error("Failed to fetch posts: " + res.statusText);
  var data = await res.json();
  return data.records || [];
}

async function updatePost(recordId, fields) {
  var res = await fetch(
    "https://api.airtable.com/v0/" +
      AIRTABLE_BASE +
      "/" +
      QUEUE_TABLE +
      "/" +
      recordId,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + AIRTABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: fields, typecast: true }),
    }
  );
  if (!res.ok) throw new Error("Failed to update post: " + res.statusText);
  return res.json();
}

// Helper to safely extract singleSelect name from Airtable (can be object or string)
function selectName(val) {
  if (!val) return "";
  if (typeof val === "object" && val.name) return val.name;
  if (typeof val === "string") return val;
  return "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // GET: list posts
    if (req.method === "GET") {
      var status = req.query.status || null;
      var records = await listPosts(status);

      var posts = records.map(function (r) {
        var f = r.fields;
        var statusName = selectName(f.Status);
        var contentTypeName = selectName(f["Content Type"]);
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
          // B2B fields
          target_channel: selectName(f["Target Channel"]),
          content_pillar: selectName(f["Content Pillar"]),
          first_comment: f["First Comment"] || "",
          client_id: clientLinks[0] || "",
        };
      });
      return res
        .status(200)
        .json({ success: true, posts: posts, count: posts.length });
    }

    // PATCH: update a post
    if (req.method === "PATCH") {
      var body = req.body || {};
      var recordId = body.recordId;
      if (!recordId)
        return res.status(400).json({ error: "recordId is required" });
      var action = body.action;

      // Update image URL
      if (action === "update_image") {
        var imgFields = {};
        if (body.imageUrl) imgFields["Image URL"] = body.imageUrl;
        if (body.imagePosition)
          imgFields["Image Position"] = body.imagePosition;
        if (Object.keys(imgFields).length === 0)
          return res
            .status(400)
            .json({ error: "imageUrl or imagePosition required" });
        await updatePost(recordId, imgFields);
        return res
          .status(200)
          .json({ success: true, action: "update_image", recordId: recordId });
      }

      // Update image position only
      if (action === "update_position") {
        if (!body.imagePosition)
          return res.status(400).json({ error: "imagePosition required" });
        await updatePost(recordId, {
          "Image Position": body.imagePosition,
        });
        return res.status(200).json({
          success: true,
          action: "update_position",
          recordId: recordId,
          imagePosition: body.imagePosition,
        });
      }

      // Update captions (per-platform editing)
      if (action === "update_caption") {
        var capFields = {};
        var capMap = {
          facebook: "Caption - Facebook",
          instagram: "Caption - Instagram",
          linkedin: "Caption - LinkedIn",
          twitter: "Caption - Twitter",
          pinterest: "Caption - Pinterest",
          tiktok: "Caption - TikTok",
          gbp: "Caption - GBP",
        };
        Object.keys(capMap).forEach(function (k) {
          if (body[k] !== undefined) capFields[capMap[k]] = body[k];
        });
        if (Object.keys(capFields).length === 0)
          return res
            .status(400)
            .json({ error: "No caption fields provided" });
        await updatePost(recordId, capFields);
        return res.status(200).json({
          success: true,
          action: "update_caption",
          recordId: recordId,
          updated: Object.keys(capFields),
        });
      }

      // Update first comment (B2B)
      if (action === "update_first_comment") {
        await updatePost(recordId, {
          "First Comment": body.first_comment || "",
        });
        return res.status(200).json({
          success: true,
          action: "update_first_comment",
          recordId: recordId,
        });
      }

      // Image URL shortcut (from image search panel)
      if (body.imageUrl && !action) {
        var updateFields = { "Image URL": body.imageUrl };
        if (body.imagePosition)
          updateFields["Image Position"] = body.imagePosition;
        await updatePost(recordId, updateFields);
        return res
          .status(200)
          .json({ success: true, action: "update_image", recordId: recordId });
      }

      // Image position shortcut (from click-to-reposition)
      if (body.imagePosition && !action) {
        await updatePost(recordId, {
          "Image Position": body.imagePosition,
        });
        return res.status(200).json({
          success: true,
          action: "update_position",
          recordId: recordId,
        });
      }

      // Scheduled time update (from calendar drag)
      if (body.scheduledTime) {
        var schedFields = { "Scheduled Time": body.scheduledTime };
        if (body.title) schedFields["Post Title"] = body.title;
        await updatePost(recordId, schedFields);
        return res.status(200).json({
          success: true,
          action: "reschedule",
          recordId: recordId,
        });
      }

      // Approve / Reject / Suppress
      if (
        !action ||
        !["approve", "reject", "suppress"].includes(action)
      )
        return res.status(400).json({
          error:
            "action must be approve, reject, suppress, update_image, update_position, update_caption, or update_first_comment",
        });

      var newStatus =
        action === "approve"
          ? "Approved"
          : action === "reject"
          ? "Replaced"
          : "Suppressed";
      var statusFields = { Status: newStatus };
      if (body.reason) statusFields["Suppression Reason"] = body.reason;
      if (body.rejectionReason)
        statusFields["Rejection Reason"] = body.rejectionReason;
      if (body.rejectionNotes)
        statusFields["Rejection Notes"] = body.rejectionNotes;
      await updatePost(recordId, statusFields);
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

// api/travelgenix-posts.js
// Returns Travelgenix B2B posts from the Post Queue for the dashboard
// GET /api/travelgenix-posts

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const QUEUE_TABLE = "tblbhyiuULvedva0K";
const TRAVELGENIX_CLIENT = "recFXQY7be6gMr4In";

module.exports = async (req, res) => {
  // Simple password check via query param or header
  const pw = req.query.pw || req.headers["x-admin-pw"];
  if (pw !== "travelgenix2026") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Fetch posts linked to Travelgenix client, sorted by scheduled date
    const fields = [
      "Post Title",
      "Caption - LinkedIn",
      "Caption - Facebook",
      "Caption - Instagram",
      "Caption - GBP",
      "Hashtags",
      "CTA URL",
      "Scheduled Date",
      "Scheduled Time",
      "Status",
      "Content Type",
      "Target Channel",
      "Content Pillar",
      "First Comment",
      "Image URL",
      "Generated Week",
      "Blog Content",
      "Reach",
      "Likes",
      "Comments",
      "Shares",
      "Clicks",
    ];

    const fieldsParam = fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const sort = `sort[0][field]=Scheduled Date&sort[0][direction]=desc`;

    // We need to filter by Client linked record
    const formula = `FIND("${TRAVELGENIX_CLIENT}",ARRAYJOIN({Client}))`;
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}?${fieldsParam}&${sort}&filterByFormula=${encodeURIComponent(formula)}&pageSize=50`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `Airtable error: ${err}` });
    }

    const data = await response.json();

    // Transform records for the frontend
    const posts = (data.records || []).map((r) => ({
      id: r.id,
      title: r.fields["Post Title"] || "",
      captionLinkedIn: r.fields["Caption - LinkedIn"] || "",
      captionFacebook: r.fields["Caption - Facebook"] || "",
      captionInstagram: r.fields["Caption - Instagram"] || "",
      captionGBP: r.fields["Caption - GBP"] || "",
      hashtags: r.fields["Hashtags"] || "",
      ctaUrl: r.fields["CTA URL"] || "",
      scheduledDate: r.fields["Scheduled Date"] || "",
      scheduledTime: r.fields["Scheduled Time"] || "",
      status: r.fields["Status"]?.name || r.fields["Status"] || "",
      contentType: r.fields["Content Type"]?.name || r.fields["Content Type"] || "",
      targetChannel: r.fields["Target Channel"]?.name || r.fields["Target Channel"] || "",
      contentPillar: r.fields["Content Pillar"]?.name || r.fields["Content Pillar"] || "",
      firstComment: r.fields["First Comment"] || "",
      imageUrl: r.fields["Image URL"] || "",
      generatedWeek: r.fields["Generated Week"] || "",
      blogContent: r.fields["Blog Content"] || "",
      reach: r.fields["Reach"] || 0,
      likes: r.fields["Likes"] || 0,
      comments: r.fields["Comments"] || 0,
      shares: r.fields["Shares"] || 0,
      clicks: r.fields["Clicks"] || 0,
      isBlog: (r.fields["Content Type"]?.name || r.fields["Content Type"] || "").includes("Blog"),
    }));

    // Group by week
    const weeks = {};
    posts.forEach((p) => {
      const week = p.generatedWeek || "Unscheduled";
      if (!weeks[week]) weeks[week] = [];
      weeks[week].push(p);
    });

    return res.status(200).json({
      total: posts.length,
      posts,
      weeks,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

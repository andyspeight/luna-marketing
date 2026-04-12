const PEXELS_KEY = process.env.PEXELS_KEY;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  var q = req.query.q || "travel";
  var orientation = req.query.orientation || "portrait";
  var perPage = parseInt(req.query.per_page) || 5;

  if (!PEXELS_KEY) return res.status(500).json({ error: "PEXELS_KEY not set" });

  try {
    var url =
      "https://api.pexels.com/videos/search?query=" +
      encodeURIComponent(q) +
      "&orientation=" + orientation +
      "&per_page=" + perPage +
      "&size=medium";

    var response = await fetch(url, {
      headers: { Authorization: PEXELS_KEY },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Pexels API error: " + response.statusText,
      });
    }

    var data = await response.json();
    var videos = (data.videos || []).map(function (v) {
      // Find the best quality file under 20MB for TikTok
      var files = v.video_files || [];
      var best = files
        .filter(function (f) { return f.quality === "hd" || f.quality === "sd"; })
        .sort(function (a, b) { return (b.width || 0) - (a.width || 0); })[0];
      if (!best) best = files[0];

      return {
        id: v.id,
        width: v.width,
        height: v.height,
        duration: v.duration,
        url: v.url,
        image: v.image,
        video_url: best ? best.link : null,
        video_quality: best ? best.quality : null,
        video_width: best ? best.width : null,
        video_height: best ? best.height : null,
        user: v.user ? v.user.name : "",
      };
    });

    return res.status(200).json({
      success: true,
      videos: videos,
      total: data.total_results || 0,
      query: q,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

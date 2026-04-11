const PEXELS_KEY = process.env.PEXELS_KEY;

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Accept GET with query params or POST with body
    const query =
      req.method === "GET" ? req.query.q : (req.body && req.body.query) || "";
    const orientation =
      req.method === "GET"
        ? req.query.orientation
        : (req.body && req.body.orientation) || "landscape";
    const perPage =
      req.method === "GET"
        ? parseInt(req.query.per_page || "5")
        : (req.body && req.body.per_page) || 5;

    if (!query) {
      return res.status(400).json({ error: "Query is required. Use ?q=beach+turkey or POST {query: 'beach turkey'}" });
    }

    if (!PEXELS_KEY) {
      return res.status(500).json({ error: "PEXELS_KEY not configured" });
    }

    // Search Pexels
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}&size=large`;

    const response = await fetch(url, {
      headers: { Authorization: PEXELS_KEY },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "Pexels API error",
        status: response.status,
        detail: text,
      });
    }

    const data = await response.json();

    // Return simplified image data
    const images = (data.photos || []).map((photo) => ({
      id: photo.id,
      width: photo.width,
      height: photo.height,
      description: photo.alt || "",
      photographer: photo.photographer,
      src: {
        original: photo.src.original,
        large: photo.src.large2x,
        medium: photo.src.large,
        small: photo.src.medium,
        thumbnail: photo.src.tiny,
      },
      url: photo.url,
    }));

    return res.status(200).json({
      query,
      orientation,
      total_results: data.total_results,
      images,
    });
  } catch (err) {
    console.error("Image search error:", err);
    return res.status(500).json({ error: err.message });
  }
};

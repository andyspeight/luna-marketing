// FCDO Travel Advisory Check
// Polls the GOV.UK FCDO feed and checks whether a destination has a travel warning
// Used by the scheduler before publishing any post

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const country = (req.query.country || "").trim();

  if (!country) {
    return res.status(400).json({
      error: "Country is required. Use ?country=Turkey",
    });
  }

  try {
    // Fetch the FCDO travel advice page for the country
    const slug = country
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    const url = `https://www.gov.uk/foreign-travel-advice/${slug}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      // If page not found, country may not have advisories or slug is wrong
      if (response.status === 404) {
        return res.status(200).json({
          country,
          slug,
          status: "not_found",
          safe_to_publish: true,
          message:
            "No FCDO page found for this country. May not have specific advisory.",
        });
      }
      throw new Error(`FCDO returned ${response.status}`);
    }

    const data = await response.json();

    // Extract the summary/alert status from the GOV.UK content
    const content = JSON.stringify(data).toLowerCase();

    // Check for the key warning phrases
    const againstAllTravel = content.includes("advise against all travel");
    const againstAllButEssential = content.includes(
      "advise against all but essential travel"
    );

    let advisoryLevel = "no_warning";
    let safeToPublish = true;
    let message = "No travel warnings. Safe to publish.";

    if (againstAllTravel) {
      advisoryLevel = "against_all_travel";
      safeToPublish = false;
      message =
        "FCDO advises against ALL travel to " +
        country +
        ". Post must be suppressed.";
    } else if (againstAllButEssential) {
      advisoryLevel = "against_all_but_essential";
      safeToPublish = false;
      message =
        "FCDO advises against all but essential travel to " +
        country +
        ". Post must be suppressed.";
    }

    // Extract the page title for more detail
    const title = data.title || "";

    return res.status(200).json({
      country,
      slug,
      advisory_level: advisoryLevel,
      safe_to_publish: safeToPublish,
      message,
      fcdo_page: url,
      page_title: title,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("FCDO check error:", err);
    // On error, default to SAFE (do not block publishing due to a fetch failure)
    // But flag the error so admin can investigate
    return res.status(200).json({
      country,
      advisory_level: "check_failed",
      safe_to_publish: true,
      message:
        "FCDO check failed: " +
        err.message +
        ". Defaulting to safe. Admin should investigate.",
      error: err.message,
      checked_at: new Date().toISOString(),
    });
  }
};

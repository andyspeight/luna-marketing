/* ══════════════════════════════════════════
   LUNA MARKETING — EVENTS CALENDAR API
   Fetches upcoming events from Airtable

   Only returns events where Status = "approved" OR Status is blank.
   Pending and rejected events are hidden from clients.
   ══════════════════════════════════════════ */
var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var BASE = "appSoIlSe0sNaJ4BZ";
var EVENTS = "tblQxIYrbzd6YlJYV";
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    var months = parseInt(req.query.months) || 6;
    var now = new Date();
    var future = new Date();
    future.setMonth(future.getMonth() + months);
    var startStr = now.toISOString().split("T")[0];
    var endStr = future.toISOString().split("T")[0];
    // Fetch events within the date range, sorted by start date.
    // Status filter: only return approved events (or blank for legacy events
    // that pre-date the Status field). Pending and rejected are hidden.
    var formula = "AND(" +
      "{Date Start}>='" + startStr + "'," +
      "{Date Start}<='" + endStr + "'," +
      "OR({Status}='approved',{Status}='',{Status}=BLANK())" +
    ")";
    var url = "https://api.airtable.com/v0/" + BASE + "/" + EVENTS +
      "?filterByFormula=" + encodeURIComponent(formula) +
      "&sort%5B0%5D%5Bfield%5D=Date+Start&sort%5B0%5D%5Bdirection%5D=asc";
    var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
    if (!r.ok) throw new Error("Airtable: " + r.status);
    var data = await r.json();
    var events = (data.records || []).map(function(rec) {
      var f = rec.fields;
      return {
        id: rec.id,
        name: f["Event Name"] || "",
        dateStart: f["Date Start"] || "",
        dateEnd: f["Date End"] || "",
        category: f["Category"] || "",
        countries: f["Countries"] || "",
        destinations: f["Destinations"] || "",
        travelAngle: f["Travel Angle"] || "",
        audience: f["Audience"] || [],
        recurring: f["Recurring"] || "",
        impact: f["Impact"] || "",
        contentSuggestion: f["Content Suggestion"] || "",
        leadTimeWeeks: f["Lead Time Weeks"] || 4
      };
    });
    return res.status(200).json({ success: true, count: events.length, events: events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

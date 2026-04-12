const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const CRON_SECRET = process.env.CRON_SECRET;

async function getActiveClients() {
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE + "?filterByFormula={Status}='Active'";
  var res = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!res.ok) throw new Error("Failed to fetch clients: " + res.statusText);
  var data = await res.json();
  return data.records || [];
}

function getWeekString() {
  var now = new Date();
  var start = new Date(now.getFullYear(), 0, 1);
  var week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return now.getFullYear() + "-W" + String(week).padStart(2, "0");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Security: verify cron secret
  var authHeader = req.headers.authorization;
  if (CRON_SECRET && authHeader !== "Bearer " + CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Sunday guard — no generation on Sundays
  var today = new Date();
  if (today.getDay() === 0) {
    return res.status(200).json({ success: true, skipped: true, reason: "Sunday — no generation", week: getWeekString() });
  }

  var results = { week: getWeekString(), started: new Date().toISOString(), clients: [], errors: [], totalPosts: 0 };

  try {
    // 1. Get all active clients
    var clients = await getActiveClients();
    console.log("Cron: found " + clients.length + " active clients");

    // 2. Determine base URL for internal API calls
    var host = req.headers.host || "luna-marketing.vercel.app";
    var protocol = host.includes("localhost") ? "http" : "https";
    var baseUrl = protocol + "://" + host;

    // 3. Generate for each client by calling /api/generate
    for (var i = 0; i < clients.length; i++) {
      var record = clients[i];
      var name = record.fields["Trading Name"] || record.fields["Business Name"] || "Unknown";
      try {
        console.log("Cron: generating for " + name + " (" + (i + 1) + "/" + clients.length + ")");

        var genRes = await fetch(baseUrl + "/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: record.id }),
          signal: AbortSignal.timeout(120000), // 2 min timeout per client
        });

        var genData = await genRes.json();

        if (genRes.ok && genData.success) {
          var postCount = genData.posts ? genData.posts.length : 0;
          results.clients.push({ name: name, id: record.id, postsGenerated: postCount, status: "success" });
          results.totalPosts += postCount;
        } else {
          throw new Error(genData.error || "Generation failed");
        }
      } catch (err) {
        console.error("Cron error for " + name + ": " + err.message);
        results.errors.push({ name: name, id: record.id, error: err.message });
        results.clients.push({ name: name, id: record.id, postsGenerated: 0, status: "error", error: err.message });
      }

      // Delay between clients to avoid rate limits
      if (i < clients.length - 1) await new Promise(function(r) { setTimeout(r, 3000); });
    }

    results.completed = new Date().toISOString();
    results.success = true;
    return res.status(200).json(results);
  } catch (err) {
    console.error("Batch generation error:", err);
    return res.status(500).json({ error: err.message, results: results });
  }
};

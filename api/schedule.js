/* ══════════════════════════════════════════
   LUNA MARKETING — SMART SCHEDULE API
   Returns optimal posting times per platform
   ══════════════════════════════════════════ */

var schedule = require("./smart-schedule.js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    var platforms = (req.query.platforms || "facebook,instagram,linkedin").split(",").map(function(p) { return p.trim().toLowerCase(); });
    var postingDays = req.query.days || "Mon,Wed,Fri";
    var postsPerWeek = parseInt(req.query.posts) || 3;

    var weekSchedule = schedule.getSmartSchedule(postsPerWeek, postingDays, platforms);
    var summary = schedule.getScheduleSummary(platforms);

    // Build per-platform best times for display
    var platformTimes = {};
    platforms.forEach(function(plat) {
      var data = schedule.PLATFORM_SCHEDULE[plat];
      if (!data) return;
      platformTimes[plat] = data.bestTimes.slice(0, 5).map(function(t) {
        return { day: schedule.DAYS[t.day], time: t.time, score: t.score };
      });
    });

    return res.status(200).json({
      success: true,
      weekSchedule: weekSchedule,
      summary: summary,
      platformTimes: platformTimes,
      methodology: "Based on 2026 UK engagement data from Sprout Social (230M+ engagements), Buffer (52M+ posts), and SocialPilot (7M+ posts). Optimised for UK travel audiences."
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

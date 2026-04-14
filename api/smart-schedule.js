/* ══════════════════════════════════════════
   LUNA MARKETING — SMART SCHEDULE ENGINE
   Optimal posting times for UK travel audiences
   Based on 2026 data from Sprout Social, Buffer, SocialPilot
   ══════════════════════════════════════════ */

// All times in GMT/BST (UK local)
// Format: [hour, minute] — 24hr clock
// Ranked by engagement potential (index 0 = best)

var PLATFORM_SCHEDULE = {
  facebook: {
    // UK Facebook: mornings + early evening, Thu/Wed strongest
    bestTimes: [
      { day: 4, time: "09:00", score: 10 }, // Thursday 9am — peak
      { day: 3, time: "09:00", score: 9 },  // Wednesday 9am
      { day: 1, time: "10:00", score: 8 },  // Tuesday 10am
      { day: 4, time: "17:00", score: 8 },  // Thursday 5pm
      { day: 3, time: "12:00", score: 7 },  // Wednesday noon
      { day: 0, time: "17:00", score: 7 },  // Monday 5pm
      { day: 2, time: "09:00", score: 7 },  // Wednesday 9am
      { day: 4, time: "12:00", score: 6 },  // Thursday noon
      { day: 0, time: "09:00", score: 6 },  // Monday 9am
      { day: 5, time: "10:00", score: 4 },  // Saturday 10am (weakest)
    ]
  },
  instagram: {
    // UK Instagram: lunch + evenings, Tue/Fri afternoons strong, 9pm standout
    bestTimes: [
      { day: 1, time: "21:00", score: 10 }, // Tuesday 9pm — peak
      { day: 4, time: "21:00", score: 9 },  // Friday 9pm
      { day: 3, time: "12:00", score: 9 },  // Thursday noon
      { day: 1, time: "15:00", score: 8 },  // Tuesday 3pm
      { day: 4, time: "15:00", score: 8 },  // Friday 3pm
      { day: 2, time: "20:00", score: 8 },  // Wednesday 8pm
      { day: 0, time: "18:00", score: 7 },  // Monday 6pm
      { day: 3, time: "21:00", score: 7 },  // Thursday 9pm
      { day: 6, time: "10:00", score: 5 },  // Sunday 10am
      { day: 5, time: "11:00", score: 4 },  // Saturday 11am
    ]
  },
  linkedin: {
    // UK LinkedIn: professional hours, midweek mornings, lunch breaks
    bestTimes: [
      { day: 1, time: "10:00", score: 10 }, // Tuesday 10am — peak
      { day: 2, time: "10:00", score: 9 },  // Wednesday 10am
      { day: 3, time: "09:00", score: 9 },  // Thursday 9am
      { day: 1, time: "12:00", score: 8 },  // Tuesday noon
      { day: 2, time: "12:00", score: 8 },  // Wednesday noon
      { day: 0, time: "08:00", score: 7 },  // Monday 8am
      { day: 3, time: "14:00", score: 7 },  // Thursday 2pm
      { day: 4, time: "10:00", score: 6 },  // Friday 10am
      { day: 4, time: "15:00", score: 5 },  // Friday 3pm
    ]
  },
  twitter: {
    // UK X/Twitter: early morning + late afternoon, fast-paced
    bestTimes: [
      { day: 2, time: "08:00", score: 10 }, // Wednesday 8am — peak
      { day: 1, time: "09:00", score: 9 },  // Tuesday 9am
      { day: 3, time: "17:00", score: 9 },  // Thursday 5pm
      { day: 0, time: "08:00", score: 8 },  // Monday 8am
      { day: 4, time: "12:00", score: 7 },  // Friday noon
      { day: 2, time: "17:00", score: 7 },  // Wednesday 5pm
      { day: 1, time: "17:00", score: 6 },  // Tuesday 5pm
    ]
  },
  tiktok: {
    // UK TikTok: evenings + late night, casual scrolling
    bestTimes: [
      { day: 1, time: "21:00", score: 10 }, // Tuesday 9pm — peak
      { day: 3, time: "19:00", score: 9 },  // Thursday 7pm
      { day: 2, time: "22:00", score: 9 },  // Wednesday 10pm
      { day: 0, time: "22:00", score: 8 },  // Monday 10pm
      { day: 4, time: "20:00", score: 8 },  // Friday 8pm
      { day: 1, time: "10:00", score: 7 },  // Tuesday 10am
      { day: 6, time: "19:00", score: 6 },  // Sunday 7pm
      { day: 5, time: "12:00", score: 5 },  // Saturday noon
    ]
  },
  pinterest: {
    // UK Pinterest: evenings + weekends, discovery/planning mode
    bestTimes: [
      { day: 6, time: "20:00", score: 10 }, // Sunday 8pm — peak
      { day: 5, time: "21:00", score: 9 },  // Saturday 9pm
      { day: 4, time: "20:00", score: 8 },  // Friday 8pm
      { day: 2, time: "21:00", score: 8 },  // Wednesday 9pm
      { day: 3, time: "15:00", score: 7 },  // Thursday 3pm
      { day: 0, time: "20:00", score: 6 },  // Monday 8pm
    ]
  },
  google: {
    // UK Google Business: business hours, local search peaks
    bestTimes: [
      { day: 1, time: "10:00", score: 10 }, // Tuesday 10am — peak
      { day: 3, time: "11:00", score: 9 },  // Thursday 11am
      { day: 0, time: "09:00", score: 8 },  // Monday 9am
      { day: 2, time: "14:00", score: 7 },  // Wednesday 2pm
      { day: 4, time: "10:00", score: 6 },  // Friday 10am
    ]
  }
};

// Day name mapping
var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Get the best posting time for a given platform and day index
 * @param {string} platform - Platform key (facebook, instagram, etc.)
 * @param {number} dayIndex - 0=Monday, 6=Sunday
 * @returns {string} Time in HH:MM format
 */
function getBestTimeForDay(platform, dayIndex) {
  var schedule = PLATFORM_SCHEDULE[platform];
  if (!schedule) return "09:00";
  var match = schedule.bestTimes.find(function(t) { return t.day === dayIndex; });
  return match ? match.time : "09:00";
}

/**
 * Get smart schedule for a set of posts across a week
 * Distributes posts across optimal time slots, avoiding clustering
 * @param {number} postsPerWeek - Number of posts to schedule
 * @param {string} postingDays - Comma-separated day names (e.g. "Mon,Wed,Fri")
 * @param {string[]} platforms - Array of connected platform keys
 * @returns {Array} Array of {day, dayIndex, time, platform} objects
 */
function getSmartSchedule(postsPerWeek, postingDays, platforms) {
  // Parse posting days
  var dayMap = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  var days = (postingDays || "Mon,Wed,Fri").split(",").map(function(d) {
    return dayMap[d.trim().toLowerCase().substring(0, 3)];
  }).filter(function(d) { return d !== undefined; });

  if (!days.length) days = [0, 2, 4]; // Default Mon, Wed, Fri

  // For each post, find the best time considering the primary platform
  // Primary platform priority: Facebook > Instagram > LinkedIn
  var primaryPlatform = "facebook";
  if (platforms && platforms.length) {
    var priority = ["facebook", "instagram", "linkedin", "twitter", "tiktok"];
    for (var i = 0; i < priority.length; i++) {
      if (platforms.indexOf(priority[i]) !== -1) { primaryPlatform = priority[i]; break; }
    }
  }

  var schedule = [];
  for (var p = 0; p < postsPerWeek && p < days.length; p++) {
    var dayIndex = days[p % days.length];
    var time = getBestTimeForDay(primaryPlatform, dayIndex);
    schedule.push({
      day: DAYS[dayIndex],
      dayIndex: dayIndex,
      time: time,
      primaryPlatform: primaryPlatform
    });
  }

  return schedule;
}

/**
 * Get a summary of optimal times for a client
 * Used for displaying in the client portal
 * @param {string[]} platforms - Connected platforms
 * @returns {Object} Platform-keyed schedule summary
 */
function getScheduleSummary(platforms) {
  var summary = {};
  (platforms || ["facebook", "instagram", "linkedin"]).forEach(function(plat) {
    var schedule = PLATFORM_SCHEDULE[plat];
    if (!schedule) return;
    var top3 = schedule.bestTimes.slice(0, 3).map(function(t) {
      return DAYS[t.day] + " " + t.time;
    });
    summary[plat] = { topTimes: top3, bestDay: DAYS[schedule.bestTimes[0].day], bestTime: schedule.bestTimes[0].time };
  });
  return summary;
}

module.exports = { PLATFORM_SCHEDULE, getBestTimeForDay, getSmartSchedule, getScheduleSummary, DAYS };

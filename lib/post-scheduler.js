// lib/post-scheduler.js
//
// Single source of truth for assigning a post a Scheduled Date (and a sensible
// time) based on the client's Posting Days. Every creation path (on-demand
// generate, Promote, etc) and the publish write-back use this, so the calendar
// always reflects when posts actually go out.
//
// Author: Travelgenix
// Date:   16 June 2026

const DAY_MAP = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
};
const DEFAULT_TIMES = ["09:00", "12:00", "15:00", "18:00"];

// Parse the client's "Posting Days" (e.g. "Mon,Wed,Fri") into JS weekday
// numbers (0=Sun..6=Sat). Falls back to Mon/Wed/Fri if none set.
function parsePostingDays(client) {
  const raw = ((client && client["Posting Days"]) || "").toString();
  let days = raw.split(/[,\s/]+/)
    .map(s => DAY_MAP[s.trim().toLowerCase().slice(0, 3)])
    .filter(d => d !== undefined);
  days = Array.from(new Set(days)).sort((a, b) => a - b);
  return days.length ? days : [1, 3, 5];
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Return `count` upcoming dates that fall on the client's posting days,
 * starting from tomorrow and rolling into following weeks as needed.
 * @returns {string[]} array of YYYY-MM-DD
 */
function nextPostingDates(client, count, fromDate) {
  const days = parsePostingDays(client);
  const out = [];
  const d = fromDate ? new Date(fromDate) : new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1); // start tomorrow
  let guard = 0;
  while (out.length < count && guard < 730) {
    if (days.includes(d.getDay())) out.push(ymd(d));
    d.setDate(d.getDate() + 1);
    guard++;
  }
  return out;
}

function defaultTime(i) {
  return DEFAULT_TIMES[i % DEFAULT_TIMES.length];
}

function validTime(t, fallback) {
  return (typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t.trim())) ? t.trim() : fallback;
}

module.exports = { parsePostingDays, nextPostingDates, defaultTime, validTime, ymd };

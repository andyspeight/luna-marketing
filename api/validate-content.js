// api/validate-content.js
// Automated content validator. Run on every generated post BEFORE saving to Airtable.
//
// Returns { passed: boolean, issues: string[], severity: 'pass'|'warn'|'fail' }
//
// If severity === 'fail', the post MUST be saved with Status='Quality Hold' and the
// issues written to Quality Issues field. Andy reviews manually.
//
// Updated: 1 May 2026 — Day 6.5 quality fix.

// ─────────────────────────────────────────────────
// RULE LISTS — keep in sync with brand-guardrails.js
// ─────────────────────────────────────────────────

const BANNED_WORDS = [
  // From travelgenix-blog/linkedin/humanizer skills
  "leverage", "holistic", "robust", "seamless", "game-changer", "game changer",
  "paradigm", "delve", "delves", "delving", "tapestry", "unlock", "unlocks", "unlocking",
  "cutting-edge", "cutting edge", "groundbreaking", "nestled", "vibrant", "profound",
  "pivotal", "testament", "underscores", "underscore", "fostering", "foster",
  "garner", "garners", "garnering", "showcase", "showcases", "showcasing",
  "interplay", "intricate", "intricacies", "enduring",
  // Banned phrases (lowercased, will substring-match)
];

const BANNED_PHRASES = [
  "in conclusion",
  "to summarise",
  "to summarize",
  "as we've seen",
  "as we have seen",
  "at the end of the day",
  "moving the needle",
  "circle back",
  "deep dive",
  "in today's",
  "in today\u2019s",
  "in an era of",
  "now more than ever",
  "in the ever-evolving",
  "it's important to note",
  "let me explain why",
  "here's the thing",
  "and that got me thinking",
  "let that sink in",
  "read that again",
  "hot take",
  "unpopular opinion",
  "this is the way",
  "i'll say it louder for the people in the back",
  "picture this",
  "imagine if",
  "what if i told you",
  "great question",
  "you're absolutely right",
  "i hope this helps",
];

const COMPETITOR_NAMES = [
  "tprofile", "t-profile", "t profile",
  "inspiretec",
  "dolphin dynamics", "dolphindynamics",
  "traveltek",
  "top dog",
  "moonstride",
  "tr10",
  "travelsoft",
  "juniper", // careful: 'juniper' could appear in destination context. We'll
             // require word boundary. The check below uses regex with \b.
  "constellation",
  "atcore",
];

const FABRICATED_NAME_PATTERNS = [
  // "Sarah from Coastal Travel" / "Joe at Atlas Tours" / etc.
  // Matches: <Capitalised first name> + (from|at) + <Capitalised company name>
  /\b[A-Z][a-z]+\s+(from|at)\s+[A-Z][A-Za-z0-9& ]{2,40}\b(?:\s+(Travel|Tours|Holidays|Agency|Co\.?))?/g,
  // "<Person> said" / "<Person> told us" with a capitalised first name + surname
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+said|\s+told\s+us|\s+says)/g,
];

const FABRICATED_STAT_PATTERNS = [
  // "saved 40 hours a month" / "saved 12 hours per week" — invented time savings
  /\bsaved\s+\d+\s*(\+|plus)?\s+(hours?|days?|minutes?)\s*(a|per)\s+(week|month|day|year)/gi,
  // "increased X by Y%" without citation
  /\b(increased|improved|boosted|grew|reduced|cut|saved|lifted)\s+(?:[a-z]+\s+){0,3}by\s+\d+%/gi,
  // "X% increase in" / "X% improvement"
  /\b\d+%\s+(increase|improvement|uplift|boost|reduction|saving)/gi,
];

// Throat-clearing openers (check if post STARTS with these)
const BANNED_OPENER_PATTERNS = [
  /^in today'?s/i,
  /^in an era of/i,
  /^now more than ever/i,
  /^in the ever[\s-]evolving/i,
  /^picture this/i,
  /^imagine if/i,
  /^what if i told you/i,
  /^\?/,         // starts with a question mark? (shouldn't happen but defensive)
];

// ─────────────────────────────────────────────────
// CHECKS
// ─────────────────────────────────────────────────

function checkEmDashes(text) {
  // Matches em dash (—) and en dash (–) used in place of em dashes
  const matches = text.match(/[\u2014\u2013]/g);
  return matches ? { count: matches.length, examples: ["—"] } : null;
}

function checkOxfordCommas(text) {
  // Pattern: ", and " preceded by another comma in the same clause.
  // We look for "X, Y, and Z" — comma+space+word+comma+space+and
  // This is approximate. False positives possible on lists with subordinate clauses.
  const matches = text.match(/,\s+\w[\w\s'"-]{0,40},\s+and\s+/g);
  return matches ? { count: matches.length, examples: matches.slice(0, 3) } : null;
}

function checkCurlyQuotes(text) {
  const matches = text.match(/[\u2018\u2019\u201C\u201D]/g);
  return matches ? { count: matches.length } : null;
}

function checkBannedWords(text) {
  const lower = " " + text.toLowerCase() + " ";
  const found = [];
  for (const word of BANNED_WORDS) {
    // Word boundary match
    const regex = new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (regex.test(lower)) found.push(word);
  }
  return found.length ? { words: found } : null;
}

function checkBannedPhrases(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) found.push(phrase);
  }
  return found.length ? { phrases: found } : null;
}

function checkCompetitors(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const name of COMPETITOR_NAMES) {
    // Word boundary match to avoid e.g. 'Juniper Park' false positives
    const regex = new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (regex.test(lower)) found.push(name);
  }
  return found.length ? { competitors: found } : null;
}

function checkFabricatedNames(text) {
  const found = [];
  for (const pattern of FABRICATED_NAME_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        // Filter out obviously legitimate phrases
        const lower = m.toLowerCase();
        if (lower.includes("andy speight") || lower.includes("darren swan")) continue;
        // "Booking from London" — geographical, not a fabricated client. Allow common cities.
        if (/^[A-Z][a-z]+\s+from\s+(London|Paris|Dubai|Manchester|Birmingham|Edinburgh|Bristol|Leeds|Liverpool|Glasgow|UK|US|USA)\b/.test(m)) continue;
        found.push(m);
      }
    }
  }
  return found.length ? { matches: found.slice(0, 5) } : null;
}

function checkFabricatedStats(text) {
  const found = [];
  for (const pattern of FABRICATED_STAT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        // Allow if the stat appears alongside a clear citation marker
        const lower = m.toLowerCase();
        // Check if the surrounding 100 chars contain a citation
        const idx = text.toLowerCase().indexOf(lower);
        const context = text.slice(Math.max(0, idx - 100), idx + m.length + 100).toLowerCase();
        if (context.match(/(according to|abta|phocuswright|skift|travolution|ttg|travel weekly|google|reuters|study by|research by|report by)/)) continue;
        found.push(m);
      }
    }
  }
  return found.length ? { matches: found.slice(0, 5) } : null;
}

function checkBannedOpener(text) {
  const trimmed = text.trim();
  for (const pattern of BANNED_OPENER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { opener: trimmed.slice(0, 60) + "..." };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────
// MAIN VALIDATOR
// ─────────────────────────────────────────────────

/**
 * Validate one piece of content (caption, blog body, email body, comment).
 *
 * @param {string} text - the content to check
 * @param {object} opts - { allowBenchmarkStats?: bool, fieldName?: string }
 * @returns {object} { passed, issues, severity, summary }
 */
function validateContent(text, opts = {}) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return { passed: true, issues: [], severity: "pass", summary: "(empty)" };
  }

  const issues = [];

  // SEVERITY: FAIL — these always block publishing
  const competitors = checkCompetitors(text);
  if (competitors) issues.push({ severity: "fail", code: "COMPETITOR_NAMED", detail: `Named competitors: ${competitors.competitors.join(", ")}` });

  const fabNames = checkFabricatedNames(text);
  if (fabNames) issues.push({ severity: "fail", code: "FABRICATED_CLIENT", detail: `Possible invented client/person reference: ${fabNames.matches.join(" / ")}` });

  if (!opts.allowBenchmarkStats) {
    const fabStats = checkFabricatedStats(text);
    if (fabStats) issues.push({ severity: "fail", code: "FABRICATED_STAT", detail: `Possible invented statistic: ${fabStats.matches.join(" / ")}` });
  }

  // SEVERITY: FAIL — formatting issues that should block
  const emDashes = checkEmDashes(text);
  if (emDashes) issues.push({ severity: "fail", code: "EM_DASH", detail: `Em dashes found (${emDashes.count})` });

  // SEVERITY: WARN — fixable but not necessarily a publishing blocker
  const oxford = checkOxfordCommas(text);
  if (oxford) issues.push({ severity: "warn", code: "OXFORD_COMMA", detail: `Possible Oxford comma usage (${oxford.count}): ${oxford.examples.join(", ")}` });

  const curly = checkCurlyQuotes(text);
  if (curly) issues.push({ severity: "warn", code: "CURLY_QUOTES", detail: `Curly quotes found (${curly.count}) — should be straight` });

  const banned = checkBannedWords(text);
  if (banned) issues.push({ severity: "warn", code: "BANNED_WORD", detail: `Banned words: ${banned.words.join(", ")}` });

  const phrases = checkBannedPhrases(text);
  if (phrases) issues.push({ severity: "warn", code: "BANNED_PHRASE", detail: `Banned phrases: ${phrases.phrases.join(" | ")}` });

  const opener = checkBannedOpener(text);
  if (opener) issues.push({ severity: "warn", code: "BANNED_OPENER", detail: `Throat-clearing opener: "${opener.opener}"` });

  // Determine overall severity
  const hasFail = issues.some(i => i.severity === "fail");
  const hasWarn = issues.some(i => i.severity === "warn");
  const severity = hasFail ? "fail" : hasWarn ? "warn" : "pass";

  return {
    passed: severity !== "fail",
    severity,
    issues,
    summary: severity === "pass"
      ? "Content passed all checks"
      : `${issues.filter(i => i.severity === "fail").length} fail, ${issues.filter(i => i.severity === "warn").length} warn`,
  };
}

/**
 * Validate a full post (multiple captions + blog content).
 * Returns one combined result.
 *
 * @param {object} fields - the Post Queue fields object
 * @returns {object} { passed, severity, issues, formattedReport }
 */
function validatePost(fields) {
  const checks = [
    { name: "LinkedIn caption", text: fields["Caption - LinkedIn"] },
    { name: "Facebook caption", text: fields["Caption - Facebook"] },
    { name: "Instagram caption", text: fields["Caption - Instagram"] },
    { name: "Twitter caption", text: fields["Caption - Twitter"] },
    { name: "TikTok caption", text: fields["Caption - TikTok"] },
    { name: "Pinterest caption", text: fields["Caption - Pinterest"] },
    { name: "GBP caption", text: fields["Caption - GBP"] },
    { name: "Blog content", text: fields["Blog Content"] },
    { name: "First comment", text: fields["First Comment"] },
  ];

  const allIssues = [];
  let highestSeverity = "pass";

  for (const check of checks) {
    if (!check.text) continue;
    const result = validateContent(check.text);
    for (const issue of result.issues) {
      allIssues.push({
        ...issue,
        field: check.name,
      });
    }
    if (result.severity === "fail") highestSeverity = "fail";
    else if (result.severity === "warn" && highestSeverity !== "fail") highestSeverity = "warn";
  }

  // Build formatted report for Quality Issues field
  const failIssues = allIssues.filter(i => i.severity === "fail");
  const warnIssues = allIssues.filter(i => i.severity === "warn");
  let report = "";
  if (failIssues.length) {
    report += "FAIL (blocks publishing):\n";
    failIssues.forEach(i => report += `  • [${i.field}] ${i.code}: ${i.detail}\n`);
  }
  if (warnIssues.length) {
    if (report) report += "\n";
    report += "WARN (review recommended):\n";
    warnIssues.forEach(i => report += `  • [${i.field}] ${i.code}: ${i.detail}\n`);
  }
  if (!report) report = "All checks passed.";

  return {
    passed: highestSeverity !== "fail",
    severity: highestSeverity,
    issues: allIssues,
    formattedReport: report.trim(),
  };
}

module.exports = { validateContent, validatePost, BANNED_WORDS, BANNED_PHRASES, COMPETITOR_NAMES };

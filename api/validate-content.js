// api/validate-content.js
// Automated content validator. Run on every generated post BEFORE saving to Airtable.
//
// Returns { passed: boolean, issues: string[], severity: 'pass'|'warn'|'fail' }
//
// If severity === 'fail', the post MUST be saved with Status='Quality Hold' and the
// issues written to Quality Issues field. Andy reviews manually.
//
// v2 — 2 May 2026 — Day 6.5 stress-test fix.
// Closes 10 gaps found during adversarial testing:
//   - First-name + verb fake testimonials ("Sarah told us...")
//   - Anonymous-but-specific case studies ("A homeworker in Manchester doubled bookings")
//   - "We saved them N hours" pattern (different verb order)
//   - Award fabrication ("Won Best Travel Tech 2026")
//   - Partnership fabrication ("Our partnership with American Express")
//   - "As Andy Speight always says..." fabricated quotes
//   - "X% of our clients" / "most clients" patterns
//   - Banned openers escalated from warn to fail
//   - Vague client outcome claims ("doubled their bookings")
//   - Expanded competitor list

// ─────────────────────────────────────────────────
// RULE LISTS
// ─────────────────────────────────────────────────

const BANNED_WORDS = [
  "leverage", "holistic", "robust", "seamless", "game-changer", "game changer",
  "paradigm", "delve", "delves", "delving", "tapestry", "unlock", "unlocks", "unlocking",
  "cutting-edge", "cutting edge", "groundbreaking", "nestled", "vibrant", "profound",
  "pivotal", "testament", "underscores", "underscore", "fostering", "foster",
  "garner", "garners", "garnering", "showcase", "showcases", "showcasing",
  "interplay", "intricate", "intricacies", "enduring", "utilize", "synergy", "innovative",
  // Added 22 May 2026 after "ecosystem" and "landscape" leaked through both
  // passes. "landscape" and "ecosystem" are context-sensitive — they are only
  // banned as METAPHORS, not in their literal senses. checkBannedWords handles
  // that nuance below so we do not false-flag literal usage.
  "ecosystem", "landscape",
];

// Words from BANNED_WORDS that are only banned as a METAPHOR. Their literal
// senses are fine ("the Lake District landscape", "the marine ecosystem"), so
// we only flag them when used figuratively in a business/tech context. The
// heuristic: flag if the word is preceded by a business/abstract qualifier
// (digital, travel, tech, business, competitive, market, industry, distribution,
// software, data, vendor, supplier, pricing, etc.) — that is the metaphor usage.
const METAPHOR_ONLY_WORDS = {
  "landscape": /\b(digital|travel|tech|technology|business|competitive|market|industry|distribution|software|data|vendor|supplier|pricing|economic|financial|media|content|regulatory|consumer|retail|commercial|booking|trade|sector)\s+landscape\b/i,
  "ecosystem": /\b(digital|travel|tech|technology|business|software|data|vendor|supplier|partner|product|platform|booking|payment|app|content)\s+ecosystem\b/i,
};

const BANNED_PHRASES = [
  "in conclusion", "to summarise", "to summarize", "as we've seen", "as we have seen",
  "at the end of the day", "moving the needle", "circle back", "deep dive",
  "in today's", "in today\u2019s", "in an era of", "now more than ever",
  "in the ever-evolving", "in the ever evolving",
  "it's important to note", "let me explain why", "here's the thing",
  "and that got me thinking", "let that sink in", "read that again",
  "hot take", "unpopular opinion", "this is the way",
  "i'll say it louder for the people in the back",
  "picture this", "imagine if", "what if i told you",
  "great question", "you're absolutely right", "i hope this helps",
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
  "juniper",
  "constellation",
  "atcore",
  "open destinations",
  "reservation group",
  "comtec",
];

// Common UK first names that AI loves to invent fake testimonials with
const COMMON_FIRST_NAMES = [
  "sarah", "jane", "rachel", "emma", "kate", "katie", "claire", "lucy", "rebecca", "hannah",
  "michelle", "lauren", "amy", "becky", "helen", "sophie", "charlotte", "victoria", "anna",
  "louise", "fiona", "karen", "linda", "tracy", "tracey", "samantha", "sam",
  "joe", "john", "james", "david", "mark", "paul", "tom", "tony", "chris", "matt", "matthew",
  "steve", "stephen", "andrew", "richard", "rick", "mike", "michael", "rob", "robert",
  "dave", "phil", "philip", "simon", "ian", "alan", "neil", "gary", "kevin", "peter", "pete",
];

const FABRICATED_NAME_PATTERNS = [
  // "Sarah from Coastal Travel" / "Joe at Atlas Tours"
  /\b[A-Z][a-z]+\s+(from|at)\s+[A-Z][A-Za-z0-9& ]{2,40}\b(?:\s+(Travel|Tours|Holidays|Agency|Co\.?))?/g,
  // "<First> <Last> said|told us|says"
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+said|\s+told\s+us|\s+says|\s+mentioned|\s+shared|\s+commented)/g,
];

// First-name-only testimonials (NEW v2 — closes the "Sarah told us" gap)
function buildFirstNameTestimonialRegex() {
  const namesPattern = COMMON_FIRST_NAMES.join("|");
  return new RegExp(
    `\\b(${namesPattern})\\s+(told\\s+(us|me)|said|says|mentioned|shared|reckons|reckoned)\\b`,
    "gi"
  );
}

// Anonymous case studies (NEW v2 — closes the "A homeworker in Manchester" gap)
const ANONYMOUS_CASE_STUDY_PATTERNS = [
  /\b(a|an)\s+(homeworker|agent|operator|owner|consultant|founder|director|manager)\s+(in|from|based\s+in)\s+[A-Z][a-z]+(?:[\s-][A-Z][a-z]+)?\s+(?:has\s+|just\s+)?(doubled|tripled|quadrupled|halved|grew|grown|saved|increased|cut|reduced|boosted|lifted|hit|smashed|exceeded|achieved|landed|secured|won|booked)/gi,
  /\b(one\s+of\s+our|one\s+of\s+the)\s+(agents?|operators?|clients?|customers?)\s+(?:in\s+[A-Z][a-z]+\s+)?(doubled|tripled|saved\s+\d|grew\s+by|grew\s+\d|increased\s+\d|cut\s+\d|reduced\s+\d|booked\s+\d)/gi,
];

// Andy Speight fake quote (NEW v2)
const ANDY_QUOTE_PATTERN = /\b(as\s+)?andy\s+speight\s+(always\s+)?(says|said|told|tells|likes\s+to\s+say|puts\s+it)\b/gi;

const FABRICATED_STAT_PATTERNS = [
  // "saved [them] 40 hours a month" — broader pattern (v2 fix)
  /\bsaved\s+(?:them\s+|us\s+|me\s+|her\s+|him\s+|the(?:m|ir)\s+)?\d+\s*(\+|plus)?\s*(hours?|days?|minutes?)\s*(a|per)?\s*(week|month|day|year)?/gi,
  // "increased X by Y%" without citation
  /\b(increased|improved|boosted|grew|reduced|cut|saved|lifted|doubled|tripled)\s+(?:[a-z]+\s+){0,3}by\s+\d+%?/gi,
  // "X% increase in" / "X% improvement"
  /\b\d+%\s+(increase|improvement|uplift|boost|reduction|saving)/gi,
  // "X% of our clients" (NEW v2)
  /\b\d+%\s+of\s+(our|the|all)\s+(clients|customers|users|agents|operators)\b/gi,
  // "X% of <work nouns>" (NEW 21 May 2026 — closes the "80% of inquiries handled" gap)
  // Catches "80% of inquiries handled automatically", "75% of leads converted",
  // "60% of queries resolved", "90% of bookings completed", etc.
  /\b\d+%\s+of\s+(inquiries|enquiries|queries|leads|bookings|requests|emails|messages|calls|conversations|chats|tickets|searches)\b/gi,
  // Bare "X% <verbed> automatically/automated" — covers the no-noun variant
  // ("handled 80% automatically", "process 90% without human input")
  /\b\d+%\s+(?:\w+\s+)?(automatically|automated|without\s+human|hands-?\s*free)\b/gi,
  // "most/many of our clients see results..." (NEW v2)
  /\b(most|majority|three\s+quarters|two\s+thirds|nine\s+out\s+of\s+ten)\s+of\s+(our|the|all)\s+(clients|customers|users|agents|operators)\s+\w+/gi,
  // "doubled/tripled their <thing>" (NEW v2)
  /\b(doubled|tripled|quadrupled|halved)\s+(?:their|her|his|the)\s+\w+/gi,
];

// Award fabrication (NEW v2)
const AWARD_PATTERNS = [
  /\b(won|winning|winner\s+of|awarded|received|named)\s+(?:the\s+)?(best|leading|top|number\s+one|#1)\s+[a-z\s]{3,40}\s+(award|prize|recognition|accolade)\b/gi,
  /\b(best|leading)\s+[a-z\s]{3,30}\s+(20\d\d|of\s+the\s+year)\s+at\s+the\s+\w+/gi,
];

// Partnership fabrication (NEW v2)
const PARTNERSHIP_PATTERNS = [
  /\b(our|new|exclusive|recent)\s+partnership\s+with\s+([A-Z][\w]+(?:\s+[A-Z][\w]+)*)/gi,
  /\btravelgenix\s+(has\s+)?(just\s+)?(partnered|teamed\s+up|joined\s+forces)\s+with\s+([A-Z][\w]+(?:\s+[A-Z][\w]+)*)/gi,
];

const BANNED_OPENER_PATTERNS = [
  /^in today'?s/i,
  /^in an era of/i,
  /^now more than ever/i,
  /^in the ever[\s-]evolving/i,
  /^picture this/i,
  /^imagine if/i,
  /^what if i told you/i,
];

// Real partnerships from brand-guardrails — these are allowed
const ALLOWED_PARTNERSHIPS = [
  "pts", "protected trust services",
  "tng", "the networking group",
  "holiday extras",
  "advantage travel",
  "ratehawk", "webbeds", "hotelbeds",
  "jet2", "gold medal", "aerticket",
  "tui", "etihad",
  "holiday taxis", "flexible autos", "faremine",
  "agendas group",
];

// ─────────────────────────────────────────────────
// CHECKS
// ─────────────────────────────────────────────────

function checkEmDashes(text) {
  const matches = text.match(/[\u2014\u2013]/g);
  return matches ? { count: matches.length } : null;
}

function checkOxfordCommas(text) {
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
    // Metaphor-only words: only flag when used figuratively (e.g. "travel
    // landscape"), not literally ("the Lake District landscape").
    if (METAPHOR_ONLY_WORDS[word]) {
      if (METAPHOR_ONLY_WORDS[word].test(text)) found.push(word);
      continue;
    }
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
    const regex = new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (regex.test(lower)) found.push(name);
  }
  return found.length ? { competitors: found } : null;
}

function checkFabricatedNames(text) {
  const found = [];
  
  // Pattern 1: "Sarah from/at Company"
  for (const pattern of FABRICATED_NAME_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        const lower = m.toLowerCase();
        if (lower.includes("andy speight") || lower.includes("darren swan")) continue;
        if (/^[A-Z][a-z]+\s+from\s+(London|Paris|Dubai|Manchester|Birmingham|Edinburgh|Bristol|Leeds|Liverpool|Glasgow|UK|US|USA)\b/.test(m)) continue;
        found.push(m);
      }
    }
  }
  
  // Pattern 2: First name only + testimonial verb (NEW v2)
  const firstNameRegex = buildFirstNameTestimonialRegex();
  const firstNameMatches = text.match(firstNameRegex);
  if (firstNameMatches) {
    for (const m of firstNameMatches) {
      const lower = m.toLowerCase();
      if (lower.startsWith("andy") || lower.startsWith("darren")) continue;
      found.push(m);
    }
  }
  
  // Pattern 3: Andy Speight fake quote (NEW v2)
  const andyMatches = text.match(ANDY_QUOTE_PATTERN);
  if (andyMatches) {
    found.push(...andyMatches);
  }
  
  return found.length ? { matches: found.slice(0, 5) } : null;
}

function checkAnonymousCaseStudies(text) {
  const found = [];
  for (const pattern of ANONYMOUS_CASE_STUDY_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) found.push(...matches);
  }
  return found.length ? { matches: found.slice(0, 5) } : null;
}

function checkFabricatedStats(text) {
  const found = [];
  for (const pattern of FABRICATED_STAT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        const lower = m.toLowerCase();
        const idx = text.toLowerCase().indexOf(lower);
        const context = text.slice(Math.max(0, idx - 100), idx + m.length + 100).toLowerCase();
        if (context.match(/(according to|abta|phocuswright|skift|travolution|ttg|travel weekly|google|reuters|study by|research by|report by|atol|aito|advantage)/)) continue;
        found.push(m);
      }
    }
  }
  return found.length ? { matches: found.slice(0, 5) } : null;
}

function checkAwards(text) {
  const found = [];
  for (const pattern of AWARD_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) found.push(...matches);
  }
  return found.length ? { matches: found.slice(0, 3) } : null;
}

function checkPartnerships(text) {
  const found = [];
  for (const pattern of PARTNERSHIP_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        const lower = m.toLowerCase();
        // Allow real partnerships
        if (ALLOWED_PARTNERSHIPS.some(allowed => lower.includes(allowed))) continue;
        found.push(m);
      }
    }
  }
  return found.length ? { matches: found.slice(0, 3) } : null;
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

// Stale-year check (added 22 May 2026). Flags a PAST year only when it is
// framed as the UPCOMING season — e.g. "summer 2025" / "booking for 2025" /
// "2025 is shaping up" when the current year is 2026. Genuine historical
// references ("demand has climbed since 2019") are NOT flagged. This is a FAIL
// because for an auto-posting system a wrong year is a publish-blocker, not a
// stylistic nag. The current year is read live so this never goes stale.
//
// Rule confirmed with Andy 22 May 2026: flag a past year ONLY when it sits
// next to forward-looking words (summer, winter, spring, autumn, season,
// booking(s), book, upcoming, ahead, this year's, next, departures, holidays).
function checkStaleYear(text, opts = {}) {
  const currentYear = opts.currentYear || new Date().getFullYear();
  // Years we treat as "fine to frame as upcoming": current and next.
  // Anything strictly before the current year, framed forward, is stale.
  const FORWARD_WORDS = "summer|winter|spring|autumn|season|seasons|booking|bookings|book|booked|upcoming|ahead|departures|holidays|getaways|breaks|trips|sell|selling|peak";
  // Match a 20xx year within ~40 chars of a forward word, in either order.
  const yearNearForward = new RegExp(
    `(?:(?:${FORWARD_WORDS})\\b[^.?!\\n]{0,40}?\\b(20\\d{2})\\b)|(?:\\b(20\\d{2})\\b[^.?!\\n]{0,40}?\\b(?:${FORWARD_WORDS}))`,
    "gi"
  );
  const matches = [];
  let m;
  while ((m = yearNearForward.exec(text)) !== null) {
    const yr = parseInt(m[1] || m[2], 10);
    if (!isNaN(yr) && yr < currentYear) {
      // A past year framed alongside a forward-looking word → stale.
      const snippet = text.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10).trim();
      matches.push(`${yr} ("...${snippet}...")`);
    }
  }
  return matches.length > 0 ? { matches, currentYear } : null;
}

// ─────────────────────────────────────────────────
// CHECK: KNOWN FALSE PRODUCT CLAIMS
// ─────────────────────────────────────────────────
// Facts the founder has corrected keep leaking back in via stale copy
// (old product records, cached drafts) even after the prompt fact sheets
// were fixed. This is a hard tripwire for claims we KNOW the true value
// of, so a wrong number can never reach the queue as publishable.
// Today's list: the Widget Suite has EXACTLY 40 widgets — any other
// count, or an inflating qualifier ("40+", "over 40"), is false.
function checkKnownFalseClaims(text) {
  const matches = [];
  const widgetClaim = /\b(over|more than|nearly|almost|some)?\s*(\d+)\s*(\+)?\s*(?:[a-z][a-z-]*\s+){0,2}widgets\b/gi;
  let m;
  while ((m = widgetClaim.exec(text)) !== null) {
    const qualifier = (m[1] || "").toLowerCase();
    const n = parseInt(m[2], 10);
    const plus = !!m[3];
    if (n !== 40 || plus || qualifier) {
      matches.push(`"${m[0].trim()}" (the Widget Suite has exactly 40 widgets)`);
    }
  }
  return matches.length > 0 ? { matches } : null;
}

// ─────────────────────────────────────────────────
// MAIN VALIDATOR
// ─────────────────────────────────────────────────

function validateContent(text, opts = {}) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return { passed: true, issues: [], severity: "pass", summary: "(empty)" };
  }

  const issues = [];

  // SEVERITY: FAIL
  const competitors = checkCompetitors(text);
  if (competitors) issues.push({ severity: "fail", code: "COMPETITOR_NAMED", detail: `Named competitors: ${competitors.competitors.join(", ")}` });

  const staleYear = checkStaleYear(text, opts);
  if (staleYear) issues.push({ severity: "fail", code: "STALE_YEAR", detail: `Past year framed as upcoming (current year ${staleYear.currentYear}): ${staleYear.matches.join(" / ")}` });

  const fabNames = checkFabricatedNames(text);
  if (fabNames) issues.push({ severity: "fail", code: "FABRICATED_CLIENT", detail: `Possible invented client/person reference: ${fabNames.matches.join(" / ")}` });

  const anonCases = checkAnonymousCaseStudies(text);
  if (anonCases) issues.push({ severity: "fail", code: "FABRICATED_CASE_STUDY", detail: `Specific anonymous case study (likely invented): ${anonCases.matches.join(" / ")}` });

  if (!opts.allowBenchmarkStats) {
    const fabStats = checkFabricatedStats(text);
    if (fabStats) issues.push({ severity: "fail", code: "FABRICATED_STAT", detail: `Possible invented statistic: ${fabStats.matches.join(" / ")}` });
  }

  const awards = checkAwards(text);
  if (awards) issues.push({ severity: "fail", code: "FABRICATED_AWARD", detail: `Possible invented award: ${awards.matches.join(" / ")}` });

  const partnerships = checkPartnerships(text);
  if (partnerships) issues.push({ severity: "fail", code: "FABRICATED_PARTNERSHIP", detail: `Possible invented partnership: ${partnerships.matches.join(" / ")}` });

  const falseClaims = checkKnownFalseClaims(text);
  if (falseClaims) issues.push({ severity: "fail", code: "KNOWN_FALSE_CLAIM", detail: `Known-false product claim: ${falseClaims.matches.join(" / ")}` });

  const emDashes = checkEmDashes(text);
  if (emDashes) issues.push({ severity: "fail", code: "EM_DASH", detail: `Em/en dashes found (${emDashes.count})` });

  const opener = checkBannedOpener(text);
  if (opener) issues.push({ severity: "fail", code: "BANNED_OPENER", detail: `Throat-clearing opener: "${opener.opener}"` });

  // SEVERITY: WARN
  const oxford = checkOxfordCommas(text);
  if (oxford) issues.push({ severity: "warn", code: "OXFORD_COMMA", detail: `Possible Oxford comma usage (${oxford.count}): ${oxford.examples.join(", ")}` });

  const curly = checkCurlyQuotes(text);
  if (curly) issues.push({ severity: "warn", code: "CURLY_QUOTES", detail: `Curly quotes found (${curly.count}) — should be straight` });

  const banned = checkBannedWords(text);
  if (banned) issues.push({ severity: "warn", code: "BANNED_WORD", detail: `Banned words: ${banned.words.join(", ")}` });

  const phrases = checkBannedPhrases(text);
  if (phrases) issues.push({ severity: "warn", code: "BANNED_PHRASE", detail: `Banned phrases: ${phrases.phrases.join(" | ")}` });

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
      allIssues.push({ ...issue, field: check.name });
    }
    if (result.severity === "fail") highestSeverity = "fail";
    else if (result.severity === "warn" && highestSeverity !== "fail") highestSeverity = "warn";
  }

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

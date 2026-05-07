/**
 * /api/events-discover
 *
 * Monthly event discovery cron for Luna Marketing's Events Calendar.
 *
 * Replaces the killed Tier-1 events-topup. Now runs on Sonnet 4.6 with
 * Tier-2 rate limit headroom, covers an 18-month horizon split into
 * 3-month chunks, has no per-run event cap, and fires the verification
 * engine asynchronously after writing.
 *
 * What it does:
 *   1. Fetches ALL existing event names from Airtable (for in-prompt de-dupe)
 *   2. For each 3-month window in the next 18 months, asks Sonnet 4.6 with
 *      web search what notable events fall in that window — broad scope:
 *      sporting, cultural, royal, political, business, awareness, religious.
 *   3. Server-side fuzzy de-dupes against existing events (handles prefix
 *      variants like "TCS London Marathon" vs "London Marathon").
 *   4. Writes new events to Airtable with Status=pending, Verified At empty.
 *   5. Fires off /api/events-verify-batch asynchronously (fire-and-forget)
 *      so the new events get auto-verified without blocking this function.
 *
 * Two modes:
 *   - GET /api/events-discover?mode=cron   — Vercel cron, requires CRON_SECRET
 *   - GET /api/events-discover?mode=manual — Andy-triggered, requires ADMIN_KEY
 *
 * Safety:
 *   - All new events default to Status=pending (verification engine handles them)
 *   - Multiple sources of truth: each chunk runs with web search; verification
 *     engine then independently checks 2+ sources for every event before approving
 *   - Chunked discovery (3-month windows) keeps each Claude call under timeouts
 *   - De-dupe prevents duplicate records even when Sonnet ignores the in-prompt list
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY, TG_EVENTS_AIRTABLE_PAT, CRON_SECRET, ADMIN_KEY
 */

const AIRTABLE_API   = 'https://api.airtable.com/v0';
const EVENTS_BASE_ID = 'appSoIlSe0sNaJ4BZ';
const EVENTS_TABLE   = 'tblQxIYrbzd6YlJYV';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

const FIELDS = {
  name:        'fldeCYUaMLwkWpv2u',
  dateStart:   'fld3kpR4x8CMyN5X5',
  dateEnd:     'fldwec6M9n8vwsLHz',
  category:    'fldNLLFPH91s604GB',
  countries:   'fldxFYgltX1yU9ks3',
  destinations:'fldCDWRuWhFr71WUf',
  travelAngle: 'fldyQhl1FiHk23fAN',
  audience:    'fldrSxFITuFdeiBUz',
  recurring:   'fldVnfmglfOfjnLqS',
  impact:      'fldpvhsssthzhTO36',
  suggestion:  'fld3r8C281SlFUd7X',
  leadTime:    'fldikCV1FNGgxZOys',
  status:      'fldkJLEulZQJVR0hY',
};

// Allowed singleSelect/multiSelect option values — must match Airtable exactly.
// Mirrors events-topup.js so we stay consistent across discovery + manual entry.
const ALLOWED_CATEGORIES = [
  'Public Holiday', 'Religious Festival', 'Cultural Festival', 'Sporting Event',
  'Music Festival', 'Food & Drink', 'School Holiday', 'Awareness Day',
  'Major Anniversary', 'Conference/Expo', 'Trade Show', 'Industry Event',
  'Product Launch', 'Commercial Event',
];
const ALLOWED_AUDIENCES = [
  'Families', 'Couples', 'Adventure', 'Culture', 'Food & Drink',
  'Sports Fans', 'Budget', 'Luxury', 'Solo', 'Groups',
];
const ALLOWED_RECURRING = ['Annual', 'One-off', 'Every 2 years', 'Every 4 years'];
const ALLOWED_IMPACT   = [
  'Major — drives bookings',
  'Moderate — good content hook',
  'Minor — social awareness',
  'High',
  'Medium',
];

// SSO owner verification — used when this endpoint is called from the
// Pending Review UI in client.html. Mirrors the pattern in events-admin.js
// and events-verify-batch.js.
const ID_HOST = 'https://id.travelify.io';
const CLIENTS_TABLE  = 'tblUkzvBujc94Yali';
const OWNER_CLIENT_ID = 'recFXQY7be6gMr4In';

const ALLOWED_ORIGINS = [
  'https://luna-marketing.vercel.app',
  'https://marketing.travelify.io'
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function escFormulaSso(s) {
  return String(s || '').replace(/'/g, "\\'");
}

async function verifyOwnerSso(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: 'Not signed in' };
  }
  let meData;
  try {
    const meRes = await fetch(ID_HOST + '/api/auth/me', {
      method: 'GET', headers: { cookie: cookie }
    });
    if (meRes.status === 401) return { ok: false, status: 401, error: 'Session expired' };
    if (!meRes.ok) return { ok: false, status: 502, error: 'Auth check failed' };
    meData = await meRes.json();
  } catch (e) { return { ok: false, status: 502, error: 'Auth check failed' }; }
  if (!meData || !meData.ok || !meData.user || !meData.user.email) {
    return { ok: false, status: 401, error: 'Invalid session' };
  }
  const email = String(meData.user.email).trim().toLowerCase();
  const atKey = process.env.AIRTABLE_KEY;
  if (!atKey) return { ok: false, status: 500, error: 'Server not configured' };
  const formula = encodeURIComponent("LOWER({Monthly Report Email})='" + escFormulaSso(email) + "'");
  const url = AIRTABLE_API + '/' + EVENTS_BASE_ID + '/' + CLIENTS_TABLE + '?filterByFormula=' + formula + '&maxRecords=10';
  let records = [];
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + atKey } });
    if (!r.ok) return { ok: false, status: 502, error: 'Client lookup failed' };
    records = ((await r.json()).records) || [];
  } catch (e) { return { ok: false, status: 502, error: 'Client lookup failed' }; }
  if (records.length === 0) return { ok: false, status: 403, error: 'No client linked' };
  const isOwner = records.some(rec => rec.id === OWNER_CLIENT_ID);
  if (!isOwner) return { ok: false, status: 403, error: 'Not authorised' };
  return { ok: true };
}

// ── Helpers ──────────────────────────────────────────

function safeStr(v, max = 500) {
  if (v == null) return '';
  return String(v).replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, max);
}

function safeDate(v) {
  if (typeof v !== 'string') return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

function pickFromList(value, allowed) {
  if (typeof value !== 'string') return '';
  const normalised = value.trim();
  const hit = allowed.find(opt => opt.toLowerCase() === normalised.toLowerCase());
  return hit || '';
}

function pickListFromList(values, allowed) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    const hit = pickFromList(v, allowed);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

// Normalise an event name for fuzzy comparison. Strips years, common prefixes
// like sponsor names, common suffix words ("Festival", "Championship") that
// often appear or get dropped, and punctuation/whitespace. Two events
// normalise to the same string only if they're effectively the same event.
function normaliseName(name) {
  if (!name) return '';
  let s = String(name).toLowerCase();
  // Strip 4-digit years
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ');
  // Strip ordinals (1st, 2nd, 3rd, 4th...)
  s = s.replace(/\b\d+(st|nd|rd|th)\b/g, ' ');
  // Strip leading sponsor / corporate prefixes — known patterns only
  s = s.replace(/^(tcs|virgin money|virgin|emirates|aig|royal|the)\s+/i, '');
  // Normalise common abbreviations to canonical forms BEFORE filler stripping
  s = s.replace(/\bgp\b/g, 'grand prix');
  s = s.replace(/\bf1\b/g, 'formula one');
  s = s.replace(/\bworld cup\b/g, 'worldcup'); // keep as one token
  // Strip suffix-noise words that genuinely come and go in event names.
  // We do NOT strip cities or country names — those are identifying.
  const fillers = [
    'festival','festivals','championship','championships','tournament',
    'tournaments','annual','the','of','and','on','at','in','for'
  ];
  fillers.forEach(f => {
    s = s.replace(new RegExp('\\b' + f + '\\b', 'g'), ' ');
  });
  // Collapse non-alphanumerics
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  return s;
}

// ── Read existing events for de-dupe ────────────────

async function fetchExistingEvents(pat) {
  const params = new URLSearchParams();
  params.set('pageSize', '100');
  params.set('returnFieldsByFieldId', 'true');
  params.append('fields[]', FIELDS.name);
  params.append('fields[]', FIELDS.dateStart);

  const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE}?${params.toString()}`;
  const events = [];
  let offset = '';
  let pages = 0;

  while (pages < 15) {
    const fetchUrl = offset ? `${url}&offset=${offset}` : url;
    const r = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${pat}` } });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`airtable-list-${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    for (const rec of (data.records || [])) {
      const f = rec.fields || {};
      const name = f[FIELDS.name];
      const dateStart = f[FIELDS.dateStart];
      if (name && typeof name === 'string') {
        events.push({
          name: name,
          dateStart: typeof dateStart === 'string' ? dateStart : '',
          normalised: normaliseName(name),
        });
      }
    }
    offset = data.offset || '';
    pages += 1;
    if (!offset) break;
  }

  return events;
}

// ── Discovery prompt ────────────────────────────────

function buildPrompt(existingEventNames, windowStart, windowEnd) {
  // Pass up to 80 names to keep prompt compact but cover most existing events.
  // Server-side fuzzy de-dupe catches the rest.
  const nameList = existingEventNames.slice(0, 80).join(', ');

  return `You discover notable events for Luna Marketing, a UK travel-tech marketing engine. The events go into a content calendar that helps travel agents create timely posts.

YOUR TASK: Find notable events between ${windowStart} and ${windowEnd} that aren't already in our calendar.

SCOPE: Broader than just travel. Travel agents create content around all of:
- Sporting fixtures (Premier League finals, F1 races, Wimbledon, Grand Slams, Olympics, World Cups, major championships)
- Cultural festivals (Glastonbury, Edinburgh Fringe, Burning Man, La Tomatina, Diwali, Lunar New Year)
- Music events (major tours, festivals, residencies)
- Royal & political events (coronations, state visits, elections, jubilees, presidential inaugurations)
- Religious festivals with travel impact (Ramadan, Easter, Christmas markets, Hajj, major saints' days)
- Public holidays in UK source-market AND popular destination countries (Bank holidays, July 4th, Bastille Day, etc.)
- School holidays (UK term dates, US spring break, EU summer breaks)
- Awareness days the travel-curious care about (Earth Day, World Oceans Day, World Tourism Day, International Womens Day)
- Business / industry events (WTM, ITB, ABTA, PTS, TravelTech Show, CES, Davos, Cannes, COP)
- Major anniversaries (centenaries, 50th anniversaries of cultural moments)
- Cultural moments (Oscars, Eurovision, Met Gala, Cannes Film Festival)
- Food & drink events (Oktoberfest, Beaujolais Nouveau, Champagne Day, harvest festivals)

QUALITY RULES — non-negotiable:
1. Use web search to verify every event's existence and dates. We require multiple sources of truth.
2. Only return events with a confirmed date or date range you found in at least 2 authoritative sources (official site, governing body, major news, Wikipedia).
3. If you can't verify dates from 2+ sources, do NOT return the event. Quality over quantity.
4. Skip anything in the ALREADY COVERED list and any close variants.
5. All dates must fall between ${windowStart} and ${windowEnd}.

ALREADY COVERED (do not return these or close variants): ${nameList}

OUTPUT: Return ONLY a valid JSON array. No prose, no markdown fences, no preamble. Empty array if you found nothing new.

Each event object:
{
  "name": "Official event name with year (under 100 chars)",
  "dateStart": "YYYY-MM-DD",
  "dateEnd": "YYYY-MM-DD",
  "category": one of: ${ALLOWED_CATEGORIES.join(' | ')},
  "countries": "Country, Country" (or empty for global),
  "destinations": "City, City" (empty if national),
  "travelAngle": "1-2 sentences on why travel agents should care — what content hook does this give them?",
  "audience": array from: ${ALLOWED_AUDIENCES.join(' | ')},
  "recurring": one of: ${ALLOWED_RECURRING.join(' | ')},
  "impact": one of: ${ALLOWED_IMPACT.join(' | ')},
  "contentSuggestion": "1-2 sentences suggesting a specific post angle",
  "leadTimeWeeks": integer 2-12
}`;
}

async function callClaude(prompt, apiKey) {
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
    messages: [{ role: 'user', content: prompt }],
  };

  // Retry-once on 429 with backoff (mirrors event-verify pattern)
  const maxAttempts = 2;
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (r.ok) {
      const data = await r.json();
      const text = (data.content || [])
        .filter(b => b && b.type === 'text')
        .map(b => b.text || '')
        .join('\n')
        .trim();
      return text;
    }

    const txt = await r.text().catch(() => '');
    lastErr = `anthropic-${r.status}: ${txt.slice(0, 300)}`;

    if ((r.status === 429 || r.status === 529) && attempt < maxAttempts) {
      const retryAfterSec = parseInt(r.headers.get('retry-after') || '0', 10);
      const waitMs = retryAfterSec > 0 ? Math.min(retryAfterSec * 1000, 65000) : 35000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }
    break;
  }

  throw new Error(lastErr || 'anthropic-unknown-error');
}

function parseEventsArray(text) {
  if (!text) return [];
  // Strip code fences if any
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  // Find the first [ and the last ] to extract the JSON array
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// ── Validate + de-dupe ──────────────────────────────

function validateAndShape(rawEvents, existingNormalised, alreadyAddedThisRun, windowStart, windowEnd) {
  const out = [];
  const startMs = new Date(windowStart).getTime();
  const endMs = new Date(windowEnd).getTime();

  for (const e of (rawEvents || [])) {
    if (!e || typeof e !== 'object') continue;

    const name = safeStr(e.name, 100);
    const dateStart = safeDate(e.dateStart);
    if (!name || !dateStart) continue;

    // Date in window?
    const dMs = new Date(dateStart).getTime();
    if (isNaN(dMs) || dMs < startMs || dMs > endMs) continue;

    // De-dupe against existing in DB
    const norm = normaliseName(name);
    if (!norm) continue;
    if (existingNormalised.has(norm)) continue;
    // De-dupe against events we've already accepted earlier in THIS run
    // (chunks may overlap on month boundaries)
    if (alreadyAddedThisRun.has(norm)) continue;

    const dateEnd = safeDate(e.dateEnd) || dateStart;
    const category = pickFromList(e.category, ALLOWED_CATEGORIES);
    const recurring = pickFromList(e.recurring, ALLOWED_RECURRING);
    const impact = pickFromList(e.impact, ALLOWED_IMPACT);
    const audience = pickListFromList(e.audience, ALLOWED_AUDIENCES);

    // Skip events with missing critical singleSelects — better no record than a bad one
    if (!category || !impact) continue;

    const leadTimeNum = Number(e.leadTimeWeeks);
    const leadTime = Number.isFinite(leadTimeNum) && leadTimeNum >= 1 && leadTimeNum <= 26
      ? Math.round(leadTimeNum)
      : 4;

    out.push({
      name: name,
      dateStart: dateStart,
      dateEnd: dateEnd,
      category: category,
      countries: safeStr(e.countries, 200),
      destinations: safeStr(e.destinations, 200),
      travelAngle: safeStr(e.travelAngle, 500),
      audience: audience,
      recurring: recurring || 'One-off',
      impact: impact,
      contentSuggestion: safeStr(e.contentSuggestion, 500),
      leadTimeWeeks: leadTime,
    });

    alreadyAddedThisRun.add(norm);
  }

  return out;
}

// ── Write to Airtable ───────────────────────────────

async function writeEventsToAirtable(events, pat) {
  if (!events.length) return { written: 0, ids: [] };

  // Airtable supports up to 10 records per create call
  const ids = [];
  let written = 0;
  for (let i = 0; i < events.length; i += 10) {
    const slice = events.slice(i, i + 10);
    const records = slice.map(e => {
      const fields = {};
      fields[FIELDS.name]         = e.name;
      fields[FIELDS.dateStart]    = e.dateStart;
      fields[FIELDS.dateEnd]      = e.dateEnd;
      fields[FIELDS.category]     = e.category;
      fields[FIELDS.countries]    = e.countries;
      fields[FIELDS.destinations] = e.destinations;
      fields[FIELDS.travelAngle]  = e.travelAngle;
      fields[FIELDS.audience]     = e.audience;
      fields[FIELDS.recurring]    = e.recurring;
      fields[FIELDS.impact]       = e.impact;
      fields[FIELDS.suggestion]   = e.contentSuggestion;
      fields[FIELDS.leadTime]     = e.leadTimeWeeks;
      fields[FIELDS.status]       = 'pending';
      return { fields: fields };
    });

    const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: records, typecast: true }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`airtable-create-${r.status}: ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    for (const rec of (data.records || [])) {
      ids.push(rec.id);
      written += 1;
    }
  }

  return { written: written, ids: ids };
}

// ── Verification trigger (fire-and-forget) ──────────

// Calls /api/events-verify-cron, which loops internally for up to 4.5 minutes
// processing chunks until either everything's verified or the timer is about
// to expire. Daily verify cron schedule picks up anything left over.
async function fireVerification(host) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !host) return { fired: false, reason: 'missing host or secret' };

  const url = `https://${host}/api/events-verify-cron`;

  // Fire and forget: don't await. The verify cron has its own 5-min ceiling.
  try {
    fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch(e => {
      console.error('fireVerification background fetch failed', e);
    });
    return { fired: true };
  } catch (e) {
    return { fired: false, reason: String(e && e.message || e).slice(0, 200) };
  }
}

// ── Window builder ──────────────────────────────────

function buildWindows() {
  // 6 chunks of 3 months covering the next 18 months from today.
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const windows = [];
  for (let i = 0; i < 6; i++) {
    const start = new Date(now);
    start.setUTCMonth(start.getUTCMonth() + i * 3);
    const end = new Date(now);
    end.setUTCMonth(end.getUTCMonth() + (i + 1) * 3);
    end.setUTCDate(end.getUTCDate() - 1);
    windows.push({
      start: start.toISOString().slice(0, 10),
      end:   end.toISOString().slice(0, 10),
    });
  }
  return windows;
}

// ── Main handler ────────────────────────────────────

module.exports = async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const mode = String((req.query && req.query.mode) || 'manual');

  // Three auth paths:
  //   - cron   : Vercel cron, requires CRON_SECRET
  //   - manual : curl/CLI, requires ADMIN_KEY
  //   - ui     : browser-driven from Pending Review tab, requires SSO cookie
  //              and the user must be the Travelgenix owner
  if (mode === 'cron') {
    const expected = process.env.CRON_SECRET;
    if (!expected) return res.status(500).json({ error: 'CRON_SECRET not configured' });
    const got = req.headers.authorization || req.headers['x-cron-secret'] || '';
    const token = typeof got === 'string' && got.startsWith('Bearer ') ? got.slice(7) : got;
    if (token !== expected) return res.status(401).json({ error: 'Unauthorised' });
  } else if (mode === 'ui') {
    const auth = await verifyOwnerSso(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  } else {
    const expected = process.env.ADMIN_KEY;
    const got = req.headers['x-admin-key'] || (req.query && req.query.key) || '';
    if (!expected || got !== expected) return res.status(401).json({ error: 'Unauthorised — admin key required' });
  }

  const pat = process.env.TG_EVENTS_AIRTABLE_PAT;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!pat) return res.status(500).json({ error: 'TG_EVENTS_AIRTABLE_PAT not set' });
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const startedAt = Date.now();

  try {
    // 1. Fetch existing events (for in-prompt + server-side de-dupe)
    const existing = await fetchExistingEvents(pat);
    const existingNames = existing.map(x => x.name);
    const existingNormalised = new Set(existing.map(x => x.normalised).filter(Boolean));

    // 2. Build 18-month window split into 6 × 3-month chunks
    const windows = buildWindows();

    // 3. For each chunk, ask Claude. Track everything added so subsequent
    //    chunks de-dupe against new additions (window edges can overlap on
    //    multi-day events).
    const allAdded = [];
    const alreadyAddedThisRun = new Set();
    const chunkSummaries = [];

    for (const w of windows) {
      let chunkOut = [];
      let chunkErr = '';
      try {
        const prompt = buildPrompt(existingNames, w.start, w.end);
        const text = await callClaude(prompt, apiKey);
        const raw = parseEventsArray(text);
        const validated = validateAndShape(raw, existingNormalised, alreadyAddedThisRun, w.start, w.end);
        chunkOut = validated;
        // Mark them as existing for future chunks too
        validated.forEach(e => existingNormalised.add(normaliseName(e.name)));
        allAdded.push(...validated);
      } catch (e) {
        chunkErr = String(e && e.message || e).slice(0, 300);
      }
      chunkSummaries.push({
        window: `${w.start} → ${w.end}`,
        rawCount: chunkOut.length,
        error: chunkErr || null,
      });
    }

    // 4. Write all accepted events to Airtable as Status=pending
    const { written, ids } = await writeEventsToAirtable(allAdded, pat);

    // 5. Fire the verification engine asynchronously. It auto-skips events
    //    that already have Verified At set, so it'll only process the new
    //    ones we just wrote (plus any leftover unverified pendings).
    const host = req.headers && req.headers.host;
    let verifyTrigger = { fired: false };
    if (written > 0) {
      verifyTrigger = await fireVerification(host);
    }

    return res.status(200).json({
      success: true,
      mode: mode,
      windows: chunkSummaries,
      existingCount: existing.length,
      proposed: allAdded.length,
      written: written,
      writtenIds: ids,
      verifyTrigger: verifyTrigger,
      durationMs: Date.now() - startedAt,
    });

  } catch (err) {
    console.error('events-discover error', err);
    return res.status(500).json({
      success: false,
      error: String(err && err.message || err).slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
  }
};

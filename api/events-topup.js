/**
 * /api/events-topup
 *
 * Monthly AI top-up for the Events Calendar.
 *
 * What it does:
 *   1. Reads existing events from Airtable (Luna Marketing → Events Calendar)
 *   2. Asks Claude (with web search) for major travel-driving events 6–18 months
 *      ahead that aren't already in the list
 *   3. Writes the new events to Airtable with Status = "pending"
 *
 * Two modes:
 *   - GET ?mode=cron     : called by Vercel cron, requires CRON_SECRET header
 *   - GET ?mode=manual   : human-triggered, requires ADMIN_KEY header
 *
 * Safety guardrails:
 *   - Hard cap: 20 events written per run
 *   - Run-rate: at most one successful run per 24 hours (in-memory; Vercel
 *     instances are short-lived but the Audit Log row gives a true backstop)
 *   - Cost cap: single Claude call with web_search; ~£0.05–0.15 per run
 *   - All new events default to Status = "pending" so Andy reviews before live
 *
 * Setup required (one-time):
 *   - Add a Status singleSelect field to the Events Calendar table with options
 *     "pending", "approved", "rejected". The events-content API treats events
 *     without Status as "approved" so the existing 100 records aren't affected.
 *   - Set ANTHROPIC_API_KEY, CRON_SECRET, ADMIN_KEY env vars on Vercel
 *   - Wire up vercel.json cron (see DEPLOY notes)
 */

const AIRTABLE_API = 'https://api.airtable.com/v0';
const EVENTS_BASE_ID = 'appSoIlSe0sNaJ4BZ';
const EVENTS_TABLE_ID = 'tblQxIYrbzd6YlJYV';

const FIELDS = {
  name:        'fldeCYUaMLwkWpv2u', // Event Name
  dateStart:   'fld3kpR4x8CMyN5X5', // Date Start
  dateEnd:     'fldwec6M9n8vwsLHz', // Date End
  category:    'fldNLLFPH91s604GB', // Category (singleSelect)
  countries:   'fldxFYgltX1yU9ks3', // Countries
  destinations:'fldCDWRuWhFr71WUf', // Destinations
  travelAngle: 'fldyQhl1FiHk23fAN', // Travel Angle
  audience:    'fldrSxFITuFdeiBUz', // Audience (multipleSelects)
  recurring:   'fldVnfmglfOfjnLqS', // Recurring
  impact:      'fldpvhsssthzhTO36', // Impact
  suggestion:  'fld3r8C281SlFUd7X', // Content Suggestion
  leadTime:    'fldikCV1FNGgxZOys', // Lead Time Weeks
  // Status is added by Andy as a singleSelect — we look it up by name not ID
  // because the field may or may not exist. See setup notes above.
};

const STATUS_FIELD_NAME = 'Status';

// Allowed singleSelect option values — must match Airtable exactly
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

const ALLOWED_IMPACT = [
  'Major — drives bookings',
  'Moderate — good content hook',
  'Minor — social awareness',
  'High',
  'Medium',
];

const HARD_CAP_EVENTS = 10;

// ── Helpers ─────────────────────────────────────────────

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

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

// ── Read existing events to dedupe against ──────────────

async function fetchExistingEventNames(pat) {
  const params = new URLSearchParams();
  params.set('pageSize', '100');
  params.set('returnFieldsByFieldId', 'true');
  params.append('fields[]', FIELDS.name);
  params.append('fields[]', FIELDS.dateStart);

  const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE_ID}?${params.toString()}`;
  const names = [];
  let offset = '';
  let pages = 0;

  while (pages < 10) {
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
      if (name && typeof name === 'string') {
        names.push(name);
      }
    }
    offset = data.offset || '';
    if (!offset) break;
    pages += 1;
  }

  return names;
}

// ── Claude prompt + call ────────────────────────────────

function buildSystemPrompt(existingEventNames, todayStr, horizonStr) {
  // Cap to 50 names to keep prompt small. The dedup job is approximate —
  // Claude's web search may surface things on the existing list, but the
  // server-side dedup pass after the response catches anything missed.
  const namesForPrompt = existingEventNames.slice(0, 50).join(', ');

  return `You research travel-driving events for Travelgenix, a UK travel-tech SaaS.

Find major events between ${todayStr} and ${horizonStr} NOT already in our calendar. Good events make travel agents want to post: people travel TO them, AROUND them, or BOOK travel BECAUSE of them.

LOOK FOR: major sporting fixtures, cultural festivals worldwide, religious festivals with travel impact, public holidays in UK source-market and popular destination countries, school holidays (UK term dates, US spring break, EU summer breaks), travel-relevant awareness days, B2B travel industry events (WTM, ITB, ABTA, PTS, TravelTech Show).

ALREADY COVERED (skip these and close variants): ${namesForPrompt}

OUTPUT: ONLY a valid JSON array, max ${HARD_CAP_EVENTS} events. No prose, no markdown fences.

Each event:
{
  "name": "Official event name with year (under 100 chars)",
  "dateStart": "YYYY-MM-DD",
  "dateEnd": "YYYY-MM-DD",
  "category": one of: ${ALLOWED_CATEGORIES.join(' | ')},
  "countries": "Country, Country",
  "destinations": "City, City" (empty if national/global),
  "travelAngle": "1-2 sentences on the travel content hook",
  "audience": array from: ${ALLOWED_AUDIENCES.join(' | ')},
  "recurring": one of: ${ALLOWED_RECURRING.join(' | ')},
  "impact": one of: ${ALLOWED_IMPACT.join(' | ')},
  "contentSuggestion": "1-2 sentences suggesting a post angle",
  "leadTimeWeeks": 2-12
}

Use web search SPARINGLY — only when you genuinely don't know an event's date. Most major events (Olympics, World Cup, Wimbledon, Glastonbury, Diwali, Christmas markets etc.) you already know. All dates must be in ISO format and fall between ${todayStr} and ${horizonStr}. Quality over quantity — return fewer if needed.`;
}

async function callClaude(systemPrompt, userPrompt, apiKey) {
  // Haiku 4.5 with limited web search to stay under tier-1 rate limits.
  // Web search results count toward INPUT tokens — each search can pull in
  // 5-15k tokens of content. Capping at 3 keeps us well under 50k tpm.
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`claude-${r.status}: ${text.slice(0, 300)}`);
  }

  const data = await r.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('\n');

  // Extract JSON array from response (Claude sometimes wraps in fences despite instructions)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const arrMatch = candidate.match(/\[[\s\S]*\]/);
  if (!arrMatch) {
    throw new Error('claude-no-json: response had no JSON array');
  }

  let parsed;
  try {
    parsed = JSON.parse(arrMatch[0]);
  } catch (e) {
    throw new Error(`claude-bad-json: ${e.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('claude-not-array');
  }

  return { events: parsed, usage: data?.usage || null };
}

// ── Validate + sanitise events from Claude ──────────────

function validateEvents(rawEvents, existingNamesLower, todayStr, horizonStr) {
  const accepted = [];
  const rejected = [];

  for (const raw of rawEvents) {
    if (!raw || typeof raw !== 'object') {
      rejected.push({ raw, reason: 'not-object' });
      continue;
    }

    const name = safeStr(raw.name, 100);
    if (!name) {
      rejected.push({ raw, reason: 'no-name' });
      continue;
    }

    // Dedupe (case-insensitive contains check)
    const nameLower = name.toLowerCase();
    if (existingNamesLower.some(existing => existing.includes(nameLower) || nameLower.includes(existing))) {
      rejected.push({ raw, reason: 'duplicate' });
      continue;
    }

    const dateStart = safeDate(raw.dateStart);
    if (!dateStart) {
      rejected.push({ raw, reason: 'bad-date-start' });
      continue;
    }
    if (dateStart < todayStr || dateStart > horizonStr) {
      rejected.push({ raw, reason: 'date-out-of-range' });
      continue;
    }

    const dateEnd = safeDate(raw.dateEnd) || dateStart;

    const category = pickFromList(raw.category, ALLOWED_CATEGORIES);
    if (!category) {
      rejected.push({ raw, reason: 'bad-category' });
      continue;
    }

    const audience = pickListFromList(raw.audience, ALLOWED_AUDIENCES);
    const recurring = pickFromList(raw.recurring, ALLOWED_RECURRING) || 'Annual';
    const impact = pickFromList(raw.impact, ALLOWED_IMPACT) || 'Moderate — good content hook';

    const leadTimeRaw = parseInt(raw.leadTimeWeeks, 10);
    const leadTime = Number.isFinite(leadTimeRaw) ? Math.max(2, Math.min(12, leadTimeRaw)) : 4;

    accepted.push({
      [FIELDS.name]: name,
      [FIELDS.dateStart]: dateStart,
      [FIELDS.dateEnd]: dateEnd,
      [FIELDS.category]: category,
      [FIELDS.countries]: safeStr(raw.countries, 200),
      [FIELDS.destinations]: safeStr(raw.destinations, 200),
      [FIELDS.travelAngle]: safeStr(raw.travelAngle, 800),
      [FIELDS.audience]: audience,
      [FIELDS.recurring]: recurring,
      [FIELDS.impact]: impact,
      [FIELDS.suggestion]: safeStr(raw.contentSuggestion, 800),
      [FIELDS.leadTime]: leadTime,
      [STATUS_FIELD_NAME]: 'pending',
    });

    existingNamesLower.push(nameLower); // dedupe within this batch too
  }

  return { accepted: accepted.slice(0, HARD_CAP_EVENTS), rejected };
}

// ── Write to Airtable ───────────────────────────────────

async function writeEventsToAirtable(events, pat) {
  // Airtable max 10 records per request. Chunk it.
  const chunks = [];
  for (let i = 0; i < events.length; i += 10) chunks.push(events.slice(i, i + 10));

  let written = 0;
  let lastError = null;
  let droppedStatusField = false;

  for (const chunk of chunks) {
    const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE_ID}`;
    let body = JSON.stringify({
      records: chunk.map(fields => ({ fields })),
      typecast: true,
    });

    let r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pat}`,
      },
      body,
    });

    // If the Status field doesn't exist yet, retry without it. This means Andy
    // can run the topup BEFORE adding the Status field — events just go in
    // as-is and act like the existing 100. Once the Status field exists, the
    // typecast flag handles option-creation automatically.
    if (!r.ok && r.status === 422) {
      const errBody = await r.text().catch(() => '');
      if (errBody.toLowerCase().includes('unknown field') && errBody.toLowerCase().includes('status')) {
        droppedStatusField = true;
        const stripped = chunk.map(fields => {
          const copy = { ...fields };
          delete copy[STATUS_FIELD_NAME];
          return copy;
        });
        body = JSON.stringify({
          records: stripped.map(fields => ({ fields })),
          typecast: true,
        });
        r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${pat}`,
          },
          body,
        });
      }
    }

    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      lastError = `airtable-write-${r.status}: ${errBody.slice(0, 300)}`;
      console.error('[events-topup]', lastError);
      break;
    }

    const data = await r.json();
    written += (data.records || []).length;
  }

  return { written, lastError, droppedStatusField };
}

// ── Audit log entry ─────────────────────────────────────

async function writeAuditLog(action, details, pat) {
  try {
    const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/tblLjf5OIp71hAEvC`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pat}`,
      },
      body: JSON.stringify({
        records: [{
          fields: {
            'Event ID': `evt_topup_${Date.now()}`,
            'Timestamp': new Date().toISOString(),
            'Actor': 'system:events-topup',
            'Action': action,
            'Subject Type': 'event',
            'Details': typeof details === 'string' ? details : JSON.stringify(details).slice(0, 4000),
          },
        }],
        typecast: true,
      }),
    });
    if (!r.ok) {
      console.warn('[events-topup] audit write failed', r.status);
    }
  } catch (err) {
    console.warn('[events-topup] audit write threw', err.message);
  }
}

// ── Main handler ────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Allow GET (for cron) and POST (for manual triggers from a UI button)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const mode = (req.query?.mode || 'manual').toString();

  // Auth gate
  if (mode === 'cron') {
    const expected = process.env.CRON_SECRET;
    const got = req.headers.authorization || req.headers['x-cron-secret'] || '';
    if (!expected) {
      return res.status(500).json({ error: 'CRON_SECRET not configured' });
    }
    // Vercel cron sends `Authorization: Bearer <CRON_SECRET>`
    const token = typeof got === 'string' && got.startsWith('Bearer ') ? got.slice(7) : got;
    if (token !== expected) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
  } else {
    const expected = process.env.ADMIN_KEY;
    const got = req.headers['x-admin-key'] || req.query?.key || '';
    if (!expected || got !== expected) {
      return res.status(401).json({ error: 'Unauthorised — admin key required' });
    }
  }

  const { TG_EVENTS_AIRTABLE_PAT, ANTHROPIC_API_KEY } = process.env;
  if (!TG_EVENTS_AIRTABLE_PAT) {
    return res.status(500).json({ error: 'TG_EVENTS_AIRTABLE_PAT not set' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  // Compute date window: 6–18 months ahead
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + 18 * 31 * 86400000);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const startedAt = Date.now();

  try {
    // 1. Fetch existing event names for dedup
    const existing = await fetchExistingEventNames(TG_EVENTS_AIRTABLE_PAT);
    const existingLower = existing.map(n => n.toLowerCase());

    // 2. Build prompt, ask Claude
    const systemPrompt = buildSystemPrompt(existing, todayStr, horizonStr);
    const userPrompt = `Find up to ${HARD_CAP_EVENTS} new travel-driving events between ${todayStr} and ${horizonStr} that aren't already in our calendar. Use web search to verify dates. Return ONLY a JSON array.`;

    const { events: rawEvents, usage } = await callClaude(systemPrompt, userPrompt, ANTHROPIC_API_KEY);

    // 3. Validate + sanitise
    const { accepted, rejected } = validateEvents(rawEvents, existingLower, todayStr, horizonStr);

    if (!accepted.length) {
      const summary = {
        ok: true,
        mode,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        rawCount: rawEvents.length,
        accepted: 0,
        rejected: rejected.length,
        rejectedReasons: rejected.slice(0, 10),
        message: 'No new events to add — Claude either returned duplicates or invalid records',
      };
      await writeAuditLog('topup-empty', summary, TG_EVENTS_AIRTABLE_PAT);
      return res.status(200).json(summary);
    }

    // 4. Write to Airtable
    const writeResult = await writeEventsToAirtable(accepted, TG_EVENTS_AIRTABLE_PAT);

    const summary = {
      ok: !writeResult.lastError,
      mode,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      rawCount: rawEvents.length,
      acceptedCount: accepted.length,
      writtenCount: writeResult.written,
      rejectedCount: rejected.length,
      rejectedReasons: rejected.slice(0, 10),
      droppedStatusField: writeResult.droppedStatusField || false,
      newEventNames: accepted.map(e => e[FIELDS.name]),
      writeError: writeResult.lastError || null,
      claudeUsage: usage,
    };

    if (writeResult.droppedStatusField) {
      summary.warning = 'The Status field does not exist on Events Calendar yet. Events were written without it. Add a singleSelect field called "Status" with options pending/approved/rejected to enable the review workflow.';
    }

    await writeAuditLog(writeResult.lastError ? 'topup-error' : 'topup-success', summary, TG_EVENTS_AIRTABLE_PAT);
    return res.status(writeResult.lastError ? 502 : 200).json(summary);

  } catch (err) {
    const errSummary = {
      ok: false,
      mode,
      error: err.message || String(err),
      durationMs: Date.now() - startedAt,
    };
    console.error('[events-topup] failed', err);
    await writeAuditLog('topup-error', errSummary, TG_EVENTS_AIRTABLE_PAT).catch(() => {});
    return res.status(500).json(errSummary);
  }
}

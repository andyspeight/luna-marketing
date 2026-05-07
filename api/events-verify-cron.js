/**
 * /api/events-verify-cron
 *
 * Cron-driven verification driver. The /api/events-verify-batch endpoint
 * processes one chunk at a time — fine when a browser is driving the loop,
 * but a cron has no browser. This endpoint loops internally for up to
 * ~4.5 minutes (under the 5-min Vercel ceiling), processing chunks until
 * either everything is verified or the timer is about to expire.
 *
 * Triggered by:
 *   - The Vercel cron schedule in vercel.json (runs daily)
 *   - The /api/events-discover endpoint after it writes new events (one-shot)
 *
 * Auth: CRON_SECRET only (this is a server-to-server endpoint, never called
 * from a browser).
 *
 * Required env vars:
 *   CRON_SECRET, ANTHROPIC_API_KEY, AIRTABLE_KEY, TG_EVENTS_AIRTABLE_PAT
 */

const { verifyOne } = require('./event-verify');

const AIRTABLE_API   = 'https://api.airtable.com/v0';
const EVENTS_BASE_ID = 'appSoIlSe0sNaJ4BZ';
const EVENTS_TABLE   = 'tblQxIYrbzd6YlJYV';

const FIELDS = {
  name:           'fldeCYUaMLwkWpv2u',
  dateStart:      'fld3kpR4x8CMyN5X5',
  dateEnd:        'fldwec6M9n8vwsLHz',
  countries:      'fldxFYgltX1yU9ks3',
  status:         'fldkJLEulZQJVR0hY',
  verifiedAt:     'fldPRpt68nR72gaxz',
  vConfidence:    'fld8oVlV8dMGWYPJZ',
  vNotes:         'fldkGbSYEimyTqghd',
};

// Hard time budget — well under Vercel's 5-min ceiling so we always exit cleanly
const SOFT_DEADLINE_MS = 270 * 1000; // 4.5 minutes

function getPat() {
  return process.env.TG_EVENTS_AIRTABLE_PAT || process.env.AIRTABLE_KEY;
}

async function listPendingUnverified(limit) {
  const pat = getPat();
  if (!pat) throw new Error('airtable PAT not configured');

  const params = new URLSearchParams();
  params.set('returnFieldsByFieldId', 'true');
  params.set('pageSize', String(Math.max(limit, 10)));
  params.set('maxRecords', String(Math.max(limit, 10)));
  params.set('filterByFormula', "AND({Status}='pending', {Verified At}=BLANK())");
  params.append('sort[0][field]', 'Date Start');
  params.append('sort[0][direction]', 'asc');

  const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE}?${params.toString()}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`airtable-list-${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data.records || []).slice(0, limit).map(rec => {
    const f = rec.fields || {};
    return {
      id: rec.id,
      name:      f[FIELDS.name] || '',
      dateStart: f[FIELDS.dateStart] || '',
      dateEnd:   f[FIELDS.dateEnd] || '',
      countries: f[FIELDS.countries] || '',
    };
  });
}

function buildNotesText(result) {
  const parts = [];
  parts.push('Confidence: ' + (result.confidence || 'low'));
  parts.push('Dates match stored: ' + (result.datesMatch ? 'yes' : 'no'));
  if (result.verifiedDateStart) parts.push('Verified start: ' + result.verifiedDateStart);
  if (result.verifiedDateEnd)   parts.push('Verified end: ' + result.verifiedDateEnd);
  parts.push('Action taken: ' + result.recommendedAction);
  parts.push('');
  parts.push('Summary:');
  parts.push(result.summary || '(none)');
  if (result.sources && result.sources.length) {
    parts.push('');
    parts.push('Sources:');
    result.sources.forEach((s, i) => {
      const line = '  ' + (i + 1) + '. ' + (s.publisher || '(unknown)') +
        (s.url ? ' — ' + s.url : '') +
        (s.claim ? '\n     ' + s.claim : '');
      parts.push(line);
    });
  }
  return parts.join('\n').slice(0, 95000);
}

async function applyResult(eventRecord, result) {
  const pat = getPat();
  const fields = {};
  fields[FIELDS.verifiedAt]  = new Date().toISOString();
  fields[FIELDS.vConfidence] = result.confidence;
  fields[FIELDS.vNotes]      = buildNotesText(result);

  if (result.recommendedAction === 'approve') {
    fields[FIELDS.status] = 'approved';
  } else if (result.recommendedAction === 'update_dates') {
    fields[FIELDS.status] = 'approved';
    if (result.verifiedDateStart) fields[FIELDS.dateStart] = result.verifiedDateStart;
    if (result.verifiedDateEnd)   fields[FIELDS.dateEnd]   = result.verifiedDateEnd;
  } else if (result.recommendedAction === 'reject') {
    fields[FIELDS.status] = 'rejected';
  }

  const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE}/${eventRecord.id}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields, typecast: true }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`airtable-patch-${r.status}: ${body.slice(0, 200)}`);
  }
}

async function stampError(eventRecord, err) {
  const pat = getPat();
  if (!pat) return;
  const fields = {};
  fields[FIELDS.verifiedAt]  = new Date().toISOString();
  fields[FIELDS.vConfidence] = 'low';
  fields[FIELDS.vNotes]      = 'VERIFICATION ERROR — re-run with force to retry.\n\n' +
    String(err && err.message || err).slice(0, 1500);
  const url = `${AIRTABLE_API}/${EVENTS_BASE_ID}/${EVENTS_TABLE}/${eventRecord.id}`;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields, typecast: true }),
    });
  } catch (e) {
    console.error('stampError failed', eventRecord.id, e);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth — CRON_SECRET only
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  const got = req.headers.authorization || req.headers['x-cron-secret'] || '';
  const token = typeof got === 'string' && got.startsWith('Bearer ') ? got.slice(7) : got;
  if (token !== expected) return res.status(401).json({ error: 'Unauthorised' });

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!getPat()) return res.status(500).json({ error: 'Airtable PAT not set' });

  const startedAt = Date.now();
  let processed = 0, approved = 0, rejected = 0, updated = 0, manualReview = 0, errored = 0;

  try {
    while (Date.now() - startedAt < SOFT_DEADLINE_MS) {
      const events = await listPendingUnverified(3);
      if (!events.length) break; // done

      for (const ev of events) {
        if (Date.now() - startedAt >= SOFT_DEADLINE_MS) break;
        try {
          const result = await verifyOne(ev);
          await applyResult(ev, result);
          processed++;
          const a = result.recommendedAction;
          if (a === 'approve')      approved++;
          else if (a === 'update_dates') updated++;
          else if (a === 'reject')  rejected++;
          else manualReview++;
        } catch (err) {
          console.error('verify-cron event error', ev.id, err);
          await stampError(ev, err);
          processed++;
          errored++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      processed: processed,
      approved: approved,
      updated: updated,
      rejected: rejected,
      manualReview: manualReview,
      errored: errored,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('verify-cron error', err);
    return res.status(500).json({
      success: false,
      error: String(err && err.message || err).slice(0, 500),
      processed: processed,
      durationMs: Date.now() - startedAt,
    });
  }
};

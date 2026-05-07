// Luna Marketing session-based auth.
//
// Validates the tg_session cookie by calling id.travelify.io/api/auth/me,
// then looks up the Luna Marketing client whose Monthly Report Email matches
// the signed-in user's email and returns the full profile that client.html
// needs to render the dashboard.
//
// Multiple clients may match (rare, but possible if the same email is set on
// more than one client record). The front end shows a picker; on selection
// the client posts back with clientId.
//
// Replaces the legacy email + access code flow that lived in /api/client-auth.

const AT_BASE = 'appSoIlSe0sNaJ4BZ';
const AT_TABLE = 'tblUkzvBujc94Yali';
const ID_HOST = 'https://id.travelify.io';

const ALLOWED_ORIGINS = [
  'https://luna-marketing.vercel.app',
  'https://marketing.travelify.io'
];

// Field NAMES on the Clients table. Airtable's REST API returns fields keyed
// by name by default (unlike the MCP tools which use IDs). If a name changes
// in Airtable we'll need to update this map; that's the trade-off.
const FID = {
  businessName:               'Business Name',
  tradingName:                'Trading Name',
  websiteUrl:                 'Website URL',
  package:                    'Package',
  status:                     'Status',
  specialisms:                'Specialisms',
  logoUrl:                    'Logo URL',
  primaryColour:              'Primary Colour',
  secondaryColour:            'Secondary Colour',
  toneKeywords:               'Tone Keywords',
  emojiUsage:                 'Emoji Usage',
  formality:                  'Formality',
  sentenceStyle:              'Sentence Style',
  ctaStyle:                   'CTA Style',
  postingFrequency:           'Posting Frequency',
  postingDays:                'Posting Days',
  monthlyReportEmail:         'Monthly Report Email',
  destinations:               'Destinations',
  autoPublish:                'Auto Publish',
  metricoolBlogId:            'Metricool Blog ID',
  connectedPlatforms:         'Connected Platforms',
  clientType:                 'Client Type',
  contentPillars:             'Content Pillars',
  targetChannels:             'Target Channels',
  metricoolBlogIdPersonal:    'Metricool Blog ID - Personal',
  connectedPlatformsPersonal: 'Connected Platforms Personal'
};

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function escFormula(s) {
  return String(s || '').replace(/'/g, "\\'");
}

function pickName(field) {
  // singleSelect fields come back as { id, name, color }; sometimes plain string
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.name || '';
}

function pickNames(field) {
  if (!field) return [];
  if (Array.isArray(field)) {
    return field.map(function (x) {
      return typeof x === 'string' ? x : (x && x.name) || '';
    }).filter(Boolean);
  }
  return [];
}

// Build the same shape the legacy /api/client-auth used to return so the
// existing dashboard JS can consume it without changes.
function buildProfile(record) {
  const f = record.fields || {};
  return {
    id: record.id,
    business_name: f[FID.businessName] || '',
    trading_name: f[FID.tradingName] || '',
    website_url: f[FID.websiteUrl] || '',
    logo_url: f[FID.logoUrl] || '',
    primary_colour: f[FID.primaryColour] || '',
    secondary_colour: f[FID.secondaryColour] || '',
    tone: f[FID.toneKeywords] || '',
    emoji_usage: pickName(f[FID.emojiUsage]),
    formality: pickName(f[FID.formality]),
    sentence_style: pickName(f[FID.sentenceStyle]),
    cta_style: pickName(f[FID.ctaStyle]),
    posting_frequency: f[FID.postingFrequency] || 3,
    posting_days: f[FID.postingDays] || 'Mon,Wed,Fri',
    destinations: f[FID.destinations] || '',
    auto_publish: !!f[FID.autoPublish],
    specialisms: pickNames(f[FID.specialisms]),
    package: pickName(f[FID.package]),
    status: pickName(f[FID.status]),
    monthly_report_email: f[FID.monthlyReportEmail] || '',
    metricool_blog_id: f[FID.metricoolBlogId] || '',
    connected_platforms: pickNames(f[FID.connectedPlatforms]),
    client_type: pickName(f[FID.clientType]),
    content_pillars: pickNames(f[FID.contentPillars]),
    target_channels: pickNames(f[FID.targetChannels]),
    metricool_blog_id_personal: f[FID.metricoolBlogIdPersonal] || '',
    connected_platforms_personal: pickNames(f[FID.connectedPlatformsPersonal])
  };
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const atKey = process.env.AIRTABLE_KEY;
  if (!atKey) return res.status(500).json({ error: 'Server not configured' });

  try {
    // 1. Validate the central session by forwarding the cookie to id.travelify.io.
    const cookie = req.headers.cookie || '';
    if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    const meRes = await fetch(ID_HOST + '/api/auth/me', {
      method: 'GET',
      headers: { cookie: cookie }
    });
    if (meRes.status === 401) return res.status(401).json({ error: 'Session expired' });
    if (!meRes.ok) return res.status(502).json({ error: 'Auth check failed' });
    const meData = await meRes.json();
    if (!meData || !meData.ok || !meData.user || !meData.user.email) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const email = String(meData.user.email).trim().toLowerCase();
    const body = req.body || {};
    const requestedClientId = body.clientId ? String(body.clientId) : null;

    // 2. Find every Luna Marketing client whose Monthly Report Email matches.
    const formula = encodeURIComponent(
      "LOWER({Monthly Report Email})='" + escFormula(email) + "'"
    );
    const url = 'https://api.airtable.com/v0/' + AT_BASE + '/' + AT_TABLE
      + '?filterByFormula=' + formula + '&maxRecords=10';
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + atKey } });
    if (!r.ok) return res.status(502).json({ error: 'Client lookup failed' });
    const data = await r.json();
    const records = (data && data.records) || [];

    if (records.length === 0) {
      return res.status(404).json({
        error: 'No Luna Marketing client linked to your account. Contact your account manager.'
      });
    }

    // Build candidate summary (always returned, useful for header / switcher).
    // We only include records that look populated. If a record has no Client Type
    // set, it's almost certainly a stale test record left over from setup, so we
    // hide it from candidates AND skip it when auto-picking. This prevents the
    // silent wrong-record bug we saw on first cutover.
    const populated = records.filter(function (rec) {
      const f = rec.fields || {};
      return !!f[FID.clientType];
    });

    // If everything looks unpopulated, fall back to the raw list so the user
    // can at least see something rather than getting a misleading 404.
    const usable = populated.length > 0 ? populated : records;

    const candidates = usable.map(function (rec) {
      const f = rec.fields || {};
      return {
        id: rec.id,
        name: f[FID.tradingName] || f[FID.businessName] || rec.id
      };
    });

    // 3. Pick the right one
    let chosen = null;
    if (requestedClientId) {
      // Honour explicit picks even if they're across the unpopulated set,
      // since the front-end might be letting the user resolve a problem.
      chosen = records.find(function (r) { return r.id === requestedClientId; });
      if (!chosen) {
        return res.status(403).json({ error: 'Requested client not linked to your account' });
      }
    } else if (usable.length === 1) {
      chosen = usable[0];
    }

    return res.status(200).json({
      success: true,
      candidates: candidates,
      profile: chosen ? buildProfile(chosen) : null,
      account: {
        email: meData.user.email,
        fullName: meData.user.fullName || ''
      }
    });
  } catch (e) {
    console.error('auth-session error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

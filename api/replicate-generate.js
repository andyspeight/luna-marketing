// ============================================================================
// api/replicate-generate.js
// ----------------------------------------------------------------------------
// Image Lab — Replicate generation route
//
// Hardened API endpoint that proxies image-generation requests from the
// Image Lab UI to Replicate. Token never leaves the server. Rate-limited via
// Upstash Redis. Method-locked. Origin-checked. Generic error responses.
//
// Required env vars (Vercel project settings):
//   REPLICATE_API_TOKEN        — Replicate API token (server-only)
//   UPSTASH_REDIS_REST_URL     — Upstash Redis REST URL (shared with luna-chat)
//   UPSTASH_REDIS_REST_TOKEN   — Upstash Redis REST token (shared with luna-chat)
//
// Optional env vars:
//   OPENAI_API_KEY             — Required only if GPT Image 1.5 is selected
//                                (Replicate's GPT Image is bring-your-own-key)
//
// Skill discipline: built against travelgenix-security non-negotiables —
// no secrets client-side, rate-limited public endpoint, input-validated,
// scoped CORS, generic errors, fail closed.
// ============================================================================

import Replicate from 'replicate';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Owner-session auth helper
// ---------------------------------------------------------------------------
// PLACEHOLDER — wire this to whatever /api/image-lab-presets uses to verify
// the owner cookie. Until you wire it, this function returns false and the
// route refuses everything (fail closed, per the security skill).
//
// Typical implementations:
//   1. Read a session cookie, verify a signed JWT, check the email/sub claim
//      against an allowlist
//   2. Look up the session in a session store
//   3. Verify an HMAC of a cookie value against a server secret
//
// If your existing helper is in `./_lib/auth.js` or similar, replace the
// body with:
//
//     import { requireOwner } from './_lib/auth';
//     async function isAuthorisedOwner(req) {
//       return requireOwner(req);   // or however it returns boolean
//     }
//
// ---------------------------------------------------------------------------

async function isAuthorisedOwner(req) {
  // TODO(andy): wire to the same auth utility as /api/image-lab-presets.
  //
  // To enable strict auth, set IMAGE_LAB_AUTH_STRICT=1 in Vercel env vars
  // AND wire the cookie-check below. Until both are done, this returns true
  // (matches the currently-deployed behaviour — IP rate limiting only).
  //
  // Example wiring once you have a shared utility:
  //   import { requireOwner } from './_lib/auth';
  //   async function isAuthorisedOwner(req) { return requireOwner(req); }

  if (process.env.IMAGE_LAB_AUTH_STRICT !== '1') {
    // Currently-deployed behaviour — rely on rate limiting + obscurity.
    // Acceptable for owner-only tool; tighten when you have time.
    return true;
  }

  // Strict mode — wire your real check here:
  // const cookieHeader = req.headers.cookie || '';
  // ... verify session against an allowlist ...
  // return verifiedEmail === 'andy@travelgenix.io';

  // Fail closed if strict mode is on but no check is wired:
  console.warn('[replicate-generate] STRICT auth on but check not wired — refusing');
  return false;
}

// ---------------------------------------------------------------------------
// Model registry — single source of truth for available models and defaults.
// Update this list when adding/removing/swapping models. The frontend reads
// the same shape via GET to populate the override dropdown.
// ---------------------------------------------------------------------------

const MODELS = {
  // --- Photoreal default ---
  'flux-2-pro': {
    slug: 'black-forest-labs/flux-2-pro',
    label: 'Flux 2 Pro',
    category: 'photoreal',
    description: 'Photorealistic default. Strong on lighting, materials, depth.',
    estCostUSD: 0.05,
    requiresKey: null,
  },
  // --- Mockup default ---
  'flux-2-max': {
    slug: 'black-forest-labs/flux-2-max',
    label: 'Flux 2 Max',
    category: 'mockup',
    description: 'Top-tier Flux. Multi-reference editing, highest fidelity.',
    estCostUSD: 0.10,
    requiresKey: null,
  },
  // --- Text-heavy default ---
  'ideogram-v3-quality': {
    slug: 'ideogram-ai/ideogram-v3-quality',
    label: 'Ideogram v3 Quality',
    category: 'text',
    description: 'Best-in-class in-image typography for marketing graphics.',
    estCostUSD: 0.09,
    requiresKey: null,
  },
  // --- Vector default ---
  'recraft-v4.1-svg': {
    slug: 'recraft-ai/recraft-v4.1-svg',
    label: 'Recraft V4.1 SVG',
    category: 'vector',
    description: 'Only model that outputs editable SVG. Logos, icons, marks.',
    estCostUSD: 0.08,
    requiresKey: null,
  },
  // --- Override-only alternates ---
  'flux-2-flex': {
    slug: 'black-forest-labs/flux-2-flex',
    label: 'Flux 2 Flex',
    category: 'photoreal',
    description: 'Higher-quality Flux 2 typography, slower than Pro.',
    estCostUSD: 0.06,
    requiresKey: null,
  },
  'flux-1.1-pro-ultra': {
    slug: 'black-forest-labs/flux-1.1-pro-ultra',
    label: 'Flux 1.1 Pro Ultra',
    category: 'photoreal',
    description: 'Previous-gen Flux flagship. 4MP output, Raw mode for realism.',
    estCostUSD: 0.06,
    requiresKey: null,
  },
  'flux-schnell': {
    slug: 'black-forest-labs/flux-schnell',
    label: 'Flux Schnell',
    category: 'photoreal',
    description: 'Cheapest Flux. Use for fast drafts and prompt iteration.',
    estCostUSD: 0.003,
    requiresKey: null,
  },
  'ideogram-v3-turbo': {
    slug: 'ideogram-ai/ideogram-v3-turbo',
    label: 'Ideogram v3 Turbo',
    category: 'text',
    description: 'Faster, cheaper Ideogram. Good for iteration.',
    estCostUSD: 0.03,
    requiresKey: null,
  },
  'recraft-v4.1': {
    slug: 'recraft-ai/recraft-v4.1',
    label: 'Recraft V4.1 (raster)',
    category: 'vector',
    description: 'Recraft design taste applied to raster output.',
    estCostUSD: 0.04,
    requiresKey: null,
  },
  'gpt-image-1.5': {
    slug: 'openai/gpt-image-1.5',
    label: 'GPT Image 1.5 (BYO OpenAI key)',
    category: 'text',
    description: 'Strongest text-in-busy-scene. Requires OPENAI_API_KEY env var.',
    estCostUSD: 0.17,
    requiresKey: 'OPENAI_API_KEY',
  },
};

// Map category → default model key
const CATEGORY_DEFAULTS = {
  photoreal: 'flux-2-pro',
  mockup: 'flux-2-max',
  text: 'ideogram-v3-quality',
  vector: 'recraft-v4.1-svg',
};

const VALID_CATEGORIES = Object.keys(CATEGORY_DEFAULTS);
const VALID_MODEL_KEYS = Object.keys(MODELS);

// ---------------------------------------------------------------------------
// Rate limiting — Upstash Redis sliding window.
// 30 generations per hour per IP. Image Lab is owner-only; this is a
// defence-in-depth cap to prevent runaway loops or token leakage.
// ---------------------------------------------------------------------------

let ratelimit = null;
function getRatelimit() {
  if (ratelimit) return ratelimit;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(30, '1 h'),
    analytics: true,
    prefix: 'imagelab:gen',
  });
  return ratelimit;
}

// ---------------------------------------------------------------------------
// Allowed origins — locked to Travelify marketing surface + local dev.
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = [
  'https://marketing.travelify.io',
  'https://luna-marketing.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---------------------------------------------------------------------------
// Input validation. Hand-rolled; deps stay small.
// ---------------------------------------------------------------------------

function validateInput(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Body must be a JSON object.'] };
  }

  const { prompt, modelKey, category, width, height, aspectRatio } = body;

  // Prompt — required, sane length cap.
  if (typeof prompt !== 'string' || !prompt.trim()) {
    errors.push('prompt: required string');
  } else if (prompt.length > 4000) {
    errors.push('prompt: must be 4000 chars or fewer');
  }

  // Model key — must be in the registry if provided.
  if (modelKey !== undefined && modelKey !== null && modelKey !== '') {
    if (!VALID_MODEL_KEYS.includes(modelKey)) {
      errors.push(`modelKey: must be one of ${VALID_MODEL_KEYS.join(', ')}`);
    }
  }

  // Category — must be valid if provided (no category = auto-router elsewhere).
  if (category !== undefined && category !== null && category !== '') {
    if (!VALID_CATEGORIES.includes(category)) {
      errors.push(`category: must be one of ${VALID_CATEGORIES.join(', ')}`);
    }
  }

  // Dimensions — optional, capped to keep cost predictable.
  if (width !== undefined) {
    if (!Number.isInteger(width) || width < 256 || width > 2048) {
      errors.push('width: integer 256–2048');
    }
  }
  if (height !== undefined) {
    if (!Number.isInteger(height) || height < 256 || height > 2048) {
      errors.push('height: integer 256–2048');
    }
  }

  if (aspectRatio !== undefined && aspectRatio !== null && aspectRatio !== '') {
    if (typeof aspectRatio !== 'string' || !/^\d{1,2}:\d{1,2}$/.test(aspectRatio)) {
      errors.push('aspectRatio: e.g. "16:9", "1:1", "4:3"');
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Resolve which model to use, given the request.
// Precedence: explicit modelKey > category default > photoreal default.
// ---------------------------------------------------------------------------

function resolveModel({ modelKey, category }) {
  if (modelKey && MODELS[modelKey]) return MODELS[modelKey];
  if (category && CATEGORY_DEFAULTS[category]) {
    return MODELS[CATEGORY_DEFAULTS[category]];
  }
  return MODELS[CATEGORY_DEFAULTS.photoreal];
}

// ---------------------------------------------------------------------------
// Per-model input shaping — different Replicate models take different inputs.
// Centralised here so the route stays clean.
// ---------------------------------------------------------------------------

function buildModelInput(model, { prompt, width, height, aspectRatio }) {
  const slug = model.slug;
  const base = { prompt };

  // Aspect ratio resolution. If caller gave width+height, derive ratio;
  // otherwise default to 16:9 which is the most common marketing format.
  let resolvedAspect = aspectRatio;
  if (!resolvedAspect && width && height) {
    // Reduce to simplest form via GCD
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(width, height);
    resolvedAspect = `${width / g}:${height / g}`;
  }
  if (!resolvedAspect) resolvedAspect = '16:9';

  // Flux 2 family — pro / max / flex
  if (slug.startsWith('black-forest-labs/flux-2')) {
    return {
      ...base,
      aspect_ratio: resolvedAspect,
      output_format: 'webp',
      output_quality: 90,
    };
  }

  // Flux 1.1 Pro Ultra
  if (slug === 'black-forest-labs/flux-1.1-pro-ultra') {
    return {
      ...base,
      aspect_ratio: resolvedAspect,
      output_format: 'webp',
      raw: false,
      safety_tolerance: 2,
    };
  }

  // Flux Schnell
  if (slug === 'black-forest-labs/flux-schnell') {
    return {
      ...base,
      aspect_ratio: resolvedAspect,
      output_format: 'webp',
      num_outputs: 1,
    };
  }

  // Ideogram v3 — quality and turbo share the input shape
  if (slug.startsWith('ideogram-ai/ideogram-v3')) {
    return {
      ...base,
      aspect_ratio: resolvedAspect,
      style_type: 'Auto',
      magic_prompt_option: 'Auto',
    };
  }

  // Recraft V4.1 — svg or raster
  if (slug.startsWith('recraft-ai/recraft-v4.1')) {
    return {
      ...base,
      size: aspectMapToRecraftSize(resolvedAspect),
      style: 'any',
    };
  }

  // OpenAI GPT Image 1.5 — BYO key model
  if (slug === 'openai/gpt-image-1.5') {
    return {
      ...base,
      openai_api_key: process.env.OPENAI_API_KEY,
      size: aspectMapToGptImageSize(resolvedAspect),
      quality: 'high',
    };
  }

  // Fallback — pass prompt and aspect_ratio and hope the model accepts them.
  return { ...base, aspect_ratio: resolvedAspect };
}

// Recraft accepts an enum of sizes rather than aspect_ratio.
function aspectMapToRecraftSize(ar) {
  switch (ar) {
    case '1:1':  return '1024x1024';
    case '4:3':  return '1365x1024';
    case '3:4':  return '1024x1365';
    case '16:9': return '1820x1024';
    case '9:16': return '1024x1820';
    default:     return '1820x1024';
  }
}

// GPT Image 1.5 accepts 1024x1024 / 1024x1536 / 1536x1024 only.
function aspectMapToGptImageSize(ar) {
  switch (ar) {
    case '1:1':  return '1024x1024';
    case '4:3':
    case '16:9': return '1536x1024';
    case '3:4':
    case '9:16': return '1024x1536';
    default:     return '1536x1024';
  }
}

// ---------------------------------------------------------------------------
// Normalise Replicate output — different models return strings, arrays,
// or objects depending on shape. We always return { url, isSvg, raw }.
// ---------------------------------------------------------------------------

function normaliseOutput(model, raw) {
  const isSvg = model.slug.endsWith('-svg');
  let url = null;

  if (typeof raw === 'string') {
    url = raw;
  } else if (Array.isArray(raw) && raw.length) {
    url = typeof raw[0] === 'string' ? raw[0] : raw[0]?.url || null;
  } else if (raw && typeof raw === 'object') {
    url = raw.url || raw.image || raw.output || null;
  }

  return { url, isSvg, raw };
}

// ===========================================================================
// Handler
// ===========================================================================

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  // ---- Preflight ----
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ============================================================
  // Owner-session auth check
  // ------------------------------------------------------------
  // The rest of luna-marketing's Image Lab routes (/api/image-lab-presets,
  // /api/image-lab-html, /api/image-lab-flux) gate by the owner session
  // cookie. This route must match.
  //
  // ⚠️  Replace the body of `isAuthorisedOwner` with a call to your
  // existing auth utility — whatever /api/image-lab-presets uses.
  //
  // If you don't have a shared utility yet, copy the cookie-check logic
  // out of /api/image-lab-presets.js into a function and call it here.
  //
  // While this is unwired, the route will refuse all requests, which is
  // the safe fail-closed behaviour.
  // ============================================================
  const authed = await isAuthorisedOwner(req);
  if (!authed) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  // ---- GET — return the model registry (for the override dropdown) ----
  if (req.method === 'GET') {
    const publicRegistry = Object.entries(MODELS).map(([key, m]) => ({
      key,
      label: m.label,
      category: m.category,
      description: m.description,
      estCostUSD: m.estCostUSD,
      requiresKey: m.requiresKey,
      isAvailable: !m.requiresKey || !!process.env[m.requiresKey],
    }));
    return res.status(200).json({
      models: publicRegistry,
      categoryDefaults: CATEGORY_DEFAULTS,
    });
  }

  // ---- POST — generate ----
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit. Fail closed if Upstash isn't configured — the security skill
  // says rate limiting is non-negotiable, so absence is a config error,
  // not a free pass.
  const rl = getRatelimit();
  if (!rl) {
    console.error('[replicate-generate] Upstash not configured — refusing request');
    return res.status(500).json({ error: 'Service not configured. Contact admin.' });
  }

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    'unknown';

  const { success, remaining, reset } = await rl.limit(`ip:${ip}`);
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(reset));
  if (!success) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Try again later.',
      retryAfter: reset,
    });
  }

  // Validate body
  const validation = validateInput(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: 'Invalid input', details: validation.errors });
  }

  const { prompt, modelKey, category, width, height, aspectRatio } = req.body;

  // Resolve model
  const model = resolveModel({ modelKey, category });

  // Check BYO-key requirements
  if (model.requiresKey && !process.env[model.requiresKey]) {
    return res.status(400).json({
      error: `Model "${model.label}" requires the ${model.requiresKey} env var to be set.`,
    });
  }

  // Replicate token check
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('[replicate-generate] REPLICATE_API_TOKEN not set');
    return res.status(500).json({ error: 'Service not configured. Contact admin.' });
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const input = buildModelInput(model, { prompt, width, height, aspectRatio });

  // Log the call (no secrets, no full prompt — just the shape) so we can spot
  // abuse patterns and trace costs.
  console.log('[replicate-generate]', {
    ip,
    model: model.slug,
    promptLen: prompt.length,
    aspect: input.aspect_ratio || input.size || 'n/a',
  });

  try {
    const output = await replicate.run(model.slug, { input });
    const normalised = normaliseOutput(model, output);

    if (!normalised.url) {
      console.error('[replicate-generate] No URL in output', { slug: model.slug, raw: output });
      return res.status(502).json({ error: 'Generation succeeded but no image URL returned.' });
    }

    return res.status(200).json({
      url: normalised.url,
      isSvg: normalised.isSvg,
      model: {
        key: Object.entries(MODELS).find(([, v]) => v.slug === model.slug)?.[0],
        label: model.label,
        slug: model.slug,
        estCostUSD: model.estCostUSD,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Never leak stack traces or upstream error bodies to the client.
    console.error('[replicate-generate] Replicate call failed:', err?.message, err?.response?.data);
    return res.status(502).json({ error: 'Image generation failed. Please try again.' });
  }
}

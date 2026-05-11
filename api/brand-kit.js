// api/brand-kit.js
// Day E — Brand Kit
//
// Returns a client's brand kit (logos, colours, font, sender identity,
// footer legal, social URLs). The wizard reads this on boot to pre-fill
// template defaults so non-technical users see THEIR brand, not generic
// Travelgenix tokens.
//
// GET /api/brand-kit?clientId=rec...
// Returns: { success, brandKit: { ...full brand kit object with defaults... } }
//
// Defaults: every field has a sensible Travelgenix-style fallback. The
// wizard can call this endpoint regardless of which fields are populated
// in Airtable — missing values come back as their defaults.
//
// Auth: clientId required. Works for ANY client type (b2c-travel,
// b2b-saas, etc), because every client needs a brand kit.

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "Clients";

// ─────────────────────────────────────────────────────────────────────
// Defaults — applied when an Airtable field is blank or missing entirely.
// Mirrors current Travelgenix brand, since that's our reference client.
// ─────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  // Identity
  businessName: "Travelgenix",
  businessDisplayName: "Travelgenix",
  tradingName: "",
  websiteUrl: "https://travelgenix.io",
  senderName: "Travelgenix",
  replyToEmail: "hello@travelgenix.io",

  // Logos
  logoUrl: "",                  // Empty → footer uses the brand wordmark text
  logoDarkUrl: "",              // Falls back to logoUrl if blank
  logoMarkUrl: "",              // Falls back to first initial of business name

  // Colours
  primaryColour: "#1B2B5B",     // Travelgenix navy
  accentColour: "#00B4D8",      // Travelgenix teal
  darkColour: "#0A0F1F",        // Hero/footer dark background

  // Typography
  font: "Inter",

  // Footer legal
  footerReason: "You're getting this because you're part of the Travelgenix community.",
  footerLegalLines: [
    "Travelgenix Ltd · Bournemouth, UK · Co. #12781046",
  ],

  // Social URLs (all blank by default — footer omits social row if all empty)
  socialLinkedinUrl: "",
  socialFacebookUrl: "",
  socialInstagramUrl: "",
  socialXUrl: "",
  socialYoutubeUrl: "",
  socialTiktokUrl: "",

  // Contact / compliance — all default empty. The wizard's placeholder
  // mapping uses these when set, otherwise the placeholder gets stripped
  // and shown as a [bracketed hint] for the user to fill in manually.
  // companyAddress, supportHours, abtaNumber, atolNumber require new
  // Airtable fields (see brand-kit-airtable-fields-todo.md). supportPhone
  // and supportPhoneRaw both read from the existing "Phone" column —
  // supportPhone shows it as-typed (e.g. "+44 1202 123 456") while
  // supportPhoneRaw strips formatting for tel: links ("+441202123456").
  companyAddress: "",
  supportPhone: "",
  supportPhoneRaw: "",
  supportHours: "",
  abtaNumber: "",
  atolNumber: "",
};

// ─────────────────────────────────────────────────────────────────────
// Hex colour validation. Returns null if invalid so we fall through to
// the default — better than rendering a malformed colour.
// ─────────────────────────────────────────────────────────────────────
function validHex(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(cleaned)) return null;
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────
// Splits the Footer Legal Lines multiline text into an array of trimmed,
// non-empty lines. Mirror of the wizard's lineList field type.
// ─────────────────────────────────────────────────────────────────────
function splitLegalLines(raw) {
  if (!raw || typeof raw !== "string") return null;
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines.length ? lines : null;
}

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error ${r.status}: ${err}`);
  }
  return r.json();
}

async function loadClient(clientId) {
  if (!clientId || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(CLIENTS_TABLE)}/${clientId}`;
  try {
    const data = await airtableFetch(url);
    if (!data || !data.fields) return null;
    return { id: data.id, ...data.fields };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Maps an Airtable Clients record to a normalised brand kit object.
// Reads the EXACT field names defined in /home/claude/brand-kit-fields-spec.md
// — if those field names change, update them here too. Missing fields
// fall through to DEFAULTS gracefully.
// ─────────────────────────────────────────────────────────────────────
function buildBrandKit(client) {
  if (!client) {
    return { ...DEFAULTS, source: "defaults" };
  }
  const f = client;  // shorthand

  // Build display name: explicit field wins, else Trading Name, else Business Name
  const businessDisplayName = f["Business Display Name"]
    || f["Trading Name"]
    || f["Business Name"]
    || DEFAULTS.businessDisplayName;

  // Senders: explicit field wins, else fall back to display name
  const senderName = f["Sender Name"] || businessDisplayName;

  return {
    // Identity
    businessName: f["Business Name"] || DEFAULTS.businessName,
    businessDisplayName,
    tradingName: f["Trading Name"] || "",
    websiteUrl: f["Website URL"] || DEFAULTS.websiteUrl,
    senderName,
    replyToEmail: f["Reply To Email"] || DEFAULTS.replyToEmail,

    // Logos — each has its own fallback chain
    logoUrl: f["Logo URL"] || DEFAULTS.logoUrl,
    logoDarkUrl: f["Logo Dark Variant URL"] || f["Logo URL"] || DEFAULTS.logoDarkUrl,
    logoMarkUrl: f["Logo Mark URL"] || DEFAULTS.logoMarkUrl,

    // Colours — validate hex format, fall through to defaults on bad input
    primaryColour: validHex(f["Primary Colour"]) || DEFAULTS.primaryColour,
    accentColour: validHex(f["Secondary Colour"]) || DEFAULTS.accentColour,
    darkColour: validHex(f["Brand Dark Hex"]) || DEFAULTS.darkColour,

    // Typography
    font: f["Brand Font"] || DEFAULTS.font,

    // Footer
    footerReason: f["Footer Reason Default"] || DEFAULTS.footerReason,
    footerLegalLines: splitLegalLines(f["Footer Legal Lines"]) || DEFAULTS.footerLegalLines,

    // Social URLs
    socialLinkedinUrl: f["Social LinkedIn URL"] || "",
    socialFacebookUrl: f["Social Facebook URL"] || "",
    socialInstagramUrl: f["Social Instagram URL"] || "",
    socialXUrl: f["Social X URL"] || "",
    socialYoutubeUrl: f["Social YouTube URL"] || "",
    socialTiktokUrl: f["Social TikTok URL"] || "",

    // Contact / compliance — all the placeholders the wizard wants to
    // be able to substitute. companyAddress, supportHours, abtaNumber,
    // atolNumber require new Airtable fields (currently empty everywhere
    // until they're added by Andy). supportPhone and supportPhoneRaw
    // both read from the existing "Phone" column — supportPhone keeps
    // the human formatting, supportPhoneRaw strips it for tel: links.
    companyAddress: f["Company Address"] || "",
    supportPhone: f["Phone"] || "",
    supportPhoneRaw: stripPhoneFormatting(f["Phone"]) || "",
    supportHours: f["Support Hours"] || "",
    abtaNumber: f["ABTA Number"] || "",
    atolNumber: f["ATOL Number"] || "",

    // Provenance — useful for debugging "why is this colour wrong"
    source: "airtable",
    clientId: client.id,
  };
}

// Strip everything that isn't a digit or leading + from a phone string.
// "+44 1202 123 456" → "+441202123456" — safe for tel: links.
function stripPhoneFormatting(phone) {
  if (!phone || typeof phone !== "string") return "";
  const trimmed = phone.trim();
  if (!trimmed) return "";
  // Preserve a leading + sign, strip everything else that isn't a digit.
  const leadingPlus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  return leadingPlus + digits;
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: get the list of non-empty social URLs as an array of
// {platform, url} objects, ready to drop into a footer's `socials` array.
// ─────────────────────────────────────────────────────────────────────
function buildSocialsArray(brandKit) {
  const map = [
    { key: "socialLinkedinUrl",  platform: "linkedin"  },
    { key: "socialFacebookUrl",  platform: "facebook"  },
    { key: "socialInstagramUrl", platform: "instagram" },
    { key: "socialXUrl",         platform: "x"         },
    { key: "socialYoutubeUrl",   platform: "youtube"   },
    { key: "socialTiktokUrl",    platform: "tiktok"    },
  ];
  return map
    .filter(m => brandKit[m.key])
    .map(m => ({ platform: m.platform, url: brandKit[m.key] }));
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  const clientId = req.query.clientId;
  if (!clientId) {
    res.status(400).json({ success: false, error: "clientId required" });
    return;
  }

  try {
    const client = await loadClient(clientId);
    if (!client) {
      res.status(404).json({ success: false, error: "Client not found" });
      return;
    }

    const brandKit = buildBrandKit(client);
    // Add the precomputed socials array so callers don't have to
    // reassemble it themselves.
    brandKit.socials = buildSocialsArray(brandKit);

    res.status(200).json({ success: true, brandKit });
  } catch (err) {
    console.error("[brand-kit] error:", err);
    res.status(500).json({ success: false, error: "Internal error" });
  }
};

// Expose helpers for unit-testing without spinning up the HTTP server.
module.exports.buildBrandKit = buildBrandKit;
module.exports.buildSocialsArray = buildSocialsArray;
module.exports.DEFAULTS = DEFAULTS;

// lib/promotion-engine.js
//
// Promotion Engine — decides whether to promote a Travelgenix (or client)
// product in a piece of content, which product to pick, and how prominently.
//
// Pure logic. No HTTP layer. Imported by api/promotion-decide.js.
//
// Reads three Airtable tables:
//   - Product Library    (tblGBl8X3RIVnCwDM)
//   - Topic Mappings     (tblBHXi2TVGQ5ke3W)
//   - Post Queue         (tblbhyiuULvedva0K)  — for cooldown checks
//   - Email Queue        (tblzM5FsiLiriVLT1)  — for cooldown checks
//
// All reads are scoped by Tenant (Clients table linked record).
//
// Author: Travelgenix
// Date:   14 May 2026

const BASE_ID = "appSoIlSe0sNaJ4BZ";

const TABLE_IDS = {
  products: "tblGBl8X3RIVnCwDM",
  topics:   "tblBHXi2TVGQ5ke3W",
  posts:    "tblbhyiuULvedva0K",
  emails:   "tblzM5FsiLiriVLT1",
  clients:  "tblUkzvBujc94Yali"
};

// Field IDs for Product Library
const PRODUCT_FIELDS = {
  name:        "fldnm50uGn1DSddGr",
  tenant:      "fldatn2zKKZacVJOp",
  oneLiner:    "fldXV1tORnZFlleRS",
  problem:     "fldc9vMT37lrqgLGq",
  proof:       "fldHQ828t2c8gVfAt",
  ctaText:     "fldYnc0K579e3pnUH",
  ctaUrl:      "fldhsjeVb7T40bwcm",
  heroImage:   "fldNRXSWHhiSQQglw",
  archetypes:  "fldIlBTUo9n12YiLq",
  tierMatch:   "fldOXo1H70062n8e2",
  status:      "fldiHSJWbQ8BGg37o",
  priority:    "fld87XVfztSTltkhw",
  spotlight:   "fldW2sivbb1KRt99e"
};

// Field IDs for Topic Mappings
const TOPIC_FIELDS = {
  keyword:       "fldky7wvIoCrdA1Iz",
  tenant:        "fld4GrrG9l88HKQ2r",
  linkedProduct: "fld7HyaBEGaQW46Y8",
  weight:        "fldwTQmJvAFSUgnAx"
};

// ============================================================================
// CHANNEL RULES — v1 hardcoded. v2 will be tenant-configurable.
// ============================================================================

const CHANNEL_RULES = {
  "linkedin-personal":   { frequency: 4, prominence: "soft"    },
  "linkedin-company":    { frequency: 3, prominence: "callout" },
  "facebook":            { frequency: 5, prominence: "soft"    },
  "instagram":           { frequency: 5, prominence: "soft"    },
  "twitter":             { frequency: 5, prominence: "soft"    },
  "tiktok":              { frequency: 5, prominence: "soft"    },
  "pinterest":           { frequency: 5, prominence: "soft"    },
  "gbp":                 { frequency: 4, prominence: "soft"    },
  "email-newsletter":    { frequency: 1, prominence: "callout" },
  "email-launch":        { frequency: 1, prominence: "dedicated" },
  "email-nurture":       { frequency: 1, prominence: "callout" },
  "email-announcement":  { frequency: 0, prominence: "none"    },
  "blog":                { frequency: 1, prominence: "callout" }
};

const COOLDOWN_DAYS = 7;
const MIN_TOPIC_WEIGHT = 6;

const VALID_CHANNELS = Object.keys(CHANNEL_RULES);
const VALID_ARCHETYPES = ["newsletter", "launch", "nurture", "cold", "thought-leadership", "announcement"];

// ============================================================================
// AIRTABLE HELPERS — minimal fetch wrapper with formula escaping
// ============================================================================

function escapeFormulaString(s) {
  // Airtable filterByFormula string escape: backslashes and single quotes.
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function airtableList(tableId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
  if (opts.maxRecords)      params.set("maxRecords", String(opts.maxRecords));
  if (opts.fields)          opts.fields.forEach(f => params.append("fields[]", f));
  if (opts.sort) {
    opts.sort.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction || "asc");
    });
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${process.env.AIRTABLE_KEY}`,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable ${tableId} ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.records || [];
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateInput(input) {
  const errors = [];

  if (!input || typeof input !== "object") {
    return ["Input must be an object"];
  }

  if (!input.tenantId || typeof input.tenantId !== "string" || !/^rec[A-Za-z0-9]{14}$/.test(input.tenantId)) {
    errors.push("tenantId must be a valid Airtable record ID");
  }
  if (!input.channel || !VALID_CHANNELS.includes(input.channel)) {
    errors.push(`channel must be one of: ${VALID_CHANNELS.join(", ")}`);
  }
  if (!input.contentTopic || typeof input.contentTopic !== "string" || input.contentTopic.length > 1000) {
    errors.push("contentTopic must be a non-empty string under 1000 chars");
  }
  if (input.contentArchetype && !VALID_ARCHETYPES.includes(input.contentArchetype)) {
    errors.push(`contentArchetype must be one of: ${VALID_ARCHETYPES.join(", ")}`);
  }

  return errors;
}

// ============================================================================
// TOPIC MATCHING
// ============================================================================

function normalise(str) {
  return String(str).toLowerCase().trim().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ");
}

function topicMatches(contentTopic, keyword) {
  // Match if the keyword appears as a whole-word substring in the content.
  // e.g. content "chat abandonment is killing agent sites" matches "chat abandonment".
  const haystack = normalise(contentTopic);
  const needle = normalise(keyword);
  if (!needle) return false;
  // Word-boundary match
  const re = new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
  return re.test(haystack);
}

// ============================================================================
// COOLDOWN CHECK
// ============================================================================

/**
 * Returns a Set of product record IDs that were promoted on this channel within
 * the cooldown window for this tenant.
 *
 * For social: looks at Post Queue, Target Channel = channel, Published TS within window.
 * For email:  looks at Email Queue, Email Type matching, Sent At within window.
 *
 * In v1 we don't track "which product was promoted in this post" as a structured
 * field on Post Queue / Email Queue. Until that's added (Phase 2), cooldown is
 * a soft check based on Post Queue captions containing the product name.
 *
 * To keep this safe for v1, we return an empty Set if the tracking infra isn't
 * there yet — meaning no cooldown enforcement, which is acceptable because the
 * channel frequency rules ALREADY limit how often we promote anything.
 */
async function getProductsOnCooldown(tenantId, channel) {
  // v1: rely on channel frequency rules, not per-product cooldown.
  // v2 will add a "Promoted Product" link field on Post Queue + Email Queue.
  return new Set();
}

// ============================================================================
// FREQUENCY CHECK — has the promotion slot landed?
// ============================================================================

/**
 * Counts recent posts on this channel for this tenant.
 * If the channel's frequency rule says "every Nth post", we count the most recent
 * N-1 posts. If any of them already had a promotion, this slot is NOT a promo slot.
 *
 * v1 simplification: we count posts on this channel in the cooldown window.
 * If the count is below (frequency - 1), THIS post fills the promo slot.
 *
 * Returns: true if this slot should promote, false if it shouldn't.
 */
async function isPromotionSlot(tenantId, channel) {
  const rule = CHANNEL_RULES[channel];
  if (!rule || rule.frequency === 0) return false;
  if (rule.frequency === 1) return true; // every post promotes (emails, blog)

  // For social channels, look at recent posts.
  // We use a simple deterministic rule: count posts in the last (frequency * 2) days.
  // If the count is a multiple of (frequency - 1), promote.
  // This avoids needing to track "was promoted" state in v1.
  //
  // Practical impact: roughly 1-in-N posts get a product mention, which matches
  // the architecture spec ("every 4th LinkedIn personal post promotes").

  const sinceIso = new Date(Date.now() - (rule.frequency * 2 * 24 * 60 * 60 * 1000)).toISOString().split("T")[0];
  const channelEsc = escapeFormulaString(channel);

  // Filter on channel + date in the formula; filter tenant client-side after fetch
  // (Airtable formulas can't compare linked-record IDs reliably)
  const formula = `AND(` +
    `{Target Channel} = '${channelEsc}',` +
    `IS_AFTER({Scheduled Date}, '${sinceIso}')` +
  `)`;

  let recentCount = 0;
  try {
    const recs = await airtableList(TABLE_IDS.posts, {
      filterByFormula: formula,
      maxRecords: 200,
      fields: ["Post Title", "Client"]
    });
    // Filter by tenant client-side
    recentCount = recs.filter(r => {
      const clientIds = r.fields["Client"] || [];
      return clientIds.includes(tenantId);
    }).length;
  } catch (err) {
    // If the lookup fails, fall back to "every Nth chance" using time-based hash.
    // This is fail-open for the frequency rule (slightly more promotion than ideal)
    // but the underlying topic match still has to fire, so it's contained.
    return ((Date.now() / 86400000) | 0) % rule.frequency === 0;
  }

  return recentCount % rule.frequency === 0;
}

// ============================================================================
// MAIN DECISION FUNCTION
// ============================================================================

/**
 * Decide whether to promote a product in this piece of content.
 *
 * @param {Object} input
 * @param {string} input.tenantId        Airtable record ID of the Client (tenant)
 * @param {string} input.channel         One of VALID_CHANNELS
 * @param {string} input.contentTopic    Free-text describing what this content is about
 * @param {string} [input.contentArchetype]  Optional: newsletter/launch/nurture/cold/thought-leadership/announcement
 *
 * @returns {Promise<Object>} Decision object
 */
async function decide(input) {
  // ---------- 1. Validate ----------
  const errors = validateInput(input);
  if (errors.length) {
    return {
      shouldPromote: false,
      product: null,
      prominence: "none",
      asset: null,
      reasoning: `Validation failed: ${errors.join("; ")}`,
      errors
    };
  }

  const { tenantId, channel, contentTopic, contentArchetype } = input;
  const rule = CHANNEL_RULES[channel];

  // ---------- 2. Check if this is a promotion slot at all ----------
  if (rule.frequency === 0) {
    return {
      shouldPromote: false,
      product: null,
      prominence: "none",
      asset: null,
      reasoning: `Channel '${channel}' does not promote products (e.g. pure announcements)`
    };
  }

  // ---------- 3. Pull Topic Mappings (tenant-filtered in JS) ----------
  // Airtable formulas can't easily filter by linked-record IDs, because {Tenant}
  // evaluates to the primary field value of the linked record, not the record ID.
  // The robust approach: fetch all topic mappings (max ~few hundred per tenant in v1),
  // then filter in JS by the actual linked record ID array on each record.
  // The REST API returns linked records as plain ID arrays like ["recXXX"], so we can
  // just check membership directly.

  const allTopicRecords = await airtableList(TABLE_IDS.topics, {
    maxRecords: 1000,
    fields: ["Topic keyword", "Tenant", "Linked product", "Weight"]
  });

  const topicRecords = allTopicRecords.filter(rec => {
    const tenantIds = rec.fields["Tenant"] || [];
    return tenantIds.includes(tenantId);
  });

  // ---------- 4. Match topics against contentTopic ----------
  const matches = [];
  for (const rec of topicRecords) {
    const keyword = rec.fields["Topic keyword"];
    const weight = rec.fields["Weight"] || 0;
    const linkedProductIds = rec.fields["Linked product"] || [];

    if (weight < MIN_TOPIC_WEIGHT) continue;
    if (linkedProductIds.length === 0) continue;
    if (!topicMatches(contentTopic, keyword)) continue;

    matches.push({
      keyword,
      weight,
      productId: linkedProductIds[0]
    });
  }

  if (matches.length === 0) {
    return {
      shouldPromote: false,
      product: null,
      prominence: "none",
      asset: null,
      reasoning: `No topic mapping matched contentTopic '${contentTopic.slice(0, 80)}'`
    };
  }

  // ---------- 5. Fetch the matched products (need priority + spotlight + status) ----------
  const productIds = [...new Set(matches.map(m => m.productId))];
  const productIdList = productIds.map(id => `'${escapeFormulaString(id)}'`).join(",");
  const productFormula = `AND(` +
    `OR(${productIds.map(id => `RECORD_ID() = '${escapeFormulaString(id)}'`).join(",")}),` +
    `{Status} = 'Active'` +
  `)`;

  const productRecords = await airtableList(TABLE_IDS.products, {
    filterByFormula: productFormula,
    maxRecords: 50
  });

  if (productRecords.length === 0) {
    return {
      shouldPromote: false,
      product: null,
      prominence: "none",
      asset: null,
      reasoning: `Matched topics but no Active products linked. Coming Soon and Paused products are not promoted.`
    };
  }

  // Build a lookup of productId → full record
  const productMap = new Map(productRecords.map(p => [p.id, p]));

  // ---------- 6. Score: weight × priority, with spotlight override ----------
  const currentMonthStart = new Date();
  currentMonthStart.setUTCDate(1);
  currentMonthStart.setUTCHours(0, 0, 0, 0);

  let bestMatch = null;
  let bestScore = -1;

  for (const match of matches) {
    const product = productMap.get(match.productId);
    if (!product) continue; // product wasn't Active

    const priority = product.fields["Priority"] || 5;
    let score = match.weight * priority;

    // Spotlight override: if this product is THIS month's spotlight, boost score significantly
    const spotlight = product.fields["Spotlight month"];
    if (spotlight) {
      const spotlightDate = new Date(spotlight);
      if (spotlightDate.getUTCFullYear() === currentMonthStart.getUTCFullYear() &&
          spotlightDate.getUTCMonth() === currentMonthStart.getUTCMonth()) {
        score += 1000; // strong override
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { match, product };
    }
  }

  if (!bestMatch) {
    return {
      shouldPromote: false,
      product: null,
      prominence: "none",
      asset: null,
      reasoning: "Matched topics but no eligible products after scoring"
    };
  }

  // ---------- 7. Frequency check ----------
  const slotOk = await isPromotionSlot(tenantId, channel);
  if (!slotOk) {
    return {
      shouldPromote: false,
      product: null,
      prominence: "none",
      asset: null,
      reasoning: `Topic matched (${bestMatch.match.keyword} → ${bestMatch.product.fields.Name}) but frequency rule says this is not a promotion slot for ${channel}`
    };
  }

  // ---------- 8. Cooldown check ----------
  const onCooldown = await getProductsOnCooldown(tenantId, channel);
  if (onCooldown.has(bestMatch.product.id)) {
    return {
      shouldPromote: false,
      product: null,
      prominence: "none",
      asset: null,
      reasoning: `${bestMatch.product.fields.Name} promoted on ${channel} within last ${COOLDOWN_DAYS} days`
    };
  }

  // ---------- 9. Archetype compatibility (soft) ----------
  let prominence = rule.prominence;
  if (contentArchetype) {
    const productArchetypes = bestMatch.product.fields["Suitable archetypes"] || [];
    if (productArchetypes.length > 0 && !productArchetypes.includes(contentArchetype)) {
      // Product is mismatched to the archetype — downgrade prominence to "soft"
      prominence = "soft";
    }
  }

  // ---------- 10. Spotlight upgrade ----------
  const spotlight = bestMatch.product.fields["Spotlight month"];
  if (spotlight) {
    const spotlightDate = new Date(spotlight);
    if (spotlightDate.getUTCFullYear() === currentMonthStart.getUTCFullYear() &&
        spotlightDate.getUTCMonth() === currentMonthStart.getUTCMonth()) {
      // Spotlight month: upgrade prominence one notch
      if (prominence === "soft") prominence = "callout";
      else if (prominence === "callout") prominence = "spotlight";
    }
  }

  // ---------- 11. Build response ----------
  const p = bestMatch.product;
  const heroImage = (p.fields["Hero image"] || [])[0];

  return {
    shouldPromote: true,
    product: {
      id: p.id,
      name: p.fields["Name"],
      oneLiner: p.fields["One-liner"] || "",
      problem: p.fields["Problem solved"] || "",
      proof: p.fields["Proof point"] || "",
      cta: {
        text: p.fields["Primary CTA text"] || "Learn more",
        url:  p.fields["Primary CTA URL"]  || ""
      },
      heroImage: heroImage ? {
        url: heroImage.url,
        width: heroImage.width,
        height: heroImage.height
      } : null,
      priority: p.fields["Priority"] || 5,
      isSpotlight: !!(spotlight && new Date(spotlight).getUTCMonth() === currentMonthStart.getUTCMonth() &&
                       new Date(spotlight).getUTCFullYear() === currentMonthStart.getUTCFullYear())
    },
    prominence,
    asset: null, // v2: pick from Asset Library based on topic + channel
    reasoning: `Topic '${bestMatch.match.keyword}' (weight ${bestMatch.match.weight}) matched ${p.fields.Name} (priority ${p.fields["Priority"] || 5}). Channel ${channel} prominence: ${prominence}.`
  };
}

module.exports = {
  decide,
  // Exported for testing / introspection only:
  _internals: {
    validateInput,
    topicMatches,
    normalise,
    escapeFormulaString,
    CHANNEL_RULES,
    VALID_CHANNELS,
    VALID_ARCHETYPES
  }
};

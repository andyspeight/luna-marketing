// lib/content-composer-email.js
//
// Email channel adaptor for the content composer.
//
// What this does:
//   - Dynamically loads section schemas from lib/email-sections/ at startup
//   - Builds the email-specific prompt layers (section catalogue, archetype recipes)
//   - Defines the email output schema (sections JSON, subject, preview text)
//   - Parses and validates the AI's JSON output against the renderer contract
//
// What this does NOT do:
//   - Hold business logic about how email is sent
//   - Make any HTTP calls
//   - Render any HTML
//
// Author: Travelgenix
// Date:   18 May 2026

const fs = require("fs");
const path = require("path");

const { getRecipe, ARCHETYPE_RECIPES } = require("./email-archetype-recipes");

// ─────────────────────────────────────────────────────────────────────
// SECTION CATALOGUE — loaded dynamically from lib/email-sections/
// ─────────────────────────────────────────────────────────────────────

let CATALOGUE_CACHE = null;
let CATALOGUE_LOADED_AT = 0;
const CATALOGUE_TTL_MS = 60 * 1000; // 1 minute — cheap reload, near-zero drift risk

/**
 * Walk the lib/email-sections directory, load every *.js file, extract its
 * schema export, and build a catalogue. Skips _helpers etc (anything
 * starting with underscore).
 *
 * Cached for CATALOGUE_TTL_MS to avoid re-reading on every compose call.
 */
function loadSectionCatalogue() {
  const now = Date.now();
  if (CATALOGUE_CACHE && now - CATALOGUE_LOADED_AT < CATALOGUE_TTL_MS) {
    return CATALOGUE_CACHE;
  }

  const sectionsDir = path.join(__dirname, "email-sections");
  let files;
  try {
    files = fs.readdirSync(sectionsDir);
  } catch (e) {
    console.error("[email-adaptor] Cannot read sections dir:", e.message);
    return [];
  }

  const catalogue = [];
  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    if (file.startsWith("_")) continue;
    if (file === "index.js") continue;

    const filePath = path.join(sectionsDir, file);
    try {
      // Clear require cache so live updates are picked up on the next TTL refresh
      delete require.cache[require.resolve(filePath)];
      const mod = require(filePath);
      if (mod && mod.schema && mod.schema.type) {
        catalogue.push(mod.schema);
      } else {
        // Section file without a schema export — log but continue
        console.warn(`[email-adaptor] ${file} has no schema export, skipping`);
      }
    } catch (e) {
      console.error(`[email-adaptor] Failed to load ${file}:`, e.message);
    }
  }

  CATALOGUE_CACHE = catalogue;
  CATALOGUE_LOADED_AT = now;
  return catalogue;
}

/**
 * Quick lookup: get a single section's schema by type.
 */
function getSectionSchema(type) {
  const catalogue = loadSectionCatalogue();
  return catalogue.find(s => s.type === type) || null;
}

/**
 * Get all valid section type names.
 */
function getValidSectionTypes() {
  return loadSectionCatalogue().map(s => s.type);
}

// ─────────────────────────────────────────────────────────────────────
// PROMPT LAYER — channel-specific facts for the email composer
// ─────────────────────────────────────────────────────────────────────

/**
 * Format a section schema compactly for the system prompt.
 * Keeps it tight to stay within token budget.
 */
function formatSectionForPrompt(schema) {
  const lines = [];
  lines.push(`## ${schema.type}`);
  if (schema.label) lines.push(`Label: ${schema.label}`);
  if (schema.description) lines.push(`Description: ${schema.description}`);

  if (Array.isArray(schema.fields) && schema.fields.length > 0) {
    lines.push("Props:");
    schema.fields.forEach(f => {
      const req = f.required ? "REQUIRED" : "optional";
      const typ = f.type || "string";
      let line = `  - ${f.key} (${typ}, ${req})`;
      if (f.maxLength) line += ` max ${f.maxLength}`;
      if (f.default) line += ` default: "${f.default}"`;
      if (f.label) line += ` — ${f.label}`;
      lines.push(line);
      if (f.schema && typeof f.schema === "object") {
        Object.entries(f.schema).forEach(([subKey, subDef]) => {
          const subReq = subDef.required ? "REQUIRED" : "optional";
          lines.push(`    - ${subKey} (${subDef.type || "string"}, ${subReq})`);
        });
      }
    });
  }
  return lines.join("\n");
}

/**
 * Build the channel context layer for the email composer system prompt.
 * Contains: section catalogue + archetype recipes.
 */
function buildChannelContextLayer(context) {
  const lines = [];

  // Section catalogue — full list of available sections with schemas
  const catalogue = loadSectionCatalogue();
  lines.push("# EMAIL SECTION CATALOGUE");
  lines.push("These are the ONLY section types you may use. Each section has a strict prop schema — adhere exactly.");
  lines.push("");

  catalogue.forEach(schema => {
    lines.push(formatSectionForPrompt(schema));
    lines.push("");
  });

  // Archetype recipes
  lines.push("# ARCHETYPE RECIPES");
  lines.push("Each archetype has a recommended section sequence. Use the recipe as your structural guide.");
  lines.push("Required sections MUST be included. Optional sections MAY be included if they add value.");
  lines.push("");

  Object.entries(ARCHETYPE_RECIPES).forEach(([key, recipe]) => {
    lines.push(`## ${key} — ${recipe.name}`);
    lines.push(`Description: ${recipe.description}`);
    lines.push(`Feel: ${recipe.feel}`);
    lines.push(`Target word count: ${recipe.targetWords.min}-${recipe.targetWords.max}`);
    lines.push("Section order:");
    recipe.sections.forEach(s => {
      lines.push(`  - ${s.type} (${s.required ? "required" : "optional"}) — ${s.purpose}`);
    });
    if (recipe.rules && recipe.rules.length > 0) {
      lines.push("Rules:");
      recipe.rules.forEach(r => lines.push(`  - ${r}`));
    }
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Build the output schema layer — tells the AI exactly what JSON shape to return.
 */
function buildOutputSchemaLayer(context) {
  return `# OUTPUT SCHEMA

Return exactly this JSON shape. Output ONLY the JSON, no markdown fences, no preamble, no explanation outside the JSON.

\`\`\`
{
  "subject": "string, max 60 chars, never starts with Hi/Hello/Hey",
  "previewText": "string, max 110 chars, complements the subject without repeating it",
  "archetype": "b2b-weekly | marketing-newsletter | product-launch | transactional",
  "sections": [
    { "type": "<one of the registered section types>", "props": { ... } }
  ],
  "featuredProducts": ["recXXXXXXXXXXXXXX"],
  "reasoning": "1-2 sentences explaining your structural choices",
  "imagesNeeded": [
    {
      "sectionIndex": 1,
      "slot": "image_url",
      "style": "product-mockup | abstract | lifestyle",
      "dimensions": "hero | hero-square | feature-story | card | thumbnail | banner",
      "suggestion": "Detailed art direction. What's in the frame, what mood, what colours."
    }
  ],
  "warnings": [
    "Notes for the human reviewer about anything notable"
  ]
}
\`\`\`

KEY RULES:
- The sections array MUST follow the archetype recipe's section order
- Every section type MUST be in the catalogue above
- Every prop MUST match the section's schema (required fields, max lengths)
- Image URLs MUST be null when no asset is available, flag them in imagesNeeded instead
- CTA URLs come from input data or Product Library, never invent
- featuredProducts is the array of Product Library record IDs you referenced

IMAGE STYLE GUIDANCE (use the right "style" tag for each imagesNeeded entry):

- "product-mockup": Apple-style SVG mockups of UI screens, dashboards, chat widgets. Use this when the image should show a Travelgenix product (Luna Chat, Luna Marketing, Travelify, Quick Quote, etc) in action. AI generates these well.

- "abstract": Geometric brand hero illustrations, editorial graphics, conceptual visuals. Use this for hero panels that need a designed feel but not a specific subject. AI generates these well.

- "lifestyle": Photographic travel imagery (beaches, mountains, people travelling, real places). Use this for B2C marketing newsletters or destination promotion. AI cannot do this well; the system will route to Pexels stock photography.

DIMENSIONS GUIDE:
- "hero" (600x320): Top hero-image section
- "hero-square" (600x600): Product launch hero with mockup
- "feature-story" (600x240): Feature card image
- "card" (280x200): Destination grid card
- "thumbnail" (200x200): Small square image
- "banner" (600x180): Slim banner

Output ONLY the JSON.`;
}

// ─────────────────────────────────────────────────────────────────────
// OUTPUT NORMALISATION — parse the AI's response
// ─────────────────────────────────────────────────────────────────────

function normaliseOutput(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { draft: null, parseError: "Empty response" };
  }

  // Strip markdown fences if the AI ignored instructions
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  // Sometimes the AI prefixes with explanation — try to find the first {
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  // Try to find the matching close
  let depth = 0;
  let endIdx = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx > 0) cleaned = cleaned.slice(0, endIdx + 1);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { draft: null, parseError: `JSON parse error: ${e.message}` };
  }

  // Generate a draftId if not provided
  if (!parsed.draftId) {
    parsed.draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  return { draft: parsed, parseError: null };
}

// ─────────────────────────────────────────────────────────────────────
// VALIDATION — channel-specific checks
// ─────────────────────────────────────────────────────────────────────

function validateOutput(draft, context) {
  const warnings = [];
  const hardErrors = [];

  if (!draft || typeof draft !== "object") {
    return { warnings, hardErrors: ["Draft is not an object"] };
  }

  // Subject
  if (!draft.subject || typeof draft.subject !== "string") {
    hardErrors.push("Missing or invalid subject");
  } else {
    if (draft.subject.length > 60) {
      warnings.push(`Subject is ${draft.subject.length} chars (recommended max 60)`);
    }
    if (/^(hi|hello|hey)\b/i.test(draft.subject)) {
      warnings.push(`Subject starts with greeting word — usually weaker engagement`);
    }
  }

  // Preview text
  if (draft.previewText && draft.previewText.length > 110) {
    warnings.push(`Preview text is ${draft.previewText.length} chars (recommended max 110)`);
  }

  // Sections array
  if (!Array.isArray(draft.sections) || draft.sections.length === 0) {
    hardErrors.push("Missing or empty sections array");
    return { warnings, hardErrors };
  }

  // Each section validated against catalogue
  const validTypes = getValidSectionTypes();
  let hasFooter = false;
  draft.sections.forEach((section, idx) => {
    if (!section || typeof section !== "object" || !section.type) {
      hardErrors.push(`Section ${idx}: missing or invalid section object`);
      return;
    }
    if (!validTypes.includes(section.type)) {
      hardErrors.push(`Section ${idx}: unknown section type "${section.type}"`);
      return;
    }
    if (section.type.startsWith("footer")) hasFooter = true;

    // Validate against schema
    const schema = getSectionSchema(section.type);
    if (schema && Array.isArray(schema.fields)) {
      const props = section.props || {};
      schema.fields.forEach(field => {
        if (field.required) {
          const val = props[field.key];
          if (val === undefined || val === null || val === "") {
            hardErrors.push(`Section ${idx} (${section.type}): required prop "${field.key}" is missing`);
          }
        }
        // Length check
        if (field.maxLength && typeof props[field.key] === "string" && props[field.key].length > field.maxLength) {
          warnings.push(`Section ${idx} (${section.type}): "${field.key}" is ${props[field.key].length} chars (max ${field.maxLength})`);
        }
      });
    }
  });

  if (!hasFooter) {
    warnings.push("No footer section — emails should end with a footer for compliance");
  }

  // Archetype recipe compliance
  if (draft.archetype) {
    const recipe = getRecipe(draft.archetype);
    if (recipe) {
      recipe.sections.forEach(recipeSec => {
        if (recipeSec.required) {
          const found = draft.sections.find(s => s.type === recipeSec.type);
          if (!found) {
            warnings.push(`Archetype ${draft.archetype} expects required section "${recipeSec.type}" — not present`);
          }
        }
      });
    }
  }

  // Featured products — verify each ID exists in tenant's products
  if (Array.isArray(draft.featuredProducts)) {
    const validProductIds = context.products.map(p => p.id);
    draft.featuredProducts.forEach(pid => {
      if (!validProductIds.includes(pid)) {
        warnings.push(`Featured product "${pid}" not in this tenant's Product Library`);
      }
    });
  }

  return { warnings, hardErrors };
}

module.exports = {
  buildChannelContextLayer,
  buildOutputSchemaLayer,
  normaliseOutput,
  validateOutput,
  // Exported for testing and introspection
  loadSectionCatalogue,
  getSectionSchema,
  getValidSectionTypes
};

// lib/email-sections/index.js
// Section registry. Single source of truth for which sections exist.

const header = require("./header");
const hero = require("./hero");
const article = require("./article");
const twoColumn = require("./two-column");
const text = require("./text");
const cta = require("./cta");
const divider = require("./divider");
const footer = require("./footer");

const SECTIONS = {
  header,
  hero,
  article,
  "two-column": twoColumn,
  text,
  cta,
  divider,
  footer,
};

/**
 * Get section module by type. Returns null if unknown.
 */
function get(type) {
  return SECTIONS[type] || null;
}

/**
 * List all section schemas — used by the builder UI to populate the section library.
 */
function listSchemas() {
  return Object.entries(SECTIONS).map(([type, mod]) => mod.schema);
}

/**
 * Render a single section by type with given props.
 * Returns MJML markup string. Returns empty string on unknown type.
 */
function renderSection(type, props) {
  const mod = SECTIONS[type];
  if (!mod) {
    console.warn(`[email-sections] Unknown section type: ${type}`);
    return "";
  }
  try {
    return mod.render(props || {});
  } catch (e) {
    console.error(`[email-sections] Render failed for ${type}:`, e.message);
    return "";
  }
}

module.exports = { get, listSchemas, renderSection, SECTIONS };

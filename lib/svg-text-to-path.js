// lib/svg-text-to-path.js
//
// Converts <text> elements in an SVG string to <path> elements using opentype.js.
//
// Why this exists:
//   Sharp (via libvips) cannot reliably render <text> in SVG because Vercel's
//   serverless environment has a minimal font set (no Inter, no Georgia, etc).
//   When fonts aren't available, libvips renders missing-glyph rectangles —
//   the tofu we saw in early test runs.
//
//   Solution: convert every <text> to <path> with the actual glyph shapes
//   embedded. After this conversion, the SVG contains zero text elements —
//   only paths. Sharp can rasterise that perfectly regardless of system fonts.
//
// What this handles:
//   - <text>...</text> with text content
//   - <text> with <tspan> children (each tspan becomes its own path)
//   - font-family attribute (maps to Public Sans / Source Serif / JetBrains Mono)
//   - font-weight attribute (Regular/Medium/SemiBold/Bold)
//   - font-size attribute (in px or unitless)
//   - fill colour
//   - x, y positioning
//   - text-anchor (start, middle, end) by computing text width
//   - opacity
//
// What this does NOT handle:
//   - Italic styles (we only ship Regular weights)
//   - Rotated/transformed text (rare in our SVGs)
//   - Text-on-path (very rare)
//   - <tspan> with different positioning to parent <text>
//
// Author: Travelgenix
// Date:   18 May 2026

const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");

// ─────────────────────────────────────────────────────────────────────
// FONT LOADING
// ─────────────────────────────────────────────────────────────────────

const FONTS_DIR = path.join(__dirname, "fonts");

// Font cache, populated on first use. Lazy-load avoids cold-start hit
// if image gen isn't used in this function invocation.
let FONT_CACHE = null;

function getFont(family, weight) {
  if (!FONT_CACHE) loadFontCache();

  // Normalise family name
  const fam = String(family || "").toLowerCase();
  const w = parseInt(weight, 10) || 400;

  let key;
  if (/serif/i.test(fam) || /source serif/i.test(fam) || /georgia/i.test(fam) || /crimson/i.test(fam)) {
    key = "serif";
  } else if (/mono/i.test(fam) || /jetbrains/i.test(fam) || /sf mono/i.test(fam) || /menlo/i.test(fam) || /courier/i.test(fam)) {
    key = "mono";
  } else {
    // Default: sans (Public Sans replaces Inter/system-ui/etc)
    if (w >= 700) key = "sans-bold";
    else if (w >= 600) key = "sans-semibold";
    else if (w >= 500) key = "sans-medium";
    else key = "sans-regular";
  }

  return FONT_CACHE[key];
}

function loadFontCache() {
  FONT_CACHE = {};
  const fonts = [
    { key: "sans-regular", file: "PublicSans-Regular.ttf" },
    { key: "sans-medium", file: "PublicSans-Medium.ttf" },
    { key: "sans-semibold", file: "PublicSans-SemiBold.ttf" },
    { key: "sans-bold", file: "PublicSans-Bold.ttf" },
    { key: "serif", file: "SourceSerif4-Regular.otf" },
    { key: "mono", file: "JetBrainsMono-Regular.ttf" }
  ];
  for (const f of fonts) {
    try {
      const filePath = path.join(FONTS_DIR, f.file);
      const buffer = fs.readFileSync(filePath);
      const arr = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      FONT_CACHE[f.key] = opentype.parse(arr);
    } catch (e) {
      console.error(`[svg-text-to-path] Failed to load ${f.file}:`, e.message);
      FONT_CACHE[f.key] = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// XML ATTRIBUTE PARSING
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a single tag's attributes into an object. Handles double and single
 * quotes. Not a full XML parser, but sufficient for SVG attribute extraction.
 */
function parseAttrs(tagContent) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tagContent)) !== null) {
    attrs[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  return attrs;
}

/**
 * Parse the style="..." attribute into key-value pairs (camelCase preserved).
 */
function parseStyle(styleStr) {
  const out = {};
  if (!styleStr) return out;
  styleStr.split(";").forEach(rule => {
    const idx = rule.indexOf(":");
    if (idx === -1) return;
    const k = rule.slice(0, idx).trim();
    const v = rule.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

/**
 * Resolve an SVG attribute considering both element attribute and style attribute.
 * Style takes precedence per CSS rules but attributes are equally valid in SVG.
 */
function resolveAttr(attrs, style, name) {
  if (style && style[name] !== undefined) return style[name];
  if (attrs[name] !== undefined) return attrs[name];
  return null;
}

/**
 * Parse a length value ("16", "16px", "1em", "120%") to a number in user units.
 * Falls back to fallback if value is non-numeric.
 */
function parseLength(val, fallback) {
  if (val === null || val === undefined) return fallback;
  const m = String(val).match(/^(-?\d*\.?\d+)/);
  if (!m) return fallback;
  return parseFloat(m[1]);
}

// ─────────────────────────────────────────────────────────────────────
// TEXT WIDTH MEASUREMENT (for text-anchor middle/end)
// ─────────────────────────────────────────────────────────────────────

/**
 * Measure how wide a string would be when rendered with the given font at the
 * given size. Used to position text-anchor=middle and text-anchor=end correctly.
 */
function measureWidth(font, text, fontSize) {
  if (!font || !text) return 0;
  try {
    return font.getAdvanceWidth(text, fontSize);
  } catch (e) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// MAIN CONVERSION
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert all <text>...</text> in an SVG string to <path> elements.
 *
 * @param {string} svgSource — the SVG string from Claude
 * @returns {{ converted: string, count: number, errors: array }}
 */
function convertTextToPaths(svgSource) {
  if (!svgSource || typeof svgSource !== "string") {
    return { converted: svgSource || "", count: 0, errors: ["Empty input"] };
  }

  if (!FONT_CACHE) loadFontCache();

  const errors = [];
  let count = 0;

  // Find every <text>...</text> block. Allow attributes on the opening tag.
  // Match the whole element including inner content.
  // Note: SVG <text> elements don't nest, so a simple regex is fine.
  const textRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;

  const converted = svgSource.replace(textRegex, (fullMatch, attrsRaw, innerContent) => {
    try {
      const attrs = parseAttrs("<text " + attrsRaw + ">");
      const style = parseStyle(attrs.style || "");

      // Resolve text properties (attribute or style)
      const x = parseLength(resolveAttr(attrs, style, "x"), 0);
      const y = parseLength(resolveAttr(attrs, style, "y"), 0);
      const fontFamily = resolveAttr(attrs, style, "font-family") || "sans";
      const fontWeight = resolveAttr(attrs, style, "font-weight") || "400";
      const fontSize = parseLength(resolveAttr(attrs, style, "font-size"), 16);
      const fill = resolveAttr(attrs, style, "fill") || "#000";
      const opacity = resolveAttr(attrs, style, "opacity") || resolveAttr(attrs, style, "fill-opacity") || "1";
      const textAnchor = resolveAttr(attrs, style, "text-anchor") || "start";
      const transform = attrs.transform || null;

      const font = getFont(fontFamily, fontWeight);
      if (!font) {
        errors.push(`Font not loaded for family=${fontFamily} weight=${fontWeight}`);
        return fullMatch; // keep original text element
      }

      // Handle <tspan> children, OR plain text content
      const tspans = extractTextAndTspans(innerContent, {
        baseX: x,
        baseY: y,
        fontSize,
        fontFamily,
        fontWeight,
        fill,
        textAnchor
      });

      const paths = [];
      let lastX = x;
      let lastY = y;

      for (const piece of tspans) {
        const pieceFont = getFont(piece.fontFamily, piece.fontWeight) || font;
        const pieceText = piece.text;
        if (!pieceText) continue;

        // Compute starting x based on text-anchor
        let renderX = piece.x !== null ? piece.x : lastX;
        const renderY = piece.y !== null ? piece.y : lastY;
        const width = measureWidth(pieceFont, pieceText, piece.fontSize);

        if (piece.textAnchor === "middle") renderX -= width / 2;
        else if (piece.textAnchor === "end") renderX -= width;

        // Generate the path
        let svgPath;
        try {
          const pathObj = pieceFont.getPath(pieceText, renderX, renderY, piece.fontSize);
          svgPath = pathObj.toPathData(2);
        } catch (e) {
          errors.push(`Path generation failed for "${pieceText.slice(0, 30)}": ${e.message}`);
          continue;
        }

        if (!svgPath) continue;

        // Build the <path> element with fill + opacity
        let pathEl = `<path d="${svgPath}" fill="${escapeAttr(piece.fill)}"`;
        if (piece.opacity && piece.opacity !== "1") {
          pathEl += ` fill-opacity="${escapeAttr(piece.opacity)}"`;
        }
        if (transform && piece === tspans[0]) {
          pathEl += ` transform="${escapeAttr(transform)}"`;
        }
        pathEl += `/>`;

        paths.push(pathEl);

        // Advance position for next tspan if it doesn't have explicit x/y
        lastX = renderX + width;
        lastY = renderY;
        count++;
      }

      return paths.join("");
    } catch (e) {
      errors.push(`<text> conversion failed: ${e.message}`);
      return fullMatch;
    }
  });

  return { converted, count, errors };
}

/**
 * Extract text content from inside a <text> element. Supports plain text and
 * <tspan> children with their own attributes.
 */
function extractTextAndTspans(innerContent, parentDefaults) {
  if (!innerContent) return [];

  // If no <tspan>, treat the whole content as one piece with parent defaults
  if (!/<tspan/i.test(innerContent)) {
    const text = decodeEntities(innerContent).replace(/\s+/g, " ").trim();
    if (!text) return [];
    return [{
      text,
      x: parentDefaults.baseX,
      y: parentDefaults.baseY,
      fontSize: parentDefaults.fontSize,
      fontFamily: parentDefaults.fontFamily,
      fontWeight: parentDefaults.fontWeight,
      fill: parentDefaults.fill,
      opacity: "1",
      textAnchor: parentDefaults.textAnchor
    }];
  }

  // Has <tspan> children. Walk them.
  const pieces = [];

  // Capture any text BEFORE the first <tspan> as a piece
  const firstTspan = innerContent.search(/<tspan\b/i);
  if (firstTspan > 0) {
    const leading = decodeEntities(innerContent.slice(0, firstTspan)).replace(/\s+/g, " ").trim();
    if (leading) {
      pieces.push({
        text: leading,
        x: parentDefaults.baseX,
        y: parentDefaults.baseY,
        fontSize: parentDefaults.fontSize,
        fontFamily: parentDefaults.fontFamily,
        fontWeight: parentDefaults.fontWeight,
        fill: parentDefaults.fill,
        opacity: "1",
        textAnchor: parentDefaults.textAnchor
      });
    }
  }

  // Match each <tspan ...>...</tspan>
  const tspanRegex = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi;
  let m;
  while ((m = tspanRegex.exec(innerContent)) !== null) {
    const attrs = parseAttrs("<tspan " + m[1] + ">");
    const style = parseStyle(attrs.style || "");

    const x = attrs.x !== undefined ? parseLength(attrs.x, null) : null;
    const y = attrs.y !== undefined ? parseLength(attrs.y, null) : null;
    const dx = attrs.dx !== undefined ? parseLength(attrs.dx, 0) : 0;
    const dy = attrs.dy !== undefined ? parseLength(attrs.dy, 0) : 0;
    const fontSize = parseLength(resolveAttr(attrs, style, "font-size"), parentDefaults.fontSize);
    const fontFamily = resolveAttr(attrs, style, "font-family") || parentDefaults.fontFamily;
    const fontWeight = resolveAttr(attrs, style, "font-weight") || parentDefaults.fontWeight;
    const fill = resolveAttr(attrs, style, "fill") || parentDefaults.fill;
    const opacity = resolveAttr(attrs, style, "opacity") || resolveAttr(attrs, style, "fill-opacity") || "1";
    const textAnchor = resolveAttr(attrs, style, "text-anchor") || parentDefaults.textAnchor;

    const text = decodeEntities(m[2]).replace(/\s+/g, " ").trim();
    if (!text) continue;

    pieces.push({
      text,
      x: x !== null ? x + dx : null,
      y: y !== null ? y + dy : (dy !== 0 ? parentDefaults.baseY + dy : null),
      fontSize,
      fontFamily,
      fontWeight,
      fill,
      opacity,
      textAnchor
    });
  }

  return pieces;
}

// ─────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────

function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, c) => String.fromCharCode(parseInt(c, 16)));
}

function escapeAttr(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/"/g, "&quot;").replace(/&/g, "&amp;");
}

module.exports = {
  convertTextToPaths,
  // Exported for testing
  _internals: { getFont, parseAttrs, parseStyle, measureWidth, loadFontCache }
};

// lib/email-sections/_helpers.js
// Shared utilities for section templates.

/**
 * Escape user-supplied text for safe inclusion as MJML content.
 * MJML accepts HTML inside <mj-text>, so we must HTML-escape.
 */
function escHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape for use inside an HTML attribute value (e.g. href, src, alt).
 * We additionally validate URLs to prevent javascript: schemes.
 */
function escAttr(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Validate and sanitise a URL. Allows http/https/mailto/tel.
 * A bare email address (bookings@example.com) becomes a mailto: link, and a
 * bare "+44..." phone number becomes a tel: link, so a CTA/link field can open
 * the reader's email or phone app without them having to type the scheme.
 * Returns empty string if the value is unsafe.
 */
function safeUrl(url) {
  if (!url) return "";
  let trimmed = String(url).trim();
  if (!trimmed) return "";
  // Only add a scheme when the value doesn't already carry one (no colon).
  if (trimmed.indexOf(":") === -1) {
    // Bare email → mailto:  (single @, a dot in the domain)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      trimmed = "mailto:" + trimmed;
    } else if (/^\+[0-9][0-9\s().-]{5,}$/.test(trimmed)) {
      // Bare international phone number (must start with +) → tel:
      trimmed = "tel:" + trimmed.replace(/[\s().-]/g, "");
    }
  }
  // Allow http, https, mailto, tel. Reject javascript:, data:, file:, etc.
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) {
    return escAttr(trimmed);
  }
  // If it looks like a domain without scheme, prefix https
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed)) {
    return escAttr(`https://${trimmed}`);
  }
  return "";
}

/**
 * Return s if non-empty after trim, else fallback.
 */
function fallback(s, defaultValue) {
  if (s === null || s === undefined) return defaultValue;
  const trimmed = String(s).trim();
  return trimmed ? s : defaultValue;
}

/**
 * Convert simple inline markdown (**bold**, *italic*, [text](url)) inside text content.
 * Used in body fields where Andy might write light markdown without realising.
 * Caller has already HTML-escaped the input — we only re-introduce a small whitelist.
 */
function inlineMarkdown(escapedText) {
  if (!escapedText) return "";
  return escapedText
    // Links: [text](url) — url is unescaped because we re-validate
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      const u = safeUrl(url);
      return u ? `<a href="${u}" style="color:inherit;text-decoration:underline">${text}</a>` : text;
    })
    // Bold: **text**
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic: *text* (avoiding ** which we handled above)
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
}

/**
 * Render a body string that might contain paragraph breaks (\n\n).
 * Splits on blank lines and wraps each paragraph in its own visual gap.
 * Single newlines become <br>.
 */
function renderBody(text) {
  if (!text) return "";
  const escaped = escHtml(text);
  const paragraphs = escaped.split(/\n\s*\n/);
  return paragraphs
    .map((p) => inlineMarkdown(p.replace(/\n/g, "<br>")))
    .map((p) => `<p style="margin:0 0 12px 0">${p}</p>`)
    .join("");
}

/**
 * Strict six-digit hex validator (#RRGGBB only — no shorthand, no rgb()).
 * Returns the trimmed hex if valid, otherwise null. Used by colour props
 * to prevent CSS injection via section props.
 */
function safeHex(value) {
  if (typeof value !== "string") return null;
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

/**
 * Relative text-size presets shared across sections. Each editable text
 * area declares a base pixel size; the chosen preset multiplies it, so the
 * same option ("Larger") means the same proportional change on every field
 * regardless of its default size. Empty / unknown resolves to 1 (default).
 *
 * Keep these keys in sync with the `fontSize` control in public/client.html.
 */
const FONT_SCALE = { xs: 0.8, s: 0.9, "": 1, m: 1, l: 1.2, xl: 1.45, xxl: 1.75 };

function scaleFont(basePx, sizeKey) {
  const factor = FONT_SCALE[sizeKey];
  return Math.round(basePx * (typeof factor === "number" ? factor : 1));
}

/**
 * On-canvas edit hook. `ref` is the section's index in the email (a number)
 * when rendering in editable mode, or null/undefined/false otherwise.
 * Returns a ` data-tg-edit="<sectionIndex>:<propPath>"` attribute string
 * (note the leading space) that lets the builder map a click on the
 * rendered element back to a specific section + prop. Returns "" when not
 * editable, so real sends are byte-identical. Both parts are escaped.
 * Prop paths never contain ":", so the builder splits on the first ":".
 */
function editAttr(ref, path) {
  if (ref === undefined || ref === null || ref === false || !path) return "";
  return ` data-tg-edit="${escAttr(String(ref) + ":" + String(path))}"`;
}

/**
 * Marks an editable element as rich-text capable (bold / italic / link),
 * so the builder's floating toolbar offers formatting there. Only emitted
 * in editable mode. Pair with fields rendered through `richInline` /
 * `renderBody` so the markdown the toolbar produces round-trips.
 */
function richAttr(ref) {
  return (ref === undefined || ref === null || ref === false) ? "" : ` data-tg-rich="1"`;
}

/**
 * Render a single-line prose string with the inline markdown whitelist
 * (**bold**, *italic*, [text](url)). Escapes first, then re-introduces the
 * whitelist — identical output to plain escHtml when no markdown is
 * present, so existing content is unaffected.
 */
function richInline(s) {
  return inlineMarkdown(escHtml(s == null ? "" : String(s)));
}

module.exports = {
  escHtml,
  escAttr,
  safeUrl,
  fallback,
  inlineMarkdown,
  renderBody,
  safeHex,
  FONT_SCALE,
  scaleFont,
  editAttr,
  richAttr,
  richInline,
};

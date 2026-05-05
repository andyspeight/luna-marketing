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
 * Validate and sanitise a URL. Only http/https/mailto allowed.
 * Returns empty string if URL is unsafe.
 */
function safeUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  // Allow http, https, mailto only. Reject javascript:, data:, file:, etc.
  if (/^(https?:|mailto:)/i.test(trimmed)) {
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

module.exports = {
  escHtml,
  escAttr,
  safeUrl,
  fallback,
  inlineMarkdown,
  renderBody,
};

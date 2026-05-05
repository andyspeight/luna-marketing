// lib/email-renderer.js
// Renders an array of section JSON to email-safe HTML.
//
// Usage:
//   const { renderEmail } = require("./lib/email-renderer");
//   const result = renderEmail({
//     sections: [
//       { type: "header", props: { ... } },
//       { type: "hero", props: { headline: "Hi", ... } },
//       { type: "footer", props: { ... } },
//     ],
//     unsubUrl: "https://luna-marketing.vercel.app/unsubscribe?token=abc",
//   });
//   // result.html, result.errors, result.warnings, result.plainText

const mjml2html = require("mjml");
const { BRAND, FONTS } = require("./email-brand");
const { renderSection } = require("./email-sections");

/**
 * Render an email from section JSON.
 *
 * @param {Object} input
 * @param {Array<{type: string, props: Object}>} input.sections
 * @param {string} input.unsubUrl - Unsubscribe URL (replaces {{UNSUB_URL}} placeholder)
 * @param {string} [input.previewText] - Preview text shown in inbox previews
 * @param {string} [input.title] - <title> tag (rarely shown but good practice)
 * @param {string} [input.bodyBackground] - Override body background colour
 * @returns {{ html: string, plainText: string, errors: Array, warnings: Array, mjml: string }}
 */
function renderEmail(input = {}) {
  const sections = Array.isArray(input.sections) ? input.sections : [];
  const unsubUrl = String(input.unsubUrl || "").trim();
  const previewText = String(input.previewText || "").slice(0, 200);
  const title = String(input.title || "Travelgenix").slice(0, 100);
  const bodyBg = input.bodyBackground || BRAND.paper;

  const errors = [];
  const warnings = [];

  // Render each section to MJML markup
  let sectionsMjml = "";
  let hasFooter = false;
  for (const s of sections) {
    if (!s || typeof s !== "object" || !s.type) {
      warnings.push("Skipped invalid section (missing type)");
      continue;
    }
    if (s.type === "footer") hasFooter = true;
    const markup = renderSection(s.type, s.props || {});
    if (!markup) {
      warnings.push(`Section "${s.type}" produced no output`);
      continue;
    }
    sectionsMjml += markup + "\n";
  }

  if (!hasFooter) {
    warnings.push("No footer section — emails should include a footer for compliance");
  }

  // Wrap in MJML envelope
  const mjmlSource = `
<mjml>
  <mj-head>
    <mj-title>${escAttr(title)}</mj-title>
    <mj-preview>${escText(previewText)}</mj-preview>
    <mj-attributes>
      <mj-all font-family="${FONTS.body}" />
      <mj-text font-family="${FONTS.body}" color="${BRAND.ink}" />
    </mj-attributes>
    <mj-style>
      a { color: ${BRAND.tealDeep}; }
      .ink-link { color: ${BRAND.tealDeep} !important; }
      @media only screen and (max-width: 480px) {
        .mobile-stack { width: 100% !important; }
      }
    </mj-style>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
  </mj-head>
  <mj-body background-color="${bodyBg}" width="600px">
    ${sectionsMjml}
  </mj-body>
</mjml>`;

  // Compile MJML
  let result;
  try {
    result = mjml2html(mjmlSource, {
      validationLevel: "soft",
      keepComments: false,
      minify: false,
    });
  } catch (e) {
    errors.push(`MJML compile failed: ${e.message}`);
    return { html: "", plainText: "", errors, warnings, mjml: mjmlSource };
  }

  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      warnings.push(`MJML warning: ${err.formattedMessage || err.message}`);
    }
  }

  let html = result.html || "";

  // Inject unsubscribe URL
  if (unsubUrl) {
    const safeUnsub = unsubUrl.replace(/"/g, "&quot;");
    html = html.replace(/\{\{UNSUB_URL\}\}/g, safeUnsub);
  } else {
    // No unsub URL provided — replace placeholder with a clear missing-link marker
    // (Better than leaving {{UNSUB_URL}} visible in the email)
    html = html.replace(/\{\{UNSUB_URL\}\}/g, "#");
    if (html.includes("{{UNSUB_URL}}") || html.includes("Unsubscribe")) {
      // Already had an unsub block but no URL — still valid as a #
      warnings.push("No unsubUrl provided — unsubscribe link points to '#'");
    }
  }

  // Generate plain text version (basic, good enough for Brevo's textContent requirement)
  const plainText = htmlToPlainText(html);

  return { html, plainText, errors, warnings, mjml: mjmlSource };
}

/**
 * Convert rendered HTML to plain text. Used to satisfy Brevo's
 * non-empty textContent requirement.
 *
 * MJML's compiled HTML uses lots of table spacers (rows with just &nbsp;)
 * which we filter out before extraction.
 */
function htmlToPlainText(html) {
  if (!html) return "";

  // Step 1: strip out MJML's whitespace spacer rows. Tables with role=presentation
  // and no real content. We can't easily detect these without DOM parsing, so we
  // rely on extracting from the visible text-bearing elements only.
  // Strategy: find all <p>, <h*>, <a> contents and the body of <td> with text.

  // Easier heuristic: render the email's text-only elements via a regex sweep
  // for content that is text rather than markup-only spacers.

  let text = html
    // Drop hidden preheader spans (MJML uses these for inbox preview)
    .replace(/<div[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    // Drop styles, scripts, head
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    // Drop everything before <body>
    .replace(/^[\s\S]*?<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*$/i, "")
    // Block-level breaks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|td|tr|table|h[1-6]|li)>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)));

  // Collapse whitespace: multiple spaces/tabs to one, trim each line, then collapse
  // multiple blank lines to a single blank line.
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, arr) => {
      // Drop consecutive blank lines
      if (line === "" && arr[i - 1] === "") return false;
      return true;
    })
    .join("\n")
    .trim();

  return text;
}

function escAttr(s) {
  return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escText(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { renderEmail, htmlToPlainText };

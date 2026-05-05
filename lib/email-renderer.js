// lib/email-renderer.js
// Hand-rolled email renderer — produces email-safe HTML with no MJML dependency.
// Renders an array of section JSON to HTML.
//
// Why no MJML: MJML works locally but crashes Vercel serverless functions at
// invocation time (likely a transitive dep init issue). The output we need is
// straightforward enough to write directly as table-based HTML.

const { BRAND, FONTS } = require("./email-brand");
const { renderSection } = require("./email-sections");

const EMAIL_WIDTH = 600;

/**
 * Render an email from section JSON.
 *
 * @param {Object} input
 * @param {Array<{type: string, props: Object}>} input.sections
 * @param {string} input.unsubUrl
 * @param {string} [input.previewText]
 * @param {string} [input.title]
 * @param {string} [input.bodyBackground]
 * @returns {{ html: string, plainText: string, errors: Array, warnings: Array }}
 */
function renderEmail(input = {}) {
  const sections = Array.isArray(input.sections) ? input.sections : [];
  const unsubUrl = String(input.unsubUrl || "").trim();
  const previewText = String(input.previewText || "").slice(0, 200);
  const title = String(input.title || "Travelgenix").slice(0, 100);
  const bodyBg = input.bodyBackground || BRAND.paper;

  const errors = [];
  const warnings = [];

  let sectionsHtml = "";
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
    sectionsHtml += markup + "\n";
  }

  if (!hasFooter) {
    warnings.push("No footer section — emails should include a footer for compliance");
  }

  let html = renderScaffold({ title, previewText, bodyBg, sectionsHtml });

  if (unsubUrl) {
    const safeUnsub = unsubUrl.replace(/"/g, "&quot;");
    html = html.replace(/\{\{UNSUB_URL\}\}/g, safeUnsub);
  } else {
    html = html.replace(/\{\{UNSUB_URL\}\}/g, "#");
    if (sections.some((s) => s && s.type === "footer")) {
      warnings.push("No unsubUrl provided — unsubscribe link points to '#'");
    }
  }

  const plainText = htmlToPlainText(html);

  return { html, plainText, errors, warnings };
}

function renderScaffold({ title, previewText, bodyBg, sectionsHtml }) {
  const previewHtml = previewText
    ? `<div style="display:none;font-size:1px;color:${bodyBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escHtml(previewText)}</div>`
    : "";

  return `<!doctype html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<title>${escHtml(title)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; border-collapse:collapse; }
img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; height:auto; line-height:100%; }
body { margin:0 !important; padding:0 !important; width:100% !important; background-color:${bodyBg}; }
a { color:${BRAND.tealDeep}; text-decoration:underline; }
.tg-link { color:${BRAND.tealDeep} !important; }
@media only screen and (max-width:600px) {
  .tg-container { width:100% !important; max-width:100% !important; }
  .tg-stack { display:block !important; width:100% !important; max-width:100% !important; box-sizing:border-box; }
  .tg-pad-mobile { padding:24px !important; }
  .tg-img-fluid { width:100% !important; height:auto !important; max-width:100% !important; }
  .tg-hero-headline { font-size:26px !important; line-height:32px !important; }
  .tg-hero-subhead { font-size:16px !important; line-height:24px !important; }
  .tg-spacer-mobile { height:16px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${bodyBg};">
${previewHtml}
<div style="background-color:${bodyBg};">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="${EMAIL_WIDTH}" class="tg-container" style="background-color:${bodyBg};margin:0 auto;width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;">
<tr><td align="center" style="padding:0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;">
${sectionsHtml}
</table>
</td></tr>
</table>
</div>
</body>
</html>`;
}

function htmlToPlainText(html) {
  if (!html) return "";

  let text = html
    .replace(/<div[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[\s\S]*?<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|td|tr|table|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
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

  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, arr) => {
      if (line === "" && arr[i - 1] === "") return false;
      return true;
    })
    .join("\n")
    .trim();

  return text;
}

function escHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { renderEmail, htmlToPlainText, EMAIL_WIDTH };

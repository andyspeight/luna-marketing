// api/email-template.js
// Email HTML wrapper with Travelgenix branding
// Used by all Luna-generated emails (newsletter, drips, broadcasts)
//
// Brand: warm, direct, professional. UK English. No corporate speak.
// Renders inline-styled HTML for maximum email client compatibility.

const BRAND = {
  primary: "#0066CC",      // Travelgenix blue
  primaryDark: "#004999",
  accent: "#00B4D8",
  text: "#1A2B3C",
  textMuted: "#6B7280",
  bgLight: "#F8FAFB",
  border: "#E5E7EB",
  success: "#10B981",
};

/**
 * Wrap raw email body in the Travelgenix branded shell.
 * @param {object} args
 * @param {string} args.subject - Email subject (used in preheader if no preview)
 * @param {string} args.previewText - Preview text shown in inbox
 * @param {string} args.bodyHtml - The email body content (sections, paragraphs, etc)
 * @param {string} [args.ctaText] - Primary CTA button label
 * @param {string} [args.ctaUrl] - Primary CTA button URL
 * @param {object} [args.footerLinks] - Override footer links
 * @returns {string} Full HTML email
 */
function wrapEmail(args) {
  const previewText = args.previewText || args.subject || "";
  const ctaBlock = args.ctaUrl && args.ctaText
    ? renderCta(args.ctaText, args.ctaUrl)
    : "";
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(args.subject || "")}</title>
<style>
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: ${BRAND.bgLight}; color: ${BRAND.text}; }
  .preheader { display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
  .header { padding: 32px 32px 16px; }
  .logo { font-size: 22px; font-weight: 700; color: ${BRAND.primary}; letter-spacing: -0.5px; }
  .body-content { padding: 16px 32px 32px; line-height: 1.6; font-size: 16px; }
  .body-content h1 { font-size: 26px; line-height: 1.3; margin: 24px 0 12px; color: ${BRAND.text}; font-weight: 700; }
  .body-content h2 { font-size: 20px; line-height: 1.4; margin: 24px 0 10px; color: ${BRAND.text}; font-weight: 600; }
  .body-content h3 { font-size: 17px; line-height: 1.4; margin: 20px 0 8px; color: ${BRAND.text}; font-weight: 600; }
  .body-content p { margin: 0 0 16px; }
  .body-content a { color: ${BRAND.primary}; text-decoration: underline; }
  .body-content ul, .body-content ol { margin: 0 0 16px; padding-left: 24px; }
  .body-content li { margin-bottom: 6px; }
  .cta-wrap { text-align: center; padding: 16px 32px 24px; }
  .cta-button { display: inline-block; padding: 14px 32px; background: ${BRAND.primary}; color: #ffffff !important; text-decoration: none !important; border-radius: 6px; font-weight: 600; font-size: 16px; }
  .footer { padding: 24px 32px 32px; border-top: 1px solid ${BRAND.border}; font-size: 13px; color: ${BRAND.textMuted}; line-height: 1.5; }
  .footer a { color: ${BRAND.textMuted}; }
  @media (max-width: 600px) {
    .header, .body-content, .footer, .cta-wrap { padding-left: 20px; padding-right: 20px; }
  }
</style>
</head>
<body>
<span class="preheader">${escapeHtml(previewText).slice(0, 200)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td align="center" style="padding: 24px 0;">
      <table class="container" role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td class="header">
            <div class="logo">Travelgenix</div>
          </td>
        </tr>
        <tr>
          <td class="body-content">
            ${args.bodyHtml || ""}
          </td>
        </tr>
        ${ctaBlock}
        <tr>
          <td class="footer">
            <p style="margin: 0 0 12px;">
              You're receiving this because you're a Travelgenix client or signed up for our updates.
            </p>
            <p style="margin: 0 0 8px;">
              <a href="https://travelgenix.io">travelgenix.io</a> · 
              <a href="mailto:hello@travelgenix.io">hello@travelgenix.io</a> · 
              <a href="{{params.unsubscribe}}">Unsubscribe</a>
            </p>
            <p style="margin: 12px 0 0; font-size: 12px;">
              Travelgenix is part of Agendas Group · Bournemouth, UK
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function renderCta(text, url) {
  return `<tr>
    <td class="cta-wrap">
      <a href="${escapeAttr(url)}" class="cta-button" style="display:inline-block;padding:14px 32px;background:${BRAND.primary};color:#ffffff !important;text-decoration:none !important;border-radius:6px;font-weight:600;font-size:16px;">${escapeHtml(text)}</a>
    </td>
  </tr>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(s);
}

/**
 * Convert plain text or markdown-lite to HTML.
 * Supports: paragraphs, bold (**), italic (_), links [text](url), bullet lists, headings (## ###).
 */
function plainToHtml(plain) {
  if (!plain) return "";
  
  const lines = plain.split(/\r?\n/);
  const out = [];
  let inList = false;
  let inPara = false;
  
  function closeList() {
    if (inList) { out.push("</ul>"); inList = false; }
  }
  function closePara() {
    if (inPara) { out.push("</p>"); inPara = false; }
  }
  
  for (let line of lines) {
    line = line.trim();
    
    if (!line) {
      closePara();
      closeList();
      continue;
    }
    
    if (/^### /.test(line)) {
      closePara(); closeList();
      out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
      continue;
    }
    if (/^## /.test(line)) {
      closePara(); closeList();
      out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
      continue;
    }
    if (/^# /.test(line)) {
      closePara(); closeList();
      out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      closePara();
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }
    
    closeList();
    if (!inPara) { out.push("<p>"); inPara = true; }
    else { out.push("<br>"); }
    out.push(inlineFormat(line));
  }
  
  closePara();
  closeList();
  
  return out.join("\n");
}

function inlineFormat(text) {
  // Order matters: links first (otherwise URLs inside [] get mangled), then bold, then italic
  text = escapeHtml(text);
  // [label](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // **bold**
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // _italic_
  text = text.replace(/(?:^|\s)_([^_]+)_(?=\s|$|[.,!?])/g, " <em>$1</em>");
  // bare URLs
  text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  return text;
}

/**
 * Strip HTML to produce a plain text version.
 */
function htmlToPlain(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  wrapEmail,
  plainToHtml,
  htmlToPlain,
  BRAND,
};

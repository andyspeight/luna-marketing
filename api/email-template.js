// api/email-template.js
// Travelgenix branded email template — Bold Editorial
// Magazine-cover treatment with teal masthead panel, white reading card
// Vibe: Monocle Minute meets The Verge — confident, considered, distinctive
//
// Brand:
//   Teal:    #0ABAB5 (primary)
//   Pink:    #EC2D8E
//   Yellow:  #FFB627
//   Ink:     #0F172A (text)

const BRAND = {
  teal: "#0ABAB5",
  tealDeep: "#067A75",
  tealDarker: "#055552",
  pink: "#EC2D8E",
  yellow: "#FFB627",
  ink: "#0F172A",
  inkSoft: "#334155",
  inkMuted: "#64748B",
  paper: "#F5F1EA",      // warm cream
  surface: "#FFFFFF",
  rule: "#E5E0D5",
  ruleSubtle: "#F1F5F9",
};

const LOGO_URL = "https://irp.cdn-website.com/89c0010b/dms3rep/multi/Travelgenix-RecreteOurLogo-SM-13Sep2023-V1-Black-8529449a.png";

/**
 * Wrap raw email body in the Travelgenix branded shell.
 * @param {object} args
 * @param {string} args.subject
 * @param {string} args.previewText
 * @param {string} args.bodyHtml - The email body (typically from plainToHtml)
 * @param {string} [args.ctaText]
 * @param {string} [args.ctaUrl]
 * @param {string} [args.eyebrow] - Override the eyebrow label (defaults to issue date)
 * @param {string} [args.headline] - Hero headline (used in the cover panel)
 * @returns {string} Full HTML email
 */
function wrapEmail(args) {
  const previewText = args.previewText || args.subject || "";
  const issueLabel = args.eyebrow || formatIssueDate();
  const ctaBlock = args.ctaUrl && args.ctaText ? renderCta(args.ctaText, args.ctaUrl) : "";
  const heroHeadline = args.headline || args.subject || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(args.subject || "")}</title>
<!--[if mso]>
<style type="text/css">
  table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  body, table, td, p, a, li, blockquote { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
</style>
<![endif]-->
<style>
  body { margin: 0; padding: 0; width: 100% !important; background-color: ${BRAND.paper}; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }
  table { border-collapse: collapse; }
  img { border: 0; -ms-interpolation-mode: bicubic; display: block; }
  
  .content {
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    font-size: 17px;
    line-height: 1.7;
    color: ${BRAND.ink};
  }
  .content p {
    margin: 0 0 22px;
    font-size: 17px;
    line-height: 1.7;
    color: ${BRAND.inkSoft};
  }
  .content p:first-child { margin-top: 0; }
  .content h1 {
    font-size: 28px;
    line-height: 1.2;
    margin: 36px 0 16px;
    color: ${BRAND.ink};
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .content h1:first-child { margin-top: 0; }
  .content h2 {
    font-size: 22px;
    line-height: 1.3;
    margin: 36px 0 14px;
    color: ${BRAND.ink};
    font-weight: 700;
    letter-spacing: -0.015em;
  }
  .content h3 {
    font-size: 12px;
    line-height: 1.4;
    margin: 32px 0 10px;
    color: ${BRAND.tealDeep};
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  .content a {
    color: ${BRAND.tealDeep};
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
    font-weight: 600;
  }
  .content strong { color: ${BRAND.ink}; font-weight: 700; }
  .content em { font-style: italic; }
  .content ul, .content ol {
    margin: 0 0 22px;
    padding-left: 24px;
  }
  .content li {
    margin: 0 0 10px;
    font-size: 17px;
    line-height: 1.65;
    color: ${BRAND.inkSoft};
  }
  .content blockquote {
    margin: 24px 0;
    padding: 4px 0 4px 22px;
    border-left: 4px solid ${BRAND.pink};
    color: ${BRAND.inkSoft};
    font-style: italic;
    font-size: 18px;
  }
  
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 28px !important; padding-right: 28px !important; }
    .cover-pad { padding: 32px 28px 36px !important; }
    .reading-pad { padding: 36px 28px 32px !important; }
    .footer-pad { padding: 0 28px 36px !important; }
    .cover-h1 { font-size: 28px !important; line-height: 1.2 !important; }
    .content h1 { font-size: 22px !important; }
    .content h2 { font-size: 19px !important; }
    .header-row td { display: block !important; width: 100% !important; }
    .header-row .issue-label { text-align: left !important; padding-top: 10px !important; }
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.paper};">

<div style="display: none; max-height: 0; max-width: 0; overflow: hidden; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; font-size: 1px; line-height: 1px;">
${escapeHtml(previewText).slice(0, 200)}
</div>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: ${BRAND.paper};">
  <tr>
    <td align="center" style="padding: 32px 16px;">
      
      <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width: 600px; max-width: 600px;">
        
        <!-- ─── Cover panel — teal background ─── -->
        <tr>
          <td class="cover-pad" style="background-color: ${BRAND.teal}; padding: 44px 48px 56px; border-radius: 4px 4px 0 0;">
            
            <table role="presentation" class="header-row" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="left" valign="middle" style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; color: rgba(255,255,255,0.75); text-transform: uppercase;">
                  The Travelgenix Briefing
                </td>
                <td class="issue-label" align="right" valign="middle" style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: rgba(255,255,255,0.75);">
                  ${escapeHtml(issueLabel)}
                </td>
              </tr>
            </table>
            
            <div style="height: 1px; background-color: rgba(255,255,255,0.2); margin: 20px 0 32px; line-height: 1px; font-size: 1px;">&nbsp;</div>
            
            <h1 class="cover-h1" style="margin: 0; color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 36px; line-height: 1.15; font-weight: 800; letter-spacing: -0.025em;">
              ${escapeHtml(heroHeadline)}
            </h1>
            
            ${previewText ? `<p style="margin: 20px 0 0; color: rgba(255,255,255,0.88); font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 16px; line-height: 1.55; font-weight: 400;">
              ${escapeHtml(previewText)}
            </p>` : ""}
          </td>
        </tr>
        
        <!-- ─── Reading area — white card ─── -->
        <tr>
          <td style="background-color: ${BRAND.surface}; border-radius: 0 0 4px 4px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              
              <tr>
                <td class="content reading-pad" style="padding: 48px 48px 32px;">
                  ${args.bodyHtml || ""}
                </td>
              </tr>
              
              ${ctaBlock}
              
              <tr>
                <td class="px" style="padding: 32px 48px 0;">
                  <div style="height: 1px; background-color: ${BRAND.ruleSubtle}; line-height: 1px; font-size: 1px;">&nbsp;</div>
                </td>
              </tr>
              
              <tr>
                <td class="footer-pad" style="padding: 24px 48px 40px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td align="left" valign="middle">
                        <a href="https://travelgenix.io" style="text-decoration: none; border: 0;">
                          <img src="${LOGO_URL}" alt="Travelgenix" width="140" style="display: block; width: 140px; height: auto; opacity: 0.85; border: 0;">
                        </a>
                      </td>
                      <td align="right" valign="middle" style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 12px;">
                        <a href="https://travelgenix.io" style="color: ${BRAND.inkMuted}; text-decoration: none; font-weight: 500; margin-left: 12px;">travelgenix.io</a>
                        <span style="color: ${BRAND.ruleSubtle}; margin: 0 4px;">|</span>
                        <a href="https://www.linkedin.com/in/andyspeight" style="color: ${BRAND.inkMuted}; text-decoration: none; font-weight: 500; margin-left: 4px;">LinkedIn</a>
                      </td>
                    </tr>
                  </table>
                  
                  <p style="margin: 20px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 12px; line-height: 1.6; color: ${BRAND.inkMuted};">
                    You're getting this because you're a Travelgenix client or signed up to hear from Andy. Not your thing? <a href="{{params.unsubscribe}}" style="color: ${BRAND.inkMuted}; text-decoration: underline;">Unsubscribe here</a>.
                  </p>
                </td>
              </tr>
              
            </table>
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
    <td class="px" style="padding: 12px 48px 0;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" bgcolor="${BRAND.ink}" style="border-radius: 6px; background-color: ${BRAND.ink};">
            <a href="${escapeAttr(url)}" target="_blank" style="display: inline-block; padding: 16px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; font-size: 15px; font-weight: 600; line-height: 1; color: #FFFFFF !important; text-decoration: none !important; border-radius: 6px; letter-spacing: 0.01em;">
              ${escapeHtml(text)}&nbsp;&nbsp;&rarr;
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function formatIssueDate() {
  const d = new Date();
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
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
 * Supports: paragraphs, bold (**), italic (_), links [text](url), bullet lists, headings (## ###), blockquotes (>).
 */
function plainToHtml(plain) {
  if (!plain) return "";
  
  const lines = plain.split(/\r?\n/);
  const out = [];
  let inList = false;
  let inPara = false;
  
  function closeList() { if (inList) { out.push("</ul>"); inList = false; } }
  function closePara() { if (inPara) { out.push("</p>"); inPara = false; } }
  
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
    if (/^>\s/.test(line)) {
      closePara(); closeList();
      out.push(`<blockquote>${inlineFormat(line.slice(2))}</blockquote>`);
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
  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?:^|\s)_([^_]+)_(?=\s|$|[.,!?])/g, " <em>$1</em>");
  text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  return text;
}

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

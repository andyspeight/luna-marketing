// api/content-engine-preview.js
//
// Returns rendered previews of how a Product Library record will appear in
// each channel renderer. Used by the Content Engine UI to give real-time
// "what does this look like in production" feedback as the user edits.
//
// POST body: { productFields: { name, oneLiner, problem, proof, ctaText, ctaUrl, ... }, prominence?: 'soft'|'callout'|'spotlight' }
// Returns:   { ok: true, previews: { linkedin, facebook, instagram, twitter, pinterest, tiktok, gbp, emailCalloutHtml, blogBlockHtml } }
//
// No tenant authorisation needed: this is a pure render function with no DB writes.
// We still require a valid session so it isn't a public render API.
//
// Author: Travelgenix
// Date:   15 May 2026

var ID_HOST = "https://id.travelify.io";

// Inline the renderer logic so we don't introduce a cross-import that breaks
// on Vercel cold start. These are intentionally identical to the renderers
// in lib/promotion-client.js — kept in sync. The duplication is the price
// of zero coupling; the renderers are small enough that this is acceptable.

function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, function (ch) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
  });
}

function buildDecision(productFields, prominence) {
  return {
    shouldPromote: true,
    product: {
      id: productFields.id || "preview",
      name: productFields.name || "Untitled product",
      oneLiner: productFields.oneLiner || "",
      problem: productFields.problem || "",
      proof: productFields.proof || "",
      cta: {
        text: productFields.ctaText || "Learn more",
        url:  productFields.ctaUrl  || ""
      },
      heroImage: null,
      priority: productFields.priority || 5,
      isSpotlight: false
    },
    prominence: prominence || "callout",
    asset: null,
    reasoning: "Preview render"
  };
}

function renderSocialCloser(decision, platform) {
  if (!decision || !decision.shouldPromote || !decision.product) return null;
  var p = decision.product;
  var cta = p.cta || {};
  var prom = decision.prominence;
  var isLink = ["linkedin-personal", "linkedin-company", "facebook", "gbp"].indexOf(platform) !== -1;
  var isTwitter = platform === "twitter";
  var isPinterest = platform === "pinterest";
  var isLinkInBio = ["instagram", "tiktok"].indexOf(platform) !== -1;

  if (isLink) {
    if (prom === "soft") return ("\n\n" + p.oneLiner + " " + (cta.url || "")).trim();
    return ("\n\n" + p.name + ": " + p.oneLiner + "\n\n" + (cta.text || "Learn more") + " → " + (cta.url || "")).trim();
  }
  if (isTwitter) {
    var short = p.oneLiner;
    if (short.length > 70) {
      var cut = short.slice(0, 70);
      var lastSpace = cut.lastIndexOf(" ");
      short = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:]$/, "") + "...";
    }
    return ("\n\n" + short + " " + (cta.url || "")).trim();
  }
  if (isPinterest) {
    var parts = [p.name + ". " + p.oneLiner];
    if (p.proof) parts.push(p.proof);
    parts.push((cta.text || "Learn more") + ": " + (cta.url || ""));
    return "\n\n" + parts.join(" ").trim();
  }
  if (isLinkInBio) {
    var cleanLiner = p.oneLiner.replace(/[.!?]+\s*$/, "");
    return "\n\n" + p.name + ": " + cleanLiner + ". Link in bio.";
  }
  return null;
}

function renderEmailCalloutPreviewHtml(decision) {
  if (!decision || !decision.shouldPromote || !decision.product) return "";
  var p = decision.product;
  var cta = p.cta || {};
  var prom = decision.prominence;
  var heading, body;
  if (prom === "soft") {
    heading = p.name;
    body = p.oneLiner;
  } else if (prom === "callout") {
    heading = p.name;
    body = (p.oneLiner + "\n\n" + (p.problem || "")).trim();
  } else {
    heading = "Spotlight: " + p.name;
    body = (p.oneLiner + "\n\n" + (p.problem || "") + "\n\n" + (p.proof || "")).trim();
  }
  // Render as a preview HTML block matching email-render output approximately
  return (
    '<div style="margin:24px 0;padding:24px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-family:Inter,system-ui,sans-serif">' +
    '<h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#1B2B5B">' + escHtml(heading) + '</h3>' +
    '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;white-space:pre-line">' + escHtml(body) + '</p>' +
    '<a href="' + escHtml(cta.url) + '" style="display:inline-block;padding:10px 18px;background:#1B2B5B;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">' + escHtml(cta.text || "Learn more") + '</a>' +
    '</div>'
  );
}

function renderBlogSolutionsBlock(decision) {
  if (!decision || !decision.shouldPromote || !decision.product) return "";
  var p = decision.product;
  var cta = p.cta || {};
  var prom = decision.prominence;
  var navy = "#1B2B5B";
  var teal = "#00B4D8";
  var showProof = prom === "spotlight" || prom === "callout";
  return [
    '<div style="margin: 32px 0; padding: 24px; background-color: #F8FAFC; border-left: 4px solid ' + teal + '; border-radius: 4px; font-family: Inter, system-ui, sans-serif;">',
    '<p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: ' + teal + '; text-transform: uppercase; letter-spacing: 0.5px;">How Travelgenix helps</p>',
    '<h3 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: ' + navy + ';">' + escHtml(p.name) + '</h3>',
    '<p style="margin: 0 0 ' + (showProof ? "12" : "16") + 'px 0; font-size: 16px; line-height: 1.6; color: #334155;">' + escHtml(p.oneLiner) + '</p>',
    showProof ? '<p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #64748B;">' + escHtml(p.proof) + '</p>' : '',
    '<p style="margin: 0;"><a href="' + escHtml(cta.url) + '" style="display: inline-block; padding: 10px 20px; background-color: ' + navy + '; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">' + escHtml(cta.text || "Learn more") + ' →</a></p>',
    '</div>'
  ].join("");
}

// ─────────────────────────────────────────────────────────
// AUTH (light — just session validation, no tenant check)
// ─────────────────────────────────────────────────────────

async function validateSession(req) {
  var cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) return false;
  try {
    var meRes = await fetch(ID_HOST + "/api/auth/me", {
      headers: { cookie: cookie }
    });
    if (!meRes.ok) return false;
    var data = await meRes.json();
    return data && data.ok && data.user && data.user.email;
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    var signedIn = await validateSession(req);
    if (!signedIn) return res.status(401).json({ error: "Not signed in" });

    var body = req.body || {};
    var productFields = body.productFields || {};
    var prominence = body.prominence || "callout";
    if (["soft", "callout", "spotlight"].indexOf(prominence) === -1) prominence = "callout";

    var decision = buildDecision(productFields, prominence);

    return res.status(200).json({
      ok: true,
      previews: {
        linkedinPersonal: renderSocialCloser(decision, "linkedin-personal"),
        linkedinCompany:  renderSocialCloser(decision, "linkedin-company"),
        facebook:         renderSocialCloser(decision, "facebook"),
        instagram:        renderSocialCloser(decision, "instagram"),
        twitter:          renderSocialCloser(decision, "twitter"),
        pinterest:        renderSocialCloser(decision, "pinterest"),
        tiktok:           renderSocialCloser(decision, "tiktok"),
        gbp:              renderSocialCloser(decision, "gbp"),
        emailCalloutHtml: renderEmailCalloutPreviewHtml(decision),
        blogBlockHtml:    renderBlogSolutionsBlock(decision)
      }
    });
  } catch (err) {
    console.error("content-engine-preview error:", err);
    return res.status(500).json({ error: err.message });
  }
};

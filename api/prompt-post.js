// api/prompt-post.js
//
// Single-post generator from a user-supplied prompt. Used by the
// "Create Post from Prompt" UI in the client portal.
//
// HARDENED 21 May 2026 — fully routed through lib/generation-pipeline.js
// for guardrails, prompt assembly, validation, and the auto-publish kill
// switch. Previously this file used a partially-hardened inline prompt and
// skipped validation for non-Travelgenix clients; both gaps are now closed.

var {
  buildSystemPrompt,
  callModel,
  validateAndTagPosts,
  normalizePost,
  polishPostsThroughEditor,
} = require("../lib/generation-pipeline.js");

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var PEXELS_KEY = process.env.PEXELS_KEY;

async function getClient(clientId) {
  var res = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali/" + clientId,
    { headers: { Authorization: "Bearer " + AIRTABLE_KEY } }
  );
  if (!res.ok) throw new Error("Failed to fetch client: " + res.statusText);
  return res.json();
}

async function searchImage(query, orientation) {
  if (!PEXELS_KEY) return null;
  try {
    var res = await fetch(
      "https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) +
      "&orientation=" + (orientation || "landscape") + "&per_page=1&size=large",
      { headers: { Authorization: PEXELS_KEY } }
    );
    if (!res.ok) return null;
    var data = await res.json();
    return data.photos && data.photos.length > 0
      ? (data.photos[0].src.large2x || data.photos[0].src.large)
      : null;
  } catch (e) { return null; }
}

async function checkFCDO(country) {
  if (!country || country === "General") return { safe: true };
  try {
    var slug = country.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    var res = await fetch("https://www.gov.uk/foreign-travel-advice/" + slug, { headers: { Accept: "application/json" } });
    if (!res.ok) return { safe: true };
    var data = await res.json();
    var content = JSON.stringify(data).toLowerCase();
    if (content.includes("advise against all travel")) return { safe: false, reason: "FCDO advises against all travel to " + country };
    if (content.includes("advise against all but essential travel")) return { safe: false, reason: "FCDO advises against all but essential travel to " + country };
    return { safe: true };
  } catch (e) { return { safe: true }; }
}

function getClientType(clientRecord) {
  var ct = clientRecord.fields["Client Type"];
  if (!ct) return "b2c-travel";
  var name = typeof ct === "object" ? ct.name : ct;
  return (name || "b2c-travel").toLowerCase();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var body = req.body || {};
    var clientId = body.clientId;
    var userPrompt = body.prompt;
    var saveToQueue = body.saveToQueue !== false;

    if (!clientId) return res.status(400).json({ error: "clientId is required" });
    if (!userPrompt) return res.status(400).json({ error: "prompt is required. Describe what kind of post you want." });

    var clientRecord = await getClient(clientId);
    var f = clientRecord.fields;
    var clientType = getClientType(clientRecord);
    var isB2B = clientType === "b2b-saas";

    // Build the FULL hardened system prompt via the shared pipeline. The
    // user prompt is appended as the user message so the model knows what
    // specific post to write, but the guardrails / brand voice / anti-
    // fabrication rules all come from the canonical source.
    var systemPrompt = buildSystemPrompt({
      clientFields: f,
      clientType: clientType,
      events: [],
      sparks: [],
    });

    // Append a single-post override to the system prompt so the model returns
    // ONE object, not an array. Kept short to avoid drowning the guardrails.
    //
    // MULTI-CHANNEL OVERRIDE: the weekly-batch prompt enforces "one channel,
    // one caption" because the batch spreads posts across a schedule. A
    // Composer post is one piece of content the user wants EVERYWHERE, so in
    // single-post mode we explicitly reverse that rule: write a caption for
    // every channel, each adapted to that channel's own norms and length
    // rules, and leave targetChannel empty (so the UI shows all of them and
    // publish sends each connected platform its own caption).
    var singlePostSuffix = "\n\n## SINGLE POST MODE\n\nThis request asks for ONE post, not a weekly batch. The user's specific request is in the user message. Generate exactly ONE post object. Return it as a JSON ARRAY containing that one object — same schema as the weekly batch, just one element. Do NOT return a bare object. The downstream pipeline expects a one-element array.\n\nCHANNEL OVERRIDE FOR SINGLE POST MODE — this replaces the 'one channel, one caption' rule for THIS request only: this one post will be published to ALL of the client's connected platforms, so you MUST populate ALL of these caption fields: captionLinkedIn (LinkedIn Company length/style rules apply, plus firstComment), captionFacebook, captionInstagram, captionTwitter, captionPinterest, captionTiktok, captionGBP. Adapt the SAME core message to each channel's norms and length guidance — do not paste the identical text into every field. Set targetChannel to an empty string \"\". Every other rule (voice, anti-fabrication, banned language, lengths) still applies per channel.\n";

    var userMessage = "User request: " + String(userPrompt).slice(0, 2000) +
      "\n\nGenerate ONE post matching that request. Return a JSON array containing exactly one post object. " +
      "Anti-fabrication rules in the system prompt still apply: no invented names, no invented stats, no invented quotes. " +
      "FACT PRIORITY: if any number or claim in this user request (including pasted product copy) conflicts with the verified company facts in your system prompt, the SYSTEM PROMPT facts win.";

    // Call the model through the pipeline (guardrail sentinel asserted inside)
    var rawText = await callModel({
      systemPrompt: systemPrompt + singlePostSuffix,
      userMessage: userMessage,
      // Single-post mode writes a caption for every channel (7 captions,
      // incl. a 900+ char LinkedIn one) — 2048 tokens truncated that.
      maxTokens: 4096,
      temperature: 0.7,
    });

    // Parse — accept either a single object or a one-element array
    var cleaned = (rawText || "").replace(/```json|```/g, "").trim();
    var post;
    try {
      var parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        if (!parsed.length) throw new Error("Model returned empty array");
        post = parsed[0];
      } else if (parsed && typeof parsed === "object") {
        post = parsed;
      } else {
        throw new Error("Unexpected JSON shape");
      }
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse response: " + e.message, raw: cleaned.substring(0, 500) });
    }

    // Normalize to snake_case so downstream reads work regardless of which
    // prompt convention the model followed (B2B emits camelCase, B2C snake_case).
    post = normalizePost(post);

    // Voice editor second pass (before validation, same as the batch path).
    // Never throws; on failure the original post passes through.
    try {
      var polishedSingle = await polishPostsThroughEditor([post]);
      if (polishedSingle && polishedSingle.posts && polishedSingle.posts[0]) {
        post = polishedSingle.posts[0];
        console.log("[prompt-post] Voice editor:", JSON.stringify(polishedSingle.summary));
      }
    } catch (e) {
      console.error("[prompt-post] Voice editor failed, using unedited post:", e.message);
    }

    // Run through the same validator AFTER the editor (validator has last word)
    var taggedArr = validateAndTagPosts([post]);
    var tagged = taggedArr[0];
    var validation = tagged.validation;
    var qualityIssues = tagged.qualityIssues || "";

    if (validation.severity === "fail") {
      console.warn("[prompt-post] Validator blocked: " + qualityIssues);
    }

    // Image search
    var tags = post.image_tags || [];
    var dest = post.destination || "";
    var imageQuery = (dest && dest !== "General")
      ? (tags.length > 0 ? dest + " " + tags[0] : dest + " travel")
      : (tags.length > 0 ? tags[0] + " travel" : "travel holiday");
    var imageUrl = await searchImage(imageQuery, post.image_orientation || "landscape");

    // FCDO check (B2C only)
    var fcdo = isB2B ? { safe: true } : await checkFCDO(post.destination);

    // Auto-publish gating: kill switch + client setting + validator + FCDO.
    // Validator failure and FCDO unsafe override everything else.
    var clientAutoPublish = !!f["Auto Publish"];
    var killSwitchOff = process.env.AUTO_PUBLISH_ENABLED !== "true";
    var effectiveAutoPublish = clientAutoPublish && !killSwitchOff;

    var status;
    if (validation.severity === "fail") {
      status = "Quality Hold";
    } else if (!fcdo.safe) {
      status = "Suppressed";
    } else if (effectiveAutoPublish) {
      status = "Approved";
    } else {
      status = "Queued";
    }

    if (clientAutoPublish && killSwitchOff) {
      console.warn("[prompt-post] Auto Publish set on client but AUTO_PUBLISH_ENABLED env not 'true' — forcing manual review.");
    }

    // Save to Airtable
    var savedRecord = null;
    if (saveToQueue) {
      var record = {
        fields: {
          "Post Title": (post.destination || "Custom") + " " + (post.content_type || "Post") + " - Prompt",
          "Client": [clientId],
          "Content Type": post.content_type || (isB2B ? "Thought Leadership" : "Destination Spotlight"),
          "Caption - Facebook": post.caption_facebook || "",
          "Caption - Instagram": post.caption_instagram || "",
          "Caption - LinkedIn": post.caption_linkedin || "",
          "Caption - Twitter": post.caption_twitter || "",
          "Caption - Pinterest": post.caption_pinterest || "",
          "Caption - TikTok": post.caption_tiktok || "",
          "Caption - GBP": post.caption_gbp || "",
          "Hashtags": [].concat(post.hashtags_facebook || [], post.hashtags_instagram || []).filter(function(v, i, a) { return a.indexOf(v) === i; }).join(", "),
          "CTA URL": post.cta_url || post.cta_url_facebook || "",
          "Destination": post.destination || "",
          "Scheduled Time": post.suggested_time || "09:00",
          "Status": status,
          "Suppression Reason": fcdo.safe ? "" : (fcdo.reason || ""),
          "Generated Week": "PROMPT",
          "Image URL": imageUrl || "",
          "Image Position": "50% 50%",
        }
      };

      // B2B extras
      if (isB2B) {
        if (post.target_channel) record.fields["Target Channel"] = post.target_channel;
        if (post.content_pillar) record.fields["Content Pillar"] = post.content_pillar;
        if (post.first_comment) record.fields["First Comment"] = post.first_comment;
      }

      if (qualityIssues) {
        record.fields["Quality Issues"] = qualityIssues.slice(0, 50000);
      }

      var aRes = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblbhyiuULvedva0K", {
        method: "POST",
        headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [record], typecast: true })
      });
      if (aRes.ok) {
        var aData = await aRes.json();
        savedRecord = aData.records[0];
      } else {
        console.error("[prompt-post] Airtable save failed:", (await aRes.text()).substring(0, 200));
      }
    }

    return res.status(200).json({
      success: true,
      post: post,
      image_url: imageUrl,
      fcdo_safe: fcdo.safe,
      status: status,
      validation: {
        severity: validation.severity,
        issueCount: validation.issues.length,
        report: validation.formattedReport,
      },
      autoPublishHonoured: effectiveAutoPublish,
      autoPublishKillSwitch: killSwitchOff,
      saved: !!savedRecord,
      record_id: savedRecord ? savedRecord.id : null,
      client: f["Business Name"],
      prompt: userPrompt,
    });
  } catch (err) {
    console.error("[prompt-post] error:", err);
    var msg = err && err.message ? err.message : String(err);
    return res.status(500).json({ error: msg, guardrails_failed: msg.indexOf("GUARDRAILS_MISSING") !== -1 });
  }
};

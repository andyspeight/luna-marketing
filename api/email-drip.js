// api/email-drip.js
// Drip sequence handler — Day 6.5 patch: brand guardrails + content validator.
//
// Triggered by inbound form fills on travelgenix.co.uk
// Welcome email sends instantly via transactional
// Day 3/7/14/28 follow-ups saved as Awaiting Approval drafts WITH Recipient Email set
// so the hourly cron can fire them when scheduled.
//
// PATCHED 1 May 2026 (Day 6.5):
//   - BRAND_GUARDRAILS prepended to every drip email's system prompt
//   - validateContent called on each generated body before saving
//   - Failed drafts save with status = Quality Hold (won't be sent by cron)

const Anthropic = require("@anthropic-ai/sdk").default;
const { upsertContact, sendTransactional } = require("./brevo-helper.js");
const { wrapEmail, plainToHtml, htmlToPlain } = require("./email-template.js");
const { addUtm } = require("./utm-helper.js");
const { BRAND_GUARDRAILS } = require("./brand-guardrails.js");
const { validateContent } = require("./validate-content.js");

const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const EMAIL_QUEUE_TABLE = "Email Queue";
const ATTRIBUTION_TABLE = "Attribution";
const CRON_SECRET = process.env.CRON_SECRET;

const INBOUND_LIST_ID = parseInt(process.env.BREVO_LIST_INBOUND || process.env.BREVO_LIST_INBOUND_LEADS || "0", 10);

const DRIP_SEQUENCE = [
  {
    type: "Drip - Welcome",
    delayDays: 0,
    sendImmediately: true,
    purpose: "Welcome them, set expectations, deliver the value they asked for. Confirm their request was received. Include a soft CTA to book a call if relevant.",
    ctaText: "Book a 15-minute call",
    ctaUrl: "https://travelgenix.io/demo",
  },
  {
    type: "Drip - Day 3",
    delayDays: 3,
    purpose: "Share a relevant insight about UK travel agencies. Position Andy as someone who understands their world. Don't pitch yet. Do NOT invent a specific case study or client name.",
    ctaText: "Read the full article",
    ctaUrl: "https://travelgenix.io/insights",
  },
  {
    type: "Drip - Day 7",
    delayDays: 7,
    purpose: "Soft product introduction. Show one specific thing Travelgenix does that solves a real problem. Speak generally about types of clients you've helped. Do NOT name specific clients or invent specific outcome statistics.",
    ctaText: "See it in action",
    ctaUrl: "https://travelgenix.io/demo",
  },
  {
    type: "Drip - Day 14",
    delayDays: 14,
    purpose: "Address a common objection (price, complexity, switching cost, time). Andy speaking honestly about how Travelgenix handles it. Do NOT name competitors, do NOT invent specific switching stories with named agents.",
    ctaText: "Have a quick chat",
    ctaUrl: "https://travelgenix.io/demo",
  },
  {
    type: "Drip - Day 28",
    delayDays: 28,
    purpose: "Final nudge. Acknowledge they're busy. One specific reason to act now. Offer a no-pressure 15-min call. After this, they exit the sequence.",
    ctaText: "Book a 15-min call",
    ctaUrl: "https://travelgenix.io/demo",
  },
];

async function airtableCreate(table, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable create failed: ${r.status} ${err}`);
  }
  return r.json();
}

async function generateDripBody(stepConfig, leadContext) {
  const dripPrompt = `You write a single email in a 5-email drip sequence for Travelgenix, a UK B2B travel-tech SaaS company. The email goes to someone who recently filled an inbound form on travelgenix.io.

Voice: Andy Speight (CEO). Warm, direct, knowledgeable, never pushy. UK English.

LEAD CONTEXT:
- First name: ${leadContext.firstName || "(not provided)"}
- Company: ${leadContext.company || "(not provided)"}
- They came from: ${leadContext.source || "(unknown)"}
- They said: ${leadContext.notes || "(no message)"}

EMAIL PURPOSE: ${stepConfig.purpose}

LENGTH: 80-180 words. Keep it short. One idea per email.

STRUCTURE:
1. Personal greeting (use first name if available, otherwise "Hi there,")
2. Body: 2-3 short paragraphs. Specific, useful, no fluff.
3. Sign-off: "Andy" only

CTA: ONE clear call to action at the end. Plain text — we'll wrap it as a button automatically.

OUTPUT FORMAT — return ONLY a valid JSON object, no preamble, no markdown fences:

{
  "subject": "Subject under 60 chars, personal not corporate",
  "previewText": "Preview under 130 chars, complements subject",
  "bodyMarkdown": "Hi {first_name},\\n\\nParagraph 1...\\n\\nParagraph 2...\\n\\nAndy"
}

Use \\n\\n for paragraph breaks. Do NOT include the CTA button text in bodyMarkdown.`;

  // Prepend brand guardrails
  const systemPrompt = BRAND_GUARDRAILS + "\n\n" + dripPrompt;

  const response = await aiClient.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    temperature: 0.7,
    system: systemPrompt,
    messages: [{ role: "user", content: `Write the ${stepConfig.type} email. Return ONLY the JSON.` }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  return JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }

    const leadContext = {
      email,
      firstName: body.firstName || "",
      lastName: body.lastName || "",
      company: body.company || "",
      source: body.source || "",
      notes: body.notes || "",
    };

    const created = [];
    const fullName = `${leadContext.firstName} ${leadContext.lastName}`.trim() || "";

    // 1. Add to Brevo Inbound Leads list
    if (INBOUND_LIST_ID > 0) {
      try {
        await upsertContact(
          email,
          {
            FIRSTNAME: leadContext.firstName,
            LASTNAME: leadContext.lastName,
            COMPANY: leadContext.company,
            LEAD_SOURCE: leadContext.source,
          },
          [INBOUND_LIST_ID]
        );
      } catch (e) {
        console.error("Brevo upsertContact failed:", e.message);
      }
    }

    // 2. Log the form fill in Attribution
    try {
      await airtableCreate(ATTRIBUTION_TABLE, {
        "Event ID": `lead-${email}-${Date.now()}`,
        "Event Type": "KB Conversation",
        "Event Date": new Date().toISOString(),
        "UTM Source": body.utmSource || "",
        "UTM Medium": body.utmMedium || "",
        "UTM Campaign": body.utmCampaign || "",
        "UTM Content": body.utmContent || "",
        "Identifier": email,
        "Notes": `Form fill from ${leadContext.source}. ${leadContext.notes}`.slice(0, 500),
      });
    } catch (e) {
      console.error("Attribution log failed:", e.message);
    }

    // 3. Generate all 5 drip emails (with guardrails + validation)
    const now = new Date();

    for (const step of DRIP_SEQUENCE) {
      try {
        const draft = await generateDripBody(step, leadContext);

        const ctaUrl = addUtm(step.ctaUrl, {
          source: "email",
          medium: "drip",
          campaign: "luna_marketing",
          content: step.type.toLowerCase().replace(/\s+/g, "_"),
        });

        const bodyMd = (draft.bodyMarkdown || "")
          .replace(/\{first_name\}/g, leadContext.firstName || "there");

        const html = wrapEmail({
          subject: draft.subject,
          previewText: draft.previewText,
          bodyHtml: plainToHtml(bodyMd),
          headline: draft.subject,
          ctaText: step.ctaText,
          ctaUrl,
        });

        const plain = htmlToPlain(html);

        // VALIDATE drip body + subject
        const validationText = `${draft.subject || ""}\n\n${plain}`;
        const validation = validateContent(validationText);
        const validatorBlocked = validation.severity === "fail";
        let qualityIssues = "";
        if (validation.severity !== "pass") {
          qualityIssues = validation.issues.map(i => `${i.severity.toUpperCase()} ${i.code}: ${i.detail}`).join("\n");
        }

        const scheduled = new Date(now);
        scheduled.setDate(scheduled.getDate() + step.delayDays);

        if (step.sendImmediately && !validatorBlocked) {
          // Welcome email: send NOW via transactional
          try {
            await sendTransactional({
              to: [{ email, name: fullName || email }],
              subject: draft.subject,
              htmlContent: html,
              textContent: plain,
              tags: ["luna-marketing", step.type],
            });

            const saved = await airtableCreate(EMAIL_QUEUE_TABLE, {
              "Subject": draft.subject,
              "Email Type": step.type,
              "Audience Segment": "Specific Person",
              "Body HTML": html,
              "Body Plain": plain,
              "Preview Text": draft.previewText || "",
              "Status": "Sent",
              "Sent At": now.toISOString(),
              "Recipient Email": email,
              "Recipient Name": fullName,
              ...(qualityIssues ? { "Rejection Reason": "WARNINGS: " + qualityIssues.slice(0, 500) } : {}),
            });
            created.push({ step: step.type, status: "sent", recordId: saved.records[0].id });
          } catch (e) {
            console.error(`Welcome send failed for ${email}:`, e.message);
            const saved = await airtableCreate(EMAIL_QUEUE_TABLE, {
              "Subject": draft.subject,
              "Email Type": step.type,
              "Audience Segment": "Specific Person",
              "Body HTML": html,
              "Body Plain": plain,
              "Preview Text": draft.previewText || "",
              "Status": "Failed",
              "Recipient Email": email,
              "Recipient Name": fullName,
              "Rejection Reason": `Welcome send error: ${e.message}`.slice(0, 500),
            });
            created.push({ step: step.type, status: "failed", recordId: saved.records[0].id, error: e.message });
          }
        } else {
          // Save as Awaiting Approval (or Quality Hold if validator blocked).
          // Setting status = Quality Hold means email-cron.js will NOT send it
          // (the cron filters on Status='Approved').
          const status = validatorBlocked ? "Quality Hold" : "Awaiting Approval";
          const saved = await airtableCreate(EMAIL_QUEUE_TABLE, {
            "Subject": draft.subject,
            "Email Type": step.type,
            "Audience Segment": "Specific Person",
            "Body HTML": html,
            "Body Plain": plain,
            "Preview Text": draft.previewText || "",
            "Status": status,
            "Scheduled Send": scheduled.toISOString(),
            "Recipient Email": email,
            "Recipient Name": fullName,
            ...(qualityIssues ? { "Rejection Reason": qualityIssues.slice(0, 500) } : {}),
          });
          created.push({
            step: step.type,
            status: validatorBlocked ? "quality_hold" : "drafted",
            recordId: saved.records[0].id,
            scheduledSend: scheduled.toISOString(),
            ...(qualityIssues ? { issues: qualityIssues } : {}),
          });
        }
      } catch (e) {
        console.error(`Drip step ${step.type} failed:`, e.message);
        created.push({ step: step.type, status: "error", error: e.message });
      }
    }

    return res.status(200).json({
      success: true,
      email,
      sequence: created,
      message: `Drip sequence kicked off for ${email}. Welcome sent. ${created.filter(c => c.status === "drafted").length} follow-ups awaiting approval, ${created.filter(c => c.status === "quality_hold").length} on quality hold.`,
    });
  } catch (e) {
    console.error("Drip handler failed:", e);
    return res.status(500).json({ error: e.message });
  }
};

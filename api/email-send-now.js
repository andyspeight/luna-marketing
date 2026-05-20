// api/email-send-now.js
// Day B — Email Suite v1
//
// Manually sends an Approved email immediately via Brevo's transactional API.
// Bypasses the cron (which is paused).
//
// IMPORTANT for Day B v1:
// - Only supports SINGLE-RECIPIENT sends (Recipient Email must be set)
// - Audience-based list sends are deferred to Day C
// - This sends real email to real people. Use carefully.
//
// POST /api/email-send-now
// Body: { clientId, emailId }
//
// Returns: { success, brevoMessageId, sentAt }

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || "Travelgenix";
// Fallback sender used when the client record has no valid Reply To Email.
// resolveSender() prefers the client's configured sender, falls back to this.
const SENDER_EMAIL_FALLBACK = "andy.speight@agendas.group";

// Test send limit — guards against accidental "I pasted my whole address book"
// mistakes. 20 is plenty for QA, low enough to keep blast-radius small.
const TEST_SEND_MAX_RECIPIENTS = 20;

const CLIENTS_TABLE = "Clients";
const EMAIL_QUEUE_TABLE = "Email Queue";
const AUDIT_LOG_TABLE = "Audit Log";

// Resolve a sender { email, name } from the client record. Falls back to the
// hardcoded constant if the client hasn't set a valid Reply To Email.
// This is called for both real sends and test sends.
function resolveSender(client) {
  const replyTo = (client && client["Reply To Email"]) || "";
  const senderName = (client && (client["Sender Name"] || client["Business Name"])) || BREVO_SENDER_NAME;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) ? replyTo : SENDER_EMAIL_FALLBACK;
  return { email, name: senderName };
}

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error ${r.status}: ${err}`);
  }
  return r.json();
}

async function authenticateClient(clientId) {
  if (!clientId || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(CLIENTS_TABLE)}/${clientId}`;
  try {
    const data = await airtableFetch(url);
    if (!data || !data.fields) return null;
    const clientType = (data.fields["Client Type"] || "").toLowerCase();
    if (clientType !== "b2b-saas") return null;
    return { id: data.id, ...data.fields };
  } catch {
    return null;
  }
}

async function getEmail(emailId) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  return airtableFetch(url);
}

async function patchEmail(emailId, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  return airtableFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  });
}

async function writeAuditLog({ actor, action, subjectId, details, ip }) {
  const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`;
  try {
    await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        records: [{
          fields: {
            "Event ID": eventId,
            "Timestamp": new Date().toISOString(),
            "Actor": actor || "system",
            "Action": action,
            "Subject Type": "email",
            "Subject ID": subjectId,
            "Details": typeof details === "string" ? details : JSON.stringify(details),
            "IP": ip || "",
          },
        }],
        typecast: true,
      }),
    });
  } catch (e) {
    console.error("Audit log write failed:", e.message);
  }
}

async function sendViaBrevo({ sender, to, toName, subject, htmlContent, textContent, replyTo, tags }) {
  const url = "https://api.brevo.com/v3/smtp/email";

  // Brevo requires non-empty textContent. Auto-generate from HTML if missing.
  let finalText = (textContent || "").trim();
  if (!finalText && htmlContent) {
    finalText = htmlContent
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  // Last-resort fallback: Brevo will not accept empty textContent
  if (!finalText) finalText = subject || "(no content)";
  // Sender comes from resolveSender(client) — pulls from client record's
  // Reply To Email + Sender Name fields, falls back to SENDER_EMAIL_FALLBACK.
  const senderPayload = sender && sender.email
    ? { email: sender.email, name: sender.name || BREVO_SENDER_NAME }
    : { email: SENDER_EMAIL_FALLBACK, name: BREVO_SENDER_NAME };
  const payload = {
    sender: senderPayload,
    to: [{ email: to, ...(toName ? { name: toName } : {}) }],
    subject: subject,
    htmlContent: htmlContent || `<p>${finalText}</p>`,
    textContent: finalText,
    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    ...(tags && tags.length ? { tags } : {}),
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(`Brevo API error ${r.status}: ${data.message || JSON.stringify(data)}`);
  }

  // Brevo returns { messageId: "<...@smtp-relay.mailin.fr>" }
  return {
    messageId: data.messageId || "",
    raw: data,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    if (!BREVO_API_KEY) {
      return res.status(503).json({ error: "Brevo API key not configured" });
    }

    const body = req.body || {};
    const { clientId, emailId, testRecipients } = body;

    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!emailId) return res.status(400).json({ error: "emailId required" });

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    const actor = client["Business Name"] || "client-portal";
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.connection?.remoteAddress
      || "";

    // Load the email
    const emailRec = await getEmail(emailId);
    if (!emailRec) return res.status(404).json({ error: "Email not found" });

    const f = emailRec.fields;

    if (!f["Subject"]) {
      return res.status(400).json({ error: "Email has no subject" });
    }

    // ─────────────────────────────────────────────────────────────
    // TEST SEND MODE — sends to a comma-delimited list of QA recipients
    // without changing the email record's Status. Works on any status
    // (Draft, Awaiting Approval, Quality Hold, Approved, Sent). The
    // subject is prefixed [TEST] so recipients know it's not the real
    // send. Each recipient gets a separate Brevo transactional call.
    // ─────────────────────────────────────────────────────────────
    const isTestSend = Array.isArray(testRecipients) && testRecipients.length > 0;
    if (isTestSend) {
      // Validate, lowercase, dedupe
      const cleaned = [...new Set(
        testRecipients
          .map(e => String(e).trim().toLowerCase())
          .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      )];
      if (cleaned.length === 0) {
        return res.status(400).json({ error: "No valid email addresses in testRecipients" });
      }
      if (cleaned.length > TEST_SEND_MAX_RECIPIENTS) {
        return res.status(400).json({
          error: `Test send limited to ${TEST_SEND_MAX_RECIPIENTS} recipients per batch (got ${cleaned.length})`,
        });
      }

      const sender = resolveSender(client);
      const sentResults = [];
      const failures = [];

      for (const recipient of cleaned) {
        try {
          const r = await sendViaBrevo({
            sender,
            to: recipient,
            toName: "",
            subject: `[TEST] ${f["Subject"]}`,
            htmlContent: f["Body HTML"] || "",
            textContent: f["Body Plain"] || "",
            replyTo: sender.email,
            tags: ["luna-marketing", "test-send", `audience:${f["Audience"] || "unknown"}`],
          });
          sentResults.push({ recipient, messageId: r.messageId });
        } catch (sendErr) {
          failures.push({ recipient, error: sendErr.message });
        }
      }

      // Record the test on the email, do NOT change Status
      try {
        await patchEmail(emailId, {
          "Last Test Sent At": new Date().toISOString(),
          "Last Test Recipients": cleaned.join(", "),
        });
      } catch (patchErr) {
        // Non-fatal — the send already happened. Log and continue.
        console.error("[EMAIL-TEST] patch failed:", patchErr.message);
      }

      await writeAuditLog({
        actor,
        action: "test-send",
        subjectId: emailId,
        details: {
          sent: sentResults.length,
          failed: failures.length,
          recipients: cleaned,
          sender: sender.email,
          failures: failures.map(x => `${x.recipient}: ${x.error}`),
        },
        ip,
      });

      return res.status(200).json({
        success: true,
        mode: "test",
        sent: sentResults.length,
        failed: failures.length,
        results: sentResults,
        failures,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // REAL SEND MODE — single recipient, requires Approved status
    // ─────────────────────────────────────────────────────────────

    // Defensive checks
    if (f["Status"] !== "Approved") {
      return res.status(400).json({
        error: `Cannot send email with status "${f["Status"]}". Must be "Approved".`,
      });
    }

    // Day B v1 limit: single-recipient only
    const recipientEmail = f["Recipient Email"];
    if (!recipientEmail) {
      return res.status(400).json({
        error: "Day B v1 supports single-recipient sends only. Set Recipient Email on the email record. List/audience sends will be added in Day C.",
      });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ error: "Recipient Email is not a valid email address" });
    }

    const realSender = resolveSender(client);

    // Send via Brevo
    let result;
    try {
      result = await sendViaBrevo({
        sender: realSender,
        to: recipientEmail,
        toName: f["Recipient Name"] || "",
        subject: f["Subject"],
        htmlContent: f["Body HTML"] || "",
        textContent: f["Body Plain"] || "",
        replyTo: realSender.email,
        tags: ["luna-marketing", `audience:${f["Audience"] || "unknown"}`],
      });
    } catch (sendErr) {
      // Mark as Failed in Airtable
      await patchEmail(emailId, {
        "Status": "Failed",
        "Send Result": "Failed",
      });
      await writeAuditLog({
        actor,
        action: "send",
        subjectId: emailId,
        details: { result: "failed", error: sendErr.message, recipient: recipientEmail },
        ip,
      });
      return res.status(502).json({
        error: "Send failed",
        detail: sendErr.message,
      });
    }

    // Update the record with success
    const sentAt = new Date().toISOString();
    await patchEmail(emailId, {
      "Status": "Sent",
      "Send Result": "Sent",
      "Sent At": sentAt,
      "Brevo Message ID": result.messageId || "",
      "Recipients Count": 1,
    });

    // Audit log
    await writeAuditLog({
      actor,
      action: "send",
      subjectId: emailId,
      details: {
        result: "sent",
        recipient: recipientEmail,
        messageId: result.messageId,
        method: "transactional-immediate",
      },
      ip,
    });

    return res.status(200).json({
      success: true,
      emailId,
      brevoMessageId: result.messageId,
      sentAt,
      recipient: recipientEmail,
    });
  } catch (e) {
    console.error("Email send-now error:", e);
    return res.status(500).json({ error: e.message });
  }
};

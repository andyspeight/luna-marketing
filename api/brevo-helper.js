// api/brevo-helper.js
// Brevo (Sendinblue) API wrapper for Luna Marketing
// Handles: transactional sends, contacts, lists, marketing campaigns, stats pull-back

const BREVO_KEY = process.env.BREVO_API_KEY;
const BREVO_BASE = "https://api.brevo.com/v3";

// Default sender. Override per-call if needed.
const DEFAULT_SENDER = {
  name: process.env.BREVO_SENDER_NAME || "Andy Speight",
  email: process.env.BREVO_SENDER_EMAIL || "andy.speight@agendas.group",
};

function brevoHeaders() {
  return {
    "api-key": BREVO_KEY,
    "Content-Type": "application/json",
    "accept": "application/json",
  };
}

async function brevoFetch(path, options = {}) {
  const url = `${BREVO_BASE}${path}`;
  const res = await fetch(url, {
    headers: brevoHeaders(),
    ...options,
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo ${path} failed: ${res.status} ${errText.slice(0, 300)}`);
  }
  
  // Some endpoints return 204 with no body
  if (res.status === 204) return {};
  
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

// ── Transactional emails (one-off, instant sends) ──
// Used for: drip emails to specific contacts, behavioural triggers, internal notifications

/**
 * Send a transactional email to one or more recipients.
 * @param {object} args
 * @param {Array<{email, name?}>} args.to - Recipients
 * @param {string} args.subject
 * @param {string} args.htmlContent - Full HTML body
 * @param {string} [args.textContent] - Plain text fallback
 * @param {object} [args.sender] - Override default sender
 * @param {string} [args.replyTo]
 * @param {object} [args.params] - Variables for template tags
 * @param {Array<string>} [args.tags] - Tags for filtering in Brevo dashboard
 * @returns {Promise<{messageId}>}
 */
async function sendTransactional(args) {
  const body = {
    sender: args.sender || DEFAULT_SENDER,
    to: args.to,
    subject: args.subject,
    htmlContent: args.htmlContent,
  };
  if (args.textContent) body.textContent = args.textContent;
  if (args.replyTo) body.replyTo = { email: args.replyTo };
  if (args.params) body.params = args.params;
  if (args.tags && args.tags.length) body.tags = args.tags;
  
  return brevoFetch("/smtp/email", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Contacts management ──

/**
 * Create or update a contact (idempotent).
 * @param {string} email
 * @param {object} [attributes] - Custom attributes (FIRSTNAME, COMPANY, etc)
 * @param {Array<number>} [listIds] - List IDs to add the contact to
 */
async function upsertContact(email, attributes = {}, listIds = []) {
  const body = {
    email,
    attributes,
    updateEnabled: true,
  };
  if (listIds.length) body.listIds = listIds;
  
  return brevoFetch("/contacts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function addContactToList(email, listId) {
  return brevoFetch(`/contacts/lists/${listId}/contacts/add`, {
    method: "POST",
    body: JSON.stringify({ emails: [email] }),
  });
}

async function removeContactFromList(email, listId) {
  return brevoFetch(`/contacts/lists/${listId}/contacts/remove`, {
    method: "POST",
    body: JSON.stringify({ emails: [email] }),
  });
}

async function getContact(email) {
  // Brevo accepts both email and contact ID
  const encoded = encodeURIComponent(email);
  return brevoFetch(`/contacts/${encoded}`);
}

// ── Lists ──

async function listLists() {
  return brevoFetch("/contacts/lists?limit=50&offset=0");
}

async function getListContactsCount(listId) {
  const data = await brevoFetch(`/contacts/lists/${listId}`);
  return data.totalSubscribers || 0;
}

// ── Email campaigns (newsletters, broadcasts) ──

/**
 * Create a draft email campaign.
 * @param {object} args
 * @param {string} args.name - Internal campaign name
 * @param {string} args.subject
 * @param {string} args.htmlContent
 * @param {string} [args.previewText]
 * @param {Array<number>} args.listIds - Recipient lists
 * @param {object} [args.sender]
 * @param {string} [args.scheduledAt] - ISO string for scheduled send. Omit for draft only.
 */
async function createCampaign(args) {
  const body = {
    name: args.name,
    subject: args.subject,
    sender: args.sender || DEFAULT_SENDER,
    htmlContent: args.htmlContent,
    recipients: { listIds: args.listIds },
    type: "classic",
  };
  if (args.previewText) body.previewText = args.previewText;
  if (args.scheduledAt) body.scheduledAt = args.scheduledAt;
  
  return brevoFetch("/emailCampaigns", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function sendCampaignNow(campaignId) {
  return brevoFetch(`/emailCampaigns/${campaignId}/sendNow`, {
    method: "POST",
  });
}

async function getCampaign(campaignId) {
  return brevoFetch(`/emailCampaigns/${campaignId}`);
}

async function getCampaignStats(campaignId) {
  const data = await brevoFetch(`/emailCampaigns/${campaignId}`);
  // Brevo returns statistics in `statistics.globalStats`
  const stats = (data.statistics && data.statistics.globalStats) || {};
  return {
    sent: stats.sent || 0,
    delivered: stats.delivered || 0,
    opens: stats.uniqueViews || stats.viewed || 0,
    clicks: stats.uniqueClicks || stats.clickers || 0,
    unsubscribed: stats.unsubscriptions ? (stats.unsubscriptions.userUnsubscription || 0) : 0,
    softBounces: stats.softBounces || 0,
    hardBounces: stats.hardBounces || 0,
    raw: stats,
  };
}

module.exports = {
  brevoFetch,
  sendTransactional,
  upsertContact,
  addContactToList,
  removeContactFromList,
  getContact,
  listLists,
  getListContactsCount,
  createCampaign,
  sendCampaignNow,
  getCampaign,
  getCampaignStats,
  DEFAULT_SENDER,
};

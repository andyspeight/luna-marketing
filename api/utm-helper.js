// api/utm-helper.js
// Shared UTM tagging logic. Inject UTM params into any URL.
// Used by cron-generate.js and prompt-post.js to ensure every link going out is tracked.

// Map Airtable target channel / Metricool network to UTM source
const UTM_SOURCE_MAP = {
  // Cron-generate target channels (B2B)
  "LinkedIn Personal": "linkedin",
  "LinkedIn Company": "linkedin-company",
  "Facebook": "facebook",
  "Instagram": "instagram",
  "Twitter/X": "twitter",
  "TikTok": "tiktok",
  "Pinterest": "pinterest",
  "Google Business Profile": "gbp",
  // Lower-case fallbacks
  "linkedin personal": "linkedin",
  "linkedin company": "linkedin-company",
  "facebook": "facebook",
  "instagram": "instagram",
  "twitter": "twitter",
  "twitter/x": "twitter",
  "x": "twitter",
  "tiktok": "tiktok",
  "pinterest": "pinterest",
  "google business profile": "gbp",
  "gbp": "gbp",
};

/**
 * Add UTM parameters to a URL.
 * If the URL already has UTM params they are overwritten.
 * If the URL is empty, returns empty string.
 *
 * @param {string} url - The original URL (may already have query params)
 * @param {object} params - UTM parameters
 * @param {string} params.source - utm_source (e.g. "linkedin")
 * @param {string} params.medium - utm_medium (e.g. "social", "email")
 * @param {string} params.campaign - utm_campaign (e.g. "luna_marketing")
 * @param {string} [params.content] - utm_content (e.g. "post-recXXX")
 * @param {string} [params.term] - utm_term (optional)
 * @returns {string} The URL with UTM params appended
 */
function addUtm(url, params) {
  if (!url) return "";
  
  // Don't tag mailto: or tel: links
  if (/^(mailto:|tel:|sms:)/i.test(url)) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    // Not a valid URL — return as-is rather than crash
    return url;
  }

  const utmFields = {
    utm_source: params.source,
    utm_medium: params.medium || "social",
    utm_campaign: params.campaign || "luna_marketing",
    utm_content: params.content,
    utm_term: params.term,
  };

  for (const [key, value] of Object.entries(utmFields)) {
    if (value) {
      parsed.searchParams.set(key, String(value));
    }
  }

  return parsed.toString();
}

/**
 * Resolve a Metricool network or Airtable target channel name to a utm_source.
 */
function channelToUtmSource(channel) {
  if (!channel) return "social";
  const normalised = (typeof channel === "object" ? channel.name : channel) || "";
  return UTM_SOURCE_MAP[normalised] || UTM_SOURCE_MAP[normalised.toLowerCase()] || "social";
}

/**
 * Generate a utm_content value for a post.
 * Uses the Airtable record ID where available, falls back to a slug.
 */
function postUtmContent(postId, postTitle) {
  if (postId) return `post-${postId}`;
  if (postTitle) {
    return "post-" + postTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }
  return "post-unknown";
}

/**
 * Tag every URL across all platform captions for a single post.
 * Mutates a copy of the post object — returns the new version.
 *
 * For B2B posts: each platform caption has the same CTA URL but tagged with
 * a different utm_source matching that platform.
 */
function tagPostUrls(post, postId, options = {}) {
  const campaign = options.campaign || "luna_marketing";
  const tagged = { ...post };
  
  // Per-platform caption tagging.
  // We replace any plain URL in the caption with a UTM-tagged version.
  // For the CTA URL itself, we tag once per platform variant.
  
  const captionFieldToSource = {
    captionFacebook: "facebook",
    captionInstagram: "instagram",
    captionLinkedIn: "linkedin", // default — will be overridden by targetChannel for B2B
    captionTwitter: "twitter",
    captionPinterest: "pinterest",
    captionTikTok: "tiktok",
    captionGBP: "gbp",
  };
  
  // For B2B posts with a specific targetChannel, the LinkedIn source should reflect it
  if (post.targetChannel) {
    const tcSource = channelToUtmSource(post.targetChannel);
    captionFieldToSource.captionLinkedIn = tcSource;
  }
  
  const baseCtaUrl = post.ctaUrl || "";
  const content = postUtmContent(postId, post.postTitle);
  
  // Tag the main ctaUrl with the *primary* platform — for B2B that's targetChannel,
  // for B2C we default to "social" which means we'll re-tag inline below.
  // Best approach: leave ctaUrl as the primary canonical version, and tag inline URLs in captions per-platform.
  if (baseCtaUrl) {
    const primarySource = post.targetChannel
      ? channelToUtmSource(post.targetChannel)
      : "social";
    tagged.ctaUrl = addUtm(baseCtaUrl, {
      source: primarySource,
      medium: "social",
      campaign,
      content,
    });
  }
  
  // Walk each caption and replace any inline URL with a platform-tagged variant
  for (const [field, source] of Object.entries(captionFieldToSource)) {
    if (post[field] && typeof post[field] === "string") {
      tagged[field] = replaceUrlsInText(post[field], {
        source,
        medium: "social",
        campaign,
        content,
      });
    }
  }
  
  // First Comment (LinkedIn) — tag any URLs there too with the LinkedIn source
  if (post.firstComment && typeof post.firstComment === "string") {
    const liSource = post.targetChannel
      ? channelToUtmSource(post.targetChannel)
      : "linkedin";
    tagged.firstComment = replaceUrlsInText(post.firstComment, {
      source: liSource,
      medium: "social",
      campaign,
      content,
    });
  }
  
  return tagged;
}

/**
 * Replace every URL in a block of text with a UTM-tagged version.
 */
function replaceUrlsInText(text, params) {
  if (!text) return text;
  // Match http(s) URLs. We're deliberately permissive — UTM tagging is idempotent.
  const urlRegex = /https?:\/\/[^\s<>"]+/gi;
  return text.replace(urlRegex, (url) => {
    // Strip trailing punctuation that's almost certainly not part of the URL
    const trailing = url.match(/[.,;:!?)\]]+$/);
    let cleanUrl = url;
    let suffix = "";
    if (trailing) {
      cleanUrl = url.slice(0, -trailing[0].length);
      suffix = trailing[0];
    }
    return addUtm(cleanUrl, params) + suffix;
  });
}

module.exports = {
  addUtm,
  channelToUtmSource,
  postUtmContent,
  tagPostUrls,
  replaceUrlsInText,
};

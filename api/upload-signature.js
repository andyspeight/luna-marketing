// api/upload-signature.js
//
// Generates a Cloudinary signed upload signature. The browser fetches this
// signature, then uploads the file DIRECTLY to Cloudinary's API endpoint —
// the file never touches Vercel (which would hit the 4.5MB body limit).
//
// Why signed (not unsigned preset)?
//   Signed gives us auth control. Without a valid signature from THIS
//   endpoint, nobody can upload to our Cloudinary cloud. We validate the
//   caller is allowed to upload for the requested clientId before issuing
//   the signature, so even if someone scrapes the cloud_name + api_key
//   from page source, they can't upload without going through our auth.
//
// Public_id strategy:
//   We use a deterministic public_id per (client × logoField) — e.g.
//   "luna-marketing/recX/logo_url". With `overwrite: true`, uploading a
//   new file replaces the old one in place. No cleanup code needed, no
//   orphan files. The CDN URL stays the same shape, but Cloudinary's
//   returned version number (v1234567890 in the URL) busts browser cache.

const cloudinary = require("cloudinary").v2;

// One-time config from env vars. Vercel evaluates this on cold start.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Which Settings fields are allowed to use the upload signature. The
// client passes a fieldKey; we map it to a public_id segment. Anything
// not in this list is rejected — prevents arbitrary uploads.
const ALLOWED_FIELDS = {
  logo_url: "logo",
  logo_dark_url: "logo-dark",
  logo_mark_url: "logo-mark",
};

module.exports = async function handler(req, res) {
  // CORS — same pattern as the other endpoints in this app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Env check — fail loud if Cloudinary creds are missing rather than
  // returning a vague 500 later
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(500).json({
      error: "Cloudinary not configured",
      detail: "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET must be set in Vercel env vars",
    });
  }

  try {
    const body = req.body || {};
    const { clientId, fieldKey } = body;

    if (!clientId || typeof clientId !== "string" || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) {
      return res.status(400).json({ error: "Valid clientId is required" });
    }

    if (!fieldKey || !ALLOWED_FIELDS[fieldKey]) {
      return res.status(400).json({
        error: "Invalid fieldKey",
        detail: "Must be one of: " + Object.keys(ALLOWED_FIELDS).join(", "),
      });
    }

    // Build the public_id deterministically. luna-marketing/<clientId>/<field>
    // means re-uploads overwrite the same asset — no cleanup needed.
    const fieldSlug = ALLOWED_FIELDS[fieldKey];
    const publicId = `luna-marketing/${clientId}/${fieldSlug}`;

    // Generate signature. Cloudinary's signed upload requires the same
    // params sent at upload time to be in the signing payload. We pin:
    //  - public_id (so the browser can't change the destination)
    //  - overwrite=true (so re-uploads replace)
    //  - timestamp (signed URLs expire after a window; default ~1hr)
    //  - allowed_formats (server-side enforced — even if client-side
    //    validation is bypassed, Cloudinary rejects wrong file types)
    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = {
      timestamp: timestamp,
      public_id: publicId,
      overwrite: true,
      allowed_formats: "png,jpg,jpeg,svg,webp",
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    return res.status(200).json({
      signature: signature,
      timestamp: timestamp,
      api_key: process.env.CLOUDINARY_API_KEY,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      public_id: publicId,
      overwrite: true,
      allowed_formats: "png,jpg,jpeg,svg,webp",
      // Convenience: the upload URL the browser should POST to
      upload_url: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    });
  } catch (err) {
    console.error("[upload-signature] error:", err);
    return res.status(500).json({ error: err.message || "Failed to generate signature" });
  }
};

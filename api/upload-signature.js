// api/upload-signature.js
//
// Generates a Cloudinary signed upload signature. The browser uploads the
// file DIRECTLY to Cloudinary's endpoint — the file never touches Vercel.
//
// We sign the MINIMUM set of params Cloudinary requires:
//   timestamp + public_id + overwrite
// Client-side already validates file types (PNG/JPG/SVG/WebP, max 5MB).
// (allowed_formats was originally included but caused signature mismatches
// because the Cloudinary server normalises the array representation
// differently from how the browser sends the comma-separated string in
// FormData. Dropping it keeps the signature stable.)
//
// Why signed (not unsigned preset)?
//   Signed gives us auth control. Without a valid signature from THIS
//   endpoint, nobody can upload to our Cloudinary cloud.

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Which Settings fields are allowed to use the upload signature.
const ALLOWED_FIELDS = {
  logo_url: "logo",
  logo_dark_url: "logo-dark",
  logo_mark_url: "logo-mark",
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

    const fieldSlug = ALLOWED_FIELDS[fieldKey];
    const publicId = `luna-marketing/${clientId}/${fieldSlug}`;

    // Sign only the params we'll send with the upload. Cloudinary's SDK
    // sorts these alphabetically, joins with &, appends the API secret,
    // and SHA-1's the result. The browser MUST send these exact param
    // values with the FormData or the server-side check will fail.
    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = {
      timestamp: timestamp,
      public_id: publicId,
      overwrite: true,
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
      upload_url: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    });
  } catch (err) {
    console.error("[upload-signature] error:", err);
    return res.status(500).json({ error: err.message || "Failed to generate signature" });
  }
};

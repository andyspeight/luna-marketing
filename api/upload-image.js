// api/upload-image.js
//
// Image upload endpoint for the email builder. Accepts a multipart/form-data
// POST containing a file, validates it, uploads to Vercel Blob via REST,
// returns the public URL.
//
// Security gates (in order):
//   1. Auth header check (Bearer b2b-saas) — same pattern as other endpoints
//   2. Method check (POST only)
//   3. Content-Type check (multipart/form-data)
//   4. Size check (max 4MB)
//   5. MIME type check against an allow-list (image/* only)
//   6. Magic-number check on the first bytes — defends against renamed files
//      e.g. an .html file with .jpg extension claiming image/jpeg
//
// On success returns { url, size, mimeType, originalName }.
// On failure returns { error: "..." } with appropriate HTTP status.
//
// Storage layout in Blob:
//   email-images/YYYY-MM-DD/<random>-<safe-original-name>.<ext>
// Date-bucketed for easier orphan cleanup later.
//
// Reference: Vercel Blob REST API
//   PUT https://blob.vercel-storage.com/{pathname}
//   Authorization: Bearer <BLOB_READ_WRITE_TOKEN>
//   x-api-blob-token-type: read-write
//   x-content-type: <mime>

const MAX_BYTES = 4 * 1024 * 1024;  // 4MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// Magic-number signatures for the four allowed image types.
// First 12 bytes are enough for all of these.
function detectMagic(bytes) {
  if (bytes.length < 4) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  // GIF: 47 49 46 38 (GIF8 — GIF87a or GIF89a)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  // WEBP: starts with "RIFF" (52 49 46 46), then 4 bytes of size, then "WEBP" (57 45 42 50)
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

// Sanitise the original filename for use in a Blob path. Strips path
// traversal, control chars, etc. Keeps it readable.
function safeName(name) {
  if (!name || typeof name !== "string") return "image";
  const base = name
    .replace(/^.*[\\/]/, "")             // strip path
    .replace(/[^a-zA-Z0-9._-]/g, "-")    // safe chars only
    .replace(/-+/g, "-")                 // collapse dashes
    .replace(/^-+|-+$/g, "")             // trim dashes
    .slice(0, 80);                       // cap length
  return base || "image";
}

// Extension to use in the stored filename, derived from the validated MIME.
// We don't trust the user's extension — we derive from sniffed magic.
function extForMime(mime) {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/gif":  return "gif";
    case "image/webp": return "webp";
    default:           return "bin";
  }
}

// Random suffix to prevent collisions when two users upload "photo.jpg"
// at the same time. 8 hex chars = 32 bits of entropy, plenty for this.
function randomSuffix() {
  const bytes = new Uint8Array(4);
  // crypto.getRandomValues exists in Node 19+ (and Edge). Fallback to Math.random.
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Build the storage pathname for the uploaded file.
function buildPathname(originalName, mime) {
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const safeBase = safeName(originalName).replace(/\.[^.]+$/, "");  // strip ext
  const ext = extForMime(mime);
  const suffix = randomSuffix();
  return `email-images/${today}/${suffix}-${safeBase}.${ext}`;
}

// Read a streamed request into a Buffer. Used because Vercel Edge runtime
// doesn't have native form parsing — we get the raw bytes and parse the
// multipart boundary ourselves. Returns { buffer, contentType }.
async function readRequestBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    total += chunk.length;
    // Hard cap during streaming — fail fast if someone sends a massive file.
    // Add some slack (256KB) for multipart boundary overhead.
    if (total > MAX_BYTES + 256 * 1024) {
      const err = new Error("File too large");
      err.code = "TOO_LARGE";
      throw err;
    }
  }
  return Buffer.concat(chunks);
}

// Minimal multipart/form-data parser — pulls the first file field out.
// We only support a single file upload per request; if multiple fields
// are present, the first file wins.
//
// Returns { filename, mimeType, content } or null if no file found.
function parseMultipart(rawBody, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || "");
  if (!boundaryMatch) return null;
  const boundary = "--" + (boundaryMatch[1] || boundaryMatch[2]).trim();
  const boundaryBuf = Buffer.from(boundary);

  // Find each part separated by boundary lines.
  let pos = rawBody.indexOf(boundaryBuf);
  while (pos !== -1) {
    const nextStart = pos + boundaryBuf.length;
    const nextBoundary = rawBody.indexOf(boundaryBuf, nextStart);
    if (nextBoundary === -1) break;

    // The part body is between nextStart (after \r\n) and nextBoundary (before \r\n)
    const partRaw = rawBody.slice(nextStart, nextBoundary);

    // Split header from body on the first \r\n\r\n
    const headerEnd = partRaw.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = partRaw.slice(0, headerEnd).toString("utf8");
      // We only care about parts with a filename — that's the file upload.
      const dispoMatch = /Content-Disposition:.*filename="([^"]*)"/i.exec(headerText);
      if (dispoMatch && dispoMatch[1]) {
        const filename = dispoMatch[1];
        const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
        const mimeType = mimeMatch ? mimeMatch[1].trim().toLowerCase() : "application/octet-stream";
        // Body is everything after the \r\n\r\n until \r\n before the next boundary
        let body = partRaw.slice(headerEnd + 4);
        // Trim trailing \r\n that precedes the next boundary
        if (body.length >= 2 && body[body.length - 2] === 0x0D && body[body.length - 1] === 0x0A) {
          body = body.slice(0, -2);
        }
        return { filename, mimeType, content: body };
      }
    }
    pos = nextBoundary;
  }
  return null;
}

module.exports = async (req, res) => {
  // CORS — same pattern as other endpoints in this project
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Auth gate — same Bearer token as other endpoints
  const auth = req.headers.authorization || "";
  if (auth !== "Bearer b2b-saas") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Token must be configured
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("[upload-image] BLOB_READ_WRITE_TOKEN not set");
    res.status(500).json({ error: "Storage not configured" });
    return;
  }

  // Read + parse the multipart body
  let rawBody;
  try {
    rawBody = await readRequestBody(req);
  } catch (err) {
    if (err.code === "TOO_LARGE") {
      res.status(413).json({ error: `File too large (max ${MAX_BYTES / (1024 * 1024)}MB)` });
      return;
    }
    console.error("[upload-image] body read error:", err);
    res.status(400).json({ error: "Could not read request body" });
    return;
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    res.status(400).json({ error: "Expected multipart/form-data" });
    return;
  }

  const part = parseMultipart(rawBody, contentType);
  if (!part) {
    res.status(400).json({ error: "No file found in upload" });
    return;
  }

  const { filename, mimeType: claimedMime, content } = part;

  // Size check
  if (content.length === 0) {
    res.status(400).json({ error: "Empty file" });
    return;
  }
  if (content.length > MAX_BYTES) {
    res.status(413).json({ error: `File too large (max ${MAX_BYTES / (1024 * 1024)}MB)` });
    return;
  }

  // MIME check — both the claimed type AND the magic bytes must be allowed.
  // We use whichever is more restrictive (the magic wins if they disagree).
  if (!ALLOWED_MIME.has(claimedMime)) {
    res.status(415).json({ error: "Unsupported file type. Allowed: JPEG, PNG, GIF, WebP" });
    return;
  }
  const detectedMime = detectMagic(content);
  if (!detectedMime) {
    res.status(415).json({ error: "File contents not recognised as a valid image" });
    return;
  }
  if (detectedMime !== claimedMime) {
    // Trust the magic bytes — log the discrepancy
    console.warn(`[upload-image] mime mismatch: claimed=${claimedMime} detected=${detectedMime}`);
  }
  const finalMime = detectedMime;

  // Build the storage pathname
  const pathname = buildPathname(filename, finalMime);

  // Upload to Vercel Blob via REST. The PUT endpoint is the standard pattern
  // documented at https://vercel.com/docs/storage/vercel-blob
  let blobUrl;
  try {
    const blobResponse = await fetch(`https://blob.vercel-storage.com/${pathname}`, {
      method: "PUT",
      headers: {
        "authorization": `Bearer ${token}`,
        "x-content-type": finalMime,
        "x-api-version": "7",
        "x-add-random-suffix": "0",  // we already added our own random suffix
      },
      body: content,
    });
    if (!blobResponse.ok) {
      const errText = await blobResponse.text().catch(() => "");
      console.error("[upload-image] Blob upload failed:", blobResponse.status, errText);
      res.status(502).json({ error: "Upload failed at storage layer" });
      return;
    }
    const blobJson = await blobResponse.json();
    blobUrl = blobJson.url;
    if (!blobUrl) {
      console.error("[upload-image] Blob response missing url:", blobJson);
      res.status(502).json({ error: "Upload succeeded but no URL returned" });
      return;
    }
  } catch (err) {
    console.error("[upload-image] Blob fetch error:", err);
    res.status(502).json({ error: "Could not reach storage service" });
    return;
  }

  res.status(200).json({
    url: blobUrl,
    size: content.length,
    mimeType: finalMime,
    originalName: filename,
  });
};

// Tell Vercel to disable the default body parser — we read the stream ourselves
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

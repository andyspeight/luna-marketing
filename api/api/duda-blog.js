// api/duda-blog.js
// Publishes blog posts to Duda sites via their Blog API
// Two-step process: Import (creates draft) → Publish (makes it live)
//
// Duda API docs:
//   Import: https://developer.duda.co/reference/blog-import-blog-post
//   Publish: https://developer.duda.co/reference/blog-publish-blog-post

const DUDA_API_KEY = process.env.DUDA_API_KEY; // format: "username:password"
const DUDA_BASE_URL = "https://api.duda.co/api/sites/multiscreen";

function getAuthHeader() {
  // Duda uses Basic Auth: base64(username:password)
  const encoded = Buffer.from(DUDA_API_KEY).toString("base64");
  return `Basic ${encoded}`;
}

/**
 * Import a blog post as a DRAFT into a Duda site
 * @param {string} siteId - Duda site identifier (e.g. "89c0010b")
 * @param {object} post - Blog post data
 * @param {string} post.title - Post title (max 200 chars)
 * @param {string} post.content - HTML content (will be base64 encoded)
 * @param {string} post.description - Post description/excerpt
 * @param {string} post.author - Author name
 * @param {string} [post.imageUrl] - Main image URL (optional)
 * @returns {object} - Duda API response with post slug
 */
async function importBlogPost(siteId, post) {
  // Duda requires content as base64-encoded HTML
  const contentBase64 = Buffer.from(post.content).toString("base64");

  const body = {
    title: post.title.slice(0, 200),
    content: contentBase64,
    description: post.description,
    author: post.author || "Andy Speight",
  };

  // Add main image if provided
  if (post.imageUrl) {
    body.main_image = {
      url: post.imageUrl,
      alt: post.title,
    };
    body.thumbnail = {
      url: post.imageUrl,
      alt: post.title,
    };
  }

  const url = `${DUDA_BASE_URL}/${siteId}/blog/posts/import`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Duda import failed (${res.status}): ${errText}`);
  }

  return res.json();
}

/**
 * Publish a draft blog post on a Duda site
 * @param {string} siteId - Duda site identifier
 * @param {string} postSlug - The slug/ID returned from import
 * @returns {object} - Duda API response
 */
async function publishBlogPost(siteId, postSlug) {
  const url = `${DUDA_BASE_URL}/${siteId}/blog/posts/${postSlug}/publish`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Duda publish failed (${res.status}): ${errText}`);
  }

  return res.json();
}

/**
 * Full flow: import then publish a blog post
 * @param {string} siteId - Duda site identifier
 * @param {object} post - Blog post data (title, content, description, author, imageUrl)
 * @returns {object} - { imported, published, slug }
 */
async function importAndPublishBlog(siteId, post) {
  console.log(`Importing blog post: "${post.title}" to site ${siteId}`);

  // Step 1: Import as draft
  const importResult = await importBlogPost(siteId, post);
  const slug = importResult.slug || importResult.post_slug || importResult.id;

  console.log(`Draft created: ${slug}`);

  // Step 2: Publish
  const publishResult = await publishBlogPost(siteId, slug);

  console.log(`Published: ${slug}`);

  return {
    imported: importResult,
    published: publishResult,
    slug,
  };
}

module.exports = { importBlogPost, publishBlogPost, importAndPublishBlog };

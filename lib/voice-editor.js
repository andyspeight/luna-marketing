// lib/voice-editor.js
//
// THE VOICE EDITOR — second-pass critic and polish for Luna Marketing posts.
//
// Built 22 May 2026. The writer prompt (api/b2b-prompt.js) now produces
// roughly 8/10 drafts in Andy's voice. This module is the second pass that
// lifts good drafts to great — exactly the job Claude does in chat when Andy
// pastes a post and asks "what do you think?": read it against the brief,
// name the specific faults, and rewrite to standard while keeping the core
// idea and every real fact.
//
// PHILOSOPHY
//   - Judge first. A post that already sounds like Andy is returned UNTOUCHED.
//     The editor must not "improve" a good post into blandness (over-sanding).
//   - Rewrite only on NAMED faults. The editor works from a fixed checklist of
//     the residual problems the writer still has at 8/10 — not a vague
//     "make it better".
//   - NEVER fabricate. The editor improves VOICE, never adds facts. It may not
//     introduce a statistic, client name, quote, partnership or feature that
//     was not already in the draft. This is enforced two ways: (1) the editor
//     prompt forbids it in the strongest terms and carries the same sentinel,
//     and (2) every edited post is routed back through validatePost by the
//     pipeline AFTER this runs, so a fabrication introduced here is still
//     caught and the post still lands as Quality Hold.
//
// WHERE IT RUNS
//   In lib/generation-pipeline.js, between parsePostsJson() and
//   validateAndTagPosts(). Order matters: writer → voice editor → validator.
//   The validator always has the last word.
//
// KILL SWITCH
//   process.env.VOICE_EDITOR_ENABLED must NOT be the string "false" for the
//   editor to run. Default ON (unset = on). Set to "false" to bypass the pass
//   entirely (e.g. to compare writer-only output, or if it ever misbehaves).
//   This is the inverse default of AUTO_PUBLISH_ENABLED on purpose: auto-
//   publish is dangerous so defaults off; the voice editor is safe (validator
//   still guards everything downstream) so defaults on.

const GUARDRAIL_SENTINEL = "ANTI-FABRICATION RULES";

// Used for a deterministic post-edit check — after the model edits, we scan the
// result in code for any residual banned word / mechanic the model failed to
// catch, rather than trusting it to spot its own slips. This is what stops
// "landscape" and "ecosystem" leaking through (they did on 22 May 2026).
const { validateContent } = require("../api/validate-content.js");

// The channel a post targets decides which caption field the editor judges
// and rewrites. One post = one caption (the 2 May "one caption per post" rule).
const CHANNEL_TO_FIELD = {
  "LinkedIn Personal":       "caption_linkedin",
  "LinkedIn Company":        "caption_linkedin",
  "Facebook":                "caption_facebook",
  "Instagram":               "caption_instagram",
  "Google Business Profile": "caption_gbp",
  "Twitter":                 "caption_twitter",
  "Twitter/X":               "caption_twitter",
};

// Per-channel length feel, mirrored from the writer prompt so the editor
// knows when a post is too thin and should be developed (not padded).
const CHANNEL_LENGTH_HINT = {
  "caption_linkedin": "900-1300 characters for LinkedIn Personal, 700-1000 for LinkedIn Company. A thin 3-line post reads as low effort — develop the idea.",
  "caption_facebook": "300-500 characters. Warm and community-facing.",
  "caption_instagram": "150-400 characters, hook in the first line, hashtags at the end.",
  "caption_gbp": "400-1500 characters, local and SEO-aware, include a CTA.",
  "caption_twitter": "Under 280 characters, punchy.",
};

/**
 * Build the voice-editor system prompt. Carries the guardrail sentinel so it
 * passes the same assertion the writer does, and encodes the exact residual
 * faults we identified at 8/10 plus the hard no-fabrication contract.
 */
function buildEditorSystemPrompt() {
  return `You are the voice editor for Travelgenix. You are the second pair of eyes on a social media post that has already been drafted. Your job is exactly the job a sharp editor does: read the post against Andy's voice, decide if it is good enough, and if it is not, rewrite it to standard.

You are editing for VOICE and CRAFT only. You are NOT a fact checker and you are NOT allowed to add facts.

═══════════════════════════════════════════════════════════
${GUARDRAIL_SENTINEL} — THE LINE YOU MUST NOT CROSS
═══════════════════════════════════════════════════════════

When you rewrite, you may ONLY use facts that are already present in the draft
you were given. You must NEVER add:
- a statistic, percentage, or number that was not in the draft
- a client name, customer name, or person's name
- a quote
- a partnership, award, supplier name, or product feature not in the draft
- a destination, route, or event not in the draft

If the draft is vague, your job is to make it WARMER and SHARPER in voice, not
to make it more specific by inventing detail. Improving voice never means
adding facts. If you find yourself wanting to add a concrete number or name to
make it land better, STOP — that is fabrication and it is forbidden. Keep it
generic and well-written instead.

═══════════════════════════════════════════════════════════
ANDY'S VOICE — THE STANDARD YOU EDIT TOWARD
═══════════════════════════════════════════════════════════

Travelgenix is a solution provider for the travel industry. We operate in
travel technology but we NEVER talk like a tech company. We care about the
business owner's bottom line, their sanity, and their growth. We never explain
the plumbing.

The temperature is relaxed, warm, friendly and supportive. A knowledgeable
friend who has seen the problem before and quietly knows how to fix it. NOT a
loud pub bore. No forced matey-ness, no "mate", no "look", no staged anecdotes.
Professional with the jacket off, not professional after six pints.

Technology is ALWAYS the hero that makes the human brilliant. The villain is
admin, faff, slowness, the lost evening, the booking that slipped away. NEVER
frame people as rejecting or escaping technology — we sell the technology.

═══════════════════════════════════════════════════════════
THE FAULT CHECKLIST — judge the post against every item
═══════════════════════════════════════════════════════════

Check the post for each of these specific, named faults:

1. OPENS WITH A QUESTION. The first line must be a declarative hook, never a
   question. "When should agents post on social?" is a fault. Rewrite the
   opening as a statement.

2. EXPLAINS THE PLUMBING. Any mention of how the tech works — APIs, feeds,
   integrations, "one interface", "single confirmation process", supplier
   names as mechanism, screens, inventory sources. Rewrite to describe only
   what the person gets back: time, calm, the booking saved, the quote out
   before the customer cools.

3. WRONG VILLAIN. The thing being railed against should be admin/faff/lost
   time, not "multiple screens" or "different systems" (those are software
   problems, not life problems) and never technology itself. Re-aim it at the
   human cost.

4. LISTICLE OR CHECKLIST. Education posts especially must be flowing prose, not
   a queue of tips ("Post twice a week. Keep hours current. Add photos."). Pick
   the single strongest idea and develop it warmly. Depth over breadth.

5. TELLS INSTEAD OF SHOWS. "The result? Agents can quote complex trips easily."
   is a benefit statement off a product page. Make the reader FEEL the relief
   instead of being told the outcome.

6. SLOGAN-Y OR TOO-NEAT CLOSER. Endings that land as a marketing tagline
   ("Early bird gets the booking, but only if your tech can keep up") are
   slightly off. End forward on a genuine point of view, or just stop when the
   point is made. NEVER a generic engagement question ("What's your take?",
   "Are you seeing the same?") — those are banned outright.

7. TOO SHORT / THIN. Length is a hard requirement on LinkedIn, not a
   suggestion. The rules:
   - LinkedIn Personal MUST be at least 900 characters. Under 900 is a FAULT.
   - LinkedIn Company MUST be at least 700 characters. Under 700 is a FAULT.
   - If a LinkedIn post is under the floor, you MUST expand it: add a second
     concrete example, a sharper bit of context, a deeper layer to the take, or
     a "why this matters for the agent on Monday" beat. Develop with substance
     and angle, NEVER with filler, padding or repetition, and NEVER by adding
     invented facts. A well-developed 1000-character post beats a tight
     650-character one every time on LinkedIn.
   - Facebook (300-500), Instagram (150-400) and Twitter are MEANT to be short.
     Do NOT expand these. Brevity is correct for them. Only LinkedIn has a floor.
   (${"${lengthHint}"})

8. MISSED TRAVELGENIX BRIDGE. Where it fits naturally and is not forced, an
   Education or Commentary post can nod to how the right tech makes the thing
   easier. If a bridge would feel natural and is absent, add a light one — but
   ONLY using products/capabilities already implied in the draft, never a new
   invented feature.

9. MECHANICAL RHYTHM. Four tidy paragraphs of identical shape is its own AI
   tell. Vary sentence and paragraph length. Let a short line land.

10. BANNED MECHANICS. Em dashes, Oxford commas, curly quotes, more than one
    exclamation mark, throat-clearing openers. And these BANNED WORDS — if any
    appear, replace them with plain language:
    leverage, holistic, robust, seamless, game-changer, paradigm, delve,
    tapestry, unlock, navigate (as a metaphor), cutting-edge, groundbreaking,
    nestled, vibrant, profound, pivotal, testament, underscores, fostering,
    garner, showcase, interplay, intricate, enduring, utilize, synergy,
    innovative, ecosystem (as a metaphor — "tech ecosystem" is banned, "marine
    ecosystem" is fine), landscape (as a metaphor — "travel landscape" or
    "competitive landscape" is BANNED, a literal landscape is fine).
    These are common and easy to miss. Scan for them specifically.

═══════════════════════════════════════════════════════════
HOW TO DECIDE
═══════════════════════════════════════════════════════════

Score the post 1-10 against the standard above.

- If it scores 8 or above AND has no fault from items 1, 2, 3, 6, 7 or 10 (the
  hard faults), return it UNCHANGED. Do not polish a good post into blandness.
  Leaving a strong post alone is the correct, expected outcome much of the time.
- If it scores below 8, OR has any hard fault, rewrite it to fix the SPECIFIC
  faults you found. Keep the core idea. Keep every real fact. Change only what
  is needed to clear the faults. Do not rewrite from scratch for its own sake.

CRITICAL ON LENGTH (fault 7 is a HARD fault): a LinkedIn post under its floor
(900 for Personal, 700 for Company) MUST be edited and expanded even if it is
otherwise excellent and scores 9. A good short LinkedIn post is still a fault
because it is too thin for the channel. Expand it to length with real substance.
This does NOT apply to Facebook, Instagram or Twitter — those stay short.

═══════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════

Return ONLY valid JSON, no markdown fences, no preamble:

{
  "score": 7,
  "verdict": "edit",            // "keep" if returned unchanged, "edit" if rewritten
  "faults": ["opens with a question", "listicle"],   // named faults found, [] if none
  "edited_caption": "the full rewritten caption, OR the original verbatim if verdict is keep",
  "edited_first_comment": "rewritten LinkedIn first comment if there was one and it needed work, else the original or empty string"
}

The edited_caption must be clean plain text ready to publish. No markup, no
citations, no notes to the reader, no "here is the rewrite". Just the post.`;
}

// Per-channel hard length floors. LinkedIn has real floors; short-form
// platforms intentionally do not (null = no floor, brevity is correct).
const CHANNEL_LENGTH_FLOOR = {
  "LinkedIn Personal": 900,
  "LinkedIn Company": 700,
  "Facebook": null,
  "Instagram": null,
  "Google Business Profile": null,
  "Twitter": null,
  "Twitter/X": null,
};

/**
 * Polish a single post. Returns { post, report } where post is the (possibly)
 * edited post and report describes what happened. On any error the ORIGINAL
 * post is returned untouched — the editor must never lose content.
 *
 * @param {object} post - a normalized snake_case post
 * @param {function} callModelFn - the pipeline's callModel (so we reuse the
 *        same client, sentinel assertion, and model config)
 */
async function polishPost(post, callModelFn) {
  const channel = post.target_channel || "LinkedIn Personal";
  const field = CHANNEL_TO_FIELD[channel] || "caption_linkedin";
  const original = (post[field] || "").trim();

  // Nothing to edit — empty caption (shouldn't happen post-normalize, but be safe)
  if (!original) {
    return { post, report: { channel, field, verdict: "skip", reason: "empty caption", score: null, faults: [] } };
  }

  const lengthHint = CHANNEL_LENGTH_HINT[field] || "";

  // Measure length in code — models cannot reliably count characters by eye,
  // so we tell the editor explicitly whether this post is under its floor.
  const floor = CHANNEL_LENGTH_FLOOR[channel];
  const charCount = original.length;
  const underFloor = floor != null && charCount < floor;
  let lengthDirective = `This post is ${charCount} characters.`;
  if (floor != null) {
    lengthDirective += ` The floor for ${channel} is ${floor} characters.`;
    if (underFloor) {
      lengthDirective += ` THIS POST IS UNDER THE FLOOR — you MUST expand it to at least ${floor} characters with real substance (a second example, deeper context, a sharper take), never filler or invented facts. This is a hard fault even if the post is otherwise excellent.`;
    } else {
      lengthDirective += ` It meets the floor — do not pad it further.`;
    }
  } else {
    lengthDirective += ` ${channel} is a short-form channel with no length floor — keep it brief, do NOT expand it.`;
  }

  const systemPrompt = buildEditorSystemPrompt().replace("${lengthHint}", lengthHint);

  const hasFirstComment = !!(post.first_comment && post.first_comment.trim());
  const userMessage =
    `Channel: ${channel}\n` +
    `Content pillar: ${post.content_pillar || "(unspecified)"}\n` +
    `LENGTH: ${lengthDirective}\n\n` +
    `POST TO JUDGE AND (IF NEEDED) REWRITE:\n"""\n${original}\n"""\n\n` +
    (hasFirstComment
      ? `LINKEDIN FIRST COMMENT (judge and rewrite only if it needs it):\n"""\n${post.first_comment.trim()}\n"""\n\n`
      : "") +
    `Judge it against the fault checklist. Return the JSON described in your instructions. ` +
    `Remember: if it is already strong AND meets its length floor, return it unchanged with verdict "keep". ` +
    `If it is under its length floor (stated above), you MUST expand it — that is a hard fault. ` +
    `Never add a fact that is not already in the draft.`;

  let raw;
  try {
    raw = await callModelFn({
      systemPrompt,
      userMessage,
      maxTokens: 2048,
      temperature: 0.5, // lower than the writer — editing is a tighter task than generating
    });
  } catch (e) {
    // Model call failed — return the original untouched.
    return { post, report: { channel, field, verdict: "error", reason: "model call failed: " + e.message, score: null, faults: [] } };
  }

  // Parse the editor's JSON verdict
  let parsed;
  try {
    const clean = (raw || "").replace(/```json/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    // Couldn't parse — safest to keep the original.
    return { post, report: { channel, field, verdict: "parse_error", reason: "could not parse editor JSON", score: null, faults: [] } };
  }

  // If the editor chose to keep, or produced no usable edit, return original.
  const verdict = parsed.verdict === "edit" ? "edit" : "keep";
  const edited = (parsed.edited_caption || "").trim();
  if (verdict === "keep" || !edited) {
    return {
      post,
      report: {
        channel, field, verdict: "keep",
        score: parsed.score ?? null,
        faults: parsed.faults || [],
        editedLength: original.length,
        floor: floor,
        stillUnderFloor: floor != null && original.length < floor,
      },
    };
  }

  // Apply the edit. Clone the post so we never mutate the input.
  const newPost = Object.assign({}, post);
  newPost[field] = edited;

  // Apply edited first comment only if one was returned and there was one to begin with.
  if (hasFirstComment && parsed.edited_first_comment && parsed.edited_first_comment.trim()) {
    newPost.first_comment = parsed.edited_first_comment.trim();
  }

  // Safety net: did the edit actually clear the length floor? If a LinkedIn
  // post is STILL under floor after editing, surface it so it can be caught.
  const stillUnderFloor = floor != null && edited.length < floor;

  // Deterministic post-edit scan: catch any banned word / mechanic the model
  // failed to fix, in code rather than trusting the model to spot its own slip.
  const residual = validateContent(edited, { allowBenchmarkStats: true });
  const residualWarnings = residual.issues
    .filter(i => i.severity === "warn" || i.code === "BANNED_WORD")
    .map(i => i.code);

  return {
    post: newPost,
    report: {
      channel,
      field,
      verdict: "edit",
      score: parsed.score ?? null,
      faults: parsed.faults || [],
      originalLength: original.length,
      editedLength: edited.length,
      floor: floor,
      stillUnderFloor: stillUnderFloor,
      residualWarnings: residualWarnings.length ? residualWarnings : undefined,
    },
  };
}

/**
 * Polish an array of posts. Runs the editor on each in PARALLEL (a weekly batch
 * is ~10 posts). Returns the polished posts
 * and a summary report. NEVER throws — on any failure the affected post is
 * returned untouched.
 *
 * The pipeline calls this AFTER parse and BEFORE validateAndTagPosts, so every
 * edited post is still validated for fabrication afterwards.
 *
 * @param {object[]} posts - normalized posts from parsePostsJson
 * @param {function} callModelFn - the pipeline's callModel
 * @returns {Promise<{posts: object[], reports: object[], summary: object}>}
 */
async function polishPosts(posts, callModelFn) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return { posts: posts || [], reports: [], summary: { total: 0, edited: 0, kept: 0, errors: 0 } };
  }

  // Kill switch: default ON. Only "false" disables.
  if (process.env.VOICE_EDITOR_ENABLED === "false") {
    return {
      posts,
      reports: posts.map(() => ({ verdict: "disabled" })),
      summary: { total: posts.length, edited: 0, kept: posts.length, errors: 0, disabled: true },
    };
  }

  if (typeof callModelFn !== "function") {
    // No model function provided — cannot edit, return originals.
    return {
      posts,
      reports: posts.map(() => ({ verdict: "no_model_fn" })),
      summary: { total: posts.length, edited: 0, kept: posts.length, errors: 0 },
    };
  }

  // Run all editor passes in PARALLEL. polishPost never throws (it returns the
  // original post on any error), so Promise.all is safe — one post failing can
  // never reject the whole batch. Parallel turns ~10 sequential calls (80s+)
  // into roughly the time of a single call (~10-15s), which is what was pushing
  // /api/generate past its function timeout. For a single user generating once
  // a week, 10 concurrent Claude calls is well within rate limits. If this is
  // ever run for many clients at once, add a concurrency cap here.
  const results = await Promise.all(posts.map((post) => polishPost(post, callModelFn)));

  const outPosts = [];
  const reports = [];
  let edited = 0, kept = 0, errors = 0, underFloor = 0;

  for (const { post: result, report } of results) {
    outPosts.push(result);
    reports.push(report);
    if (report.verdict === "edit") edited++;
    else if (report.verdict === "keep" || report.verdict === "skip") kept++;
    else errors++;
    if (report.stillUnderFloor) underFloor++;
  }

  return {
    posts: outPosts,
    reports,
    summary: { total: posts.length, edited, kept, errors, stillUnderFloor: underFloor },
  };
}

module.exports = {
  polishPosts,
  polishPost,
  buildEditorSystemPrompt,
  GUARDRAIL_SENTINEL,
  // exposed for tests
  CHANNEL_TO_FIELD,
};

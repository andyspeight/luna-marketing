# Luna Marketing — Email AI Composer Architecture

**Session 1 deliverable**
**Date:** 15 May 2026
**Status:** Architecture locked. Build starts in Session 2.

---

## 0. Purpose of this document

This is the design contract for the AI email composer. It says HOW we build the thing whose RULES are defined in the `luna-email-composer` skill. Read the skill first, then this.

If anything in this doc conflicts with the skill, the skill wins.

---

## 1. The big picture

```
                 ┌───────────────────────────────────────────┐
                 │     USER INTENT                            │
                 │  "Write an email about Luna Chat for      │
                 │   Boost-tier clients"                      │
                 └──────────────────┬────────────────────────┘
                                    │
                                    ▼
            ┌───────────────────────────────────────────────┐
            │   /api/email-compose-ai  (POST)                │
            │                                                │
            │   1. Validate input                            │
            │   2. Authenticate session                      │
            │   3. Load tenant brand context                 │
            │   4. Load Product Library (Active only)        │
            │   5. Load Topic Mappings                       │
            │   6. Load recent email history (last 5)        │
            │   7. Load Events Calendar (next 6 weeks)       │
            │   8. Build system prompt (6 layers)            │
            │   9. Call Anthropic API (claude-opus-4.6)      │
            │   10. Validate output (5-layer check)          │
            │   11. Write to Audit Log                       │
            │   12. Return draft                             │
            └──────────────────┬────────────────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────────────┐
            │    DRAFT RESPONSE                              │
            │    { draftId, subject, previewText,            │
            │      sections: [...], warnings: [...],         │
            │      imagesNeeded: [...] }                     │
            └──────────────────┬────────────────────────────┘
                               │
                               ▼
            ┌──────────────────────────────────────────────┐
            │    UI — Emails tab → "Compose with AI"        │
            │                                                │
            │    Renders sections as editable cards          │
            │    Refinement prompt input                     │
            │    Save / Send buttons                         │
            └──────────────────┬────────────────────────────┘
                               │
                               ▼
          ┌────────────────────┴────────────────────┐
          │                                          │
          ▼                                          ▼
   /api/email-compose-refine              /api/email-send-now
   (re-prompts AI, returns                (existing — sends via
    new sections)                          Brevo)
```

---

## 2. The data layer — what the composer reads

### 2.1 Tenant brand context

From `Clients` table, fields used:
- `Business Name` — for sender display
- `Trading Name` — alternative sender display
- `Sender Name` — email "From" name
- `Reply To Email` — email reply-to
- `Tone Keywords` — voice direction
- `Formality` — formality level
- `Sentence Style` — short/medium/long
- `CTA Style` — question-based / direct / etc
- `Example Phrases` — actual brand sentences for style matching
- `Primary Colour` / `Secondary Colour` / `Brand Dark Hex` — visual palette
- `Brand Font` — font preference
- `Logo URL` / `Logo Dark Variant URL` / `Logo Mark URL` — branding assets
- `ATOL Number` / `ABTA Number` — footer compliance
- `Company Address` — footer compliance
- `Footer Legal Lines` — additional legal copy
- `Social LinkedIn URL` / `Social Facebook URL` / `Social Instagram URL` / `Social X URL` — footer social
- `Client Type` — b2b-saas / b2c-travel — drives default archetype

### 2.2 Product Library context

From `Product Library` table, filtered by tenant:
- ALL Active products (composer needs awareness of what exists)
- Highlighted Spotlight product if current month
- For any product mentioned in `featureProductIds`, fetch full record

Only `Active` products are mentionable. `Coming Soon` products are allowed only with explicit user opt-in.

### 2.3 Topic Mappings context

From `Topic Mappings` table, filtered by tenant. Used by the composer to:
- Recognise topic keywords in the user's intent
- Surface relevant products that match the topic
- Inform structural decisions (e.g. if intent mentions "chat abandonment", Luna Chat becomes a natural lead product)

### 2.4 Recent email history

From `Email Queue` table, last 5 sent emails for this tenant. Used to:
- Avoid repetition of subject lines, lead products, hero topics
- Inform the "audience hasn't heard from us in N days" detection
- Provide voice continuity examples

### 2.5 Events Calendar

From `Events Calendar` table, events with `Date Start` within next 6 weeks AND `Status = Active`. Used to:
- Suggest timely angles
- Flag if the email coincides with a major event the composer should reference

### 2.6 What's NOT loaded

- Other tenants' data
- Audit Log contents (the composer reads inputs, not audit history)
- Hot Leads, Research Sparks (B2B social inputs — not used for email composer v1)
- Full Email Templates table (only the specific template referenced in `templateId` if provided)

---

## 3. The system prompt construction

The system prompt is built deterministically at runtime from 6 layers. Same inputs → same prompt → predictable output.

### Layer 1: Identity & non-negotiables (~600 tokens)

Static. Loaded from the `luna-email-composer` skill's "Five Non-Negotiable Laws" section verbatim, plus the identity statement:

> "You are Luna, the Travelgenix email composer. Your output is a JSON object containing sections, a subject line, and preview text. You produce on-brand, factually grounded, never-AI-sounding emails. You never invent facts. You never drift from voice. You never break the email design contract. You never bypass safety rails. You never hide uncertainty."

### Layer 2: Hard rules (~800 tokens)

Static. The banned words list, em dash rule, Oxford comma rule, JSON schema rules, the explicit "YOU MAY NOT CLAIM" template.

### Layer 3: Brand context (~400 tokens, dynamic)

Built from the tenant's Clients record:

```
TENANT BRAND PROFILE:
- Business: {Business Name}
- Sender: {Sender Name}
- Voice tone: {Tone Keywords}
- Formality: {Formality}
- Sentence style: {Sentence Style}
- CTA style: {CTA Style}
- Example brand phrases (mimic these):
  - {Example Phrases line 1}
  - {Example Phrases line 2}
  - {Example Phrases line 3}
- ATOL: {ATOL Number} | ABTA: {ABTA Number}
- Address: {Company Address}
```

### Layer 4: Data context (~1500 tokens, dynamic)

Structured catalogue of facts the composer is allowed to use:

```
PRODUCT LIBRARY (you may reference these products):

Luna Chat [recbosX9YkZjD37Ss] (★ May 2026 Spotlight)
- Status: Active
- One-liner: AI live chat built for travel. Books holidays in the chat window itself.
- Problem solved: Website visitors leave without ever speaking to anyone. Generic chat tools know nothing about travel.
- Proof point: 60-second results from 200+ suppliers, 600+ verified travel knowledge records, 20+ languages, AI-to-human handoff.
- Primary CTA: "Book a Luna Chat demo" → https://calendly.com/travelgenix_andyspeight
- Suitable archetypes: launch, newsletter, nurture, thought-leadership
- Tier match: Spark, Boost, Ignite
- Priority: 10

[... other Active products ...]

TOPIC MAPPINGS (intent keywords → suggested products):
- "chat abandonment" → Luna Chat (weight 10)
- "admin overhead" → Travelify (weight 10)
[... etc]

RECENT EMAIL HISTORY (avoid repeating these):
- 8 May: "Why your website's losing 70% of visitors" — featured Luna Chat
- 1 May: "May product spotlight: Luna Chat" — featured Luna Chat
- 24 Apr: "Quick Quote is live" — featured Quick Quote
- ...

EVENTS CALENDAR (next 6 weeks):
- 24-25 June: TravelTech Show, ExCeL London
- ...

YOU MAY NOT CLAIM:
- Specific customer numbers unless I provide them
- Specific revenue/conversion stats unless I provide them
- Specific testimonials unless I provide them
- Competitor names (TProfile, Top Dog, Inspiretec, Dolphin, Traveltek, Moonstride, Travelsoft, Juniper)
- Awards or accreditations not in the brand profile
```

### Layer 5: Output schema (~700 tokens)

Exact JSON shape, with one valid example for the current archetype:

```
RETURN this exact JSON shape (no markdown, no preamble):
{
  "subject": "string max 60 chars, never starts with Hi/Hello/Hey",
  "previewText": "string max 110 chars",
  "sections": [
    { "type": "header", "props": { "logoUrl": "...", "kicker": "..." } },
    { "type": "hero", "props": { "headline": "...", "deck": "...", "imagePlaceholder": "Apple-style mockup of [description]" } },
    ...
  ],
  "featuredProducts": ["recXXX"],
  "reasoning": "1-2 sentences explaining structural choices",
  "imagesNeeded": [...],
  "warnings": [...]
}

VALID SECTION TYPES: header | hero | article | two-col | text | cta | divider | footer

EXAMPLE for newsletter archetype:
{full example JSON here}
```

### Layer 6: User intent (~100-500 tokens, dynamic)

The user's free-text input:

```
USER INTENT:
{user's free-text intent}

ARCHETYPE: {newsletter | marketing | launch | transactional}
AUDIENCE: {Cold | Nurture | Client | Drip}
AUDIENCE SEGMENT: {optional segment label}
FEATURED PRODUCTS (must include): {comma-separated IDs}
TONE OVERRIDES: {optional}
```

### Total prompt budget

Approx 4,000-4,500 tokens for the system prompt. Plus the model's response. Comfortable within Claude's context window.

---

## 4. The validation layer

After the composer returns a draft, automated validation runs before returning to the user.

### 4.1 Banned words check

Regex scan for the humaniser banned word list. Any hit → flag in `warnings`.

### 4.2 Em dash check

Regex for `—` character. Any hit → flag in `warnings` AND auto-replace with `, ` for the saved version (with the warning surfaced so the user knows).

### 4.3 Oxford comma check

Regex for `, and ` and `, or ` patterns. Any hit → flag in `warnings` (user reviews).

### 4.4 Number hallucination check

Regex for `\d+%`, `\d+x`, `saved \d+`, `up to \d+`, etc. For each hit, check if that number appears in the provided data. If not → flag as potential hallucination.

### 4.5 Quoted string check

Anything in double or single quotes that looks like a testimonial. Flag for user review.

### 4.6 URL allowlist

Allowed:
- URLs from the Product Library CTA URLs
- Tenant's website
- travelify.io subdomains
- calendly.com URLs
- Pre-approved Pexels URLs

Anything else → flag as potentially fabricated URL.

### 4.7 Section schema validation

Every section's `type` must be in the registry. Every section's `props` must match its schema. Hard reject — refuse to return the draft if violated.

### 4.8 Competitor name check

Hardcoded list: TProfile, Top Dog, Inspiretec, Dolphin Dynamics, Traveltek, Moonstride, Travelsoft, Juniper, T1 Profile. Any match → hard reject, refuse to return draft.

---

## 5. The UI flow

Skill consulted: `travelgenix-design`, `travelgenix-taste`.

### 5.1 Entry point

In `public/client.html`, on the existing Emails tab, add a new primary CTA: **"Compose with AI"** alongside the existing "New email" button (which becomes "Compose manually" for power users).

### 5.2 The composer modal — three states

**State 1: Brief**

```
┌── Compose email with AI ─────────────────────────── × ─┐
│                                                         │
│  What's this email for?                                 │
│  ┌──────────────────────────────────────────────────┐  │
│  │ e.g. Promote Luna Chat to Boost-tier clients    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Style:  [Newsletter ▾] [Marketing] [Launch] [Trans]   │
│  Audience: [Client ▾]   Segment: [optional]            │
│                                                         │
│  ▸ More options (collapsible)                          │
│     Featured products: [Luna Chat ×] [+]               │
│     Recent blog: [Auto ▾]                              │
│     Tone overrides: [...]                              │
│                                                         │
│                                  [Cancel] [Generate ▸] │
└─────────────────────────────────────────────────────────┘
```

**State 2: Generating** (5-15 second wait)

Animated progress with the composer's "thinking out loud":
- "Loading brand voice..."
- "Checking Product Library..."
- "Drafting subject line..."
- "Structuring sections..."

**State 3: Draft preview**

```
┌── Draft ready ──────────────────────────────────── × ─┐
│                                                        │
│  Subject:  Books holidays in the chat window itself   │
│  Preview:  See Luna Chat in action — book a 15-min...  │
│                                                        │
│  Why this structure: Newsletter archetype because     │
│  intent is recurring update. Lead story on Luna Chat  │
│  (May spotlight)...                                    │
│                                                        │
│  ⚠ 1 warning:                                          │
│   • Audience hasn't been emailed in 35 days — opening │
│     acknowledges that                                  │
│                                                        │
│  ┌── Section 1: header ──────────────── ⋮ edit ───┐   │
│  │ [Travelgenix logo]  TRAVELGENIX WEEKLY         │   │
│  │ Issue 12 · 15 May 2026                         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│  ┌── Section 2: hero ──────────────────────── ⋮ ──┐   │
│  │ [Image placeholder: Apple-style chat mockup]   │   │
│  │                                                 │   │
│  │ Books holidays in the chat window itself       │   │
│  │ Luna Chat is now live for every Boost client.  │   │
│  │ Visitors who used to leave now get a quote in  │   │
│  │ 60 seconds and book without ever leaving the   │   │
│  │ page.                                           │   │
│  │                                                 │   │
│  │ [Book a Luna Chat demo →]                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│  ┌── Section 3: article ─────────────────────── ⋮ ─┐  │
│  │ ...                                              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Refine:                                               │
│  ┌──────────────────────────────────────────────────┐ │
│  │ e.g. "Make it shorter" / "Lead with the demo CTA"│ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  [Generate again]  [Save as draft] [Save & schedule] │
└────────────────────────────────────────────────────────┘
```

### 5.3 Section card interactions

Each section card has a `⋮` menu:
- **Edit** — opens inline text editor for that section's props (no AI call)
- **Regenerate** — re-asks the AI for just this section
- **Delete** — removes the section (with warning if it's a structural section like header/footer)
- **Add image** — opens image picker (Session 3) — disabled until then with tooltip "Image picker coming Session 3"

### 5.4 Refinement input

Free-text below the sections. Pressing Enter or "Apply refinement" calls `/api/email-compose-refine` with:
- The current sections JSON
- The refinement prompt
- The original context

Returns new sections JSON. Replaces the displayed cards. The refinement count increments. After 10, a subtle hint appears: "This is drifting — consider starting again with a clearer brief."

### 5.5 Save options

- **Save as draft** — writes to Email Queue with `Status = "Draft"`, no send
- **Save & schedule** — opens existing schedule UI from manual compose
- **Save & send now** — for owner only, uses existing send-now flow

---

## 6. API endpoints — the build list

### 6.1 `POST /api/email-compose-ai`

**Input:**
```
{
  tenantId: "recXXX",
  intent: "free text",
  archetype: "newsletter" | "marketing" | "launch" | "transactional",
  audience: "Cold" | "Nurture" | "Client" | "Drip",
  audienceSegment: "optional",
  templateId: "recXXX | null",
  featureProductIds: ["recXXX"],
  audienceContext: "optional",
  toneOverrides: "optional",
  recentBlogId: "recXXX | null",
  spotlightProductId: "recXXX | null"
}
```

**Auth:** Session cookie validates user. Tenant authorisation: user must have access to this tenant (owner override allows any).

**Output:** As defined in §3.1 of the skill.

**Errors:** 401 (not signed in), 403 (not authorised for tenant), 400 (invalid input), 422 (composer returned invalid JSON after 3 retries), 500 (engine error).

### 6.2 `POST /api/email-compose-refine`

**Input:**
```
{
  draftId: "uuid",
  currentSections: [...],
  refinementPrompt: "free text",
  refinementHistory: [...]  // previous refinements for context
}
```

**Output:** Same shape as compose-ai.

**Errors:** Same plus 429 if refinement count > 10.

### 6.3 `POST /api/email-compose-save`

Saves the draft to Email Queue. Existing endpoint (`email-compose.js`) — minor extension to accept the AI-composed metadata for audit.

### 6.4 No changes needed to:

- `email-render.js` — already accepts sections JSON
- `email-send-now.js` — already accepts an email record from queue
- `email-webhook.js` — Brevo delivery tracking unchanged

---

## 7. The UI integration

### 7.1 Files modified

- `public/client.html` — add Compose with AI button + modal + section card components + refinement loop

### 7.2 Files NOT modified

- `public/admin.html` — composer is client-side
- The auth flow — uses existing session
- The renderer — sections JSON is the unchanged contract

### 7.3 Estimated line additions

Around 600-800 lines to `client.html` for the full composer flow. Mostly UI rendering and event handling.

---

## 8. Security review (Session 1 pass)

Skills consulted: `travelgenix-security`.

### 8.1 Authentication

- Endpoint requires valid session cookie (validated against id.travelify.io)
- Tenant authorisation enforced server-side (matches the Content Engine pattern)
- Owner override allowed (`isOwner()` check)
- No tenant ID in URL params for routes that return sensitive content (POST body only)

### 8.2 Input validation

- All free-text inputs capped at sensible lengths (intent 2000 chars, refinementPrompt 1000 chars, etc.)
- All record IDs validated against `^rec[A-Za-z0-9]{14}$`
- Archetype, audience must be one of allowlist
- featureProductIds verified to belong to this tenant before passing to composer

### 8.3 Output sanitisation

- All composer output passes through HTML-escaping when rendered in UI
- All saved-to-Email-Queue content has the existing `sanitiseHTML()` applied
- Subject/previewText capped at hard length limits regardless of what composer returns

### 8.4 Rate limiting

- Composer endpoint: 10 calls per user per hour (cost control)
- Refinement endpoint: 30 calls per user per hour (more lenient because cheaper)
- Both limits gracefully return 429 with retry-after

### 8.5 Audit logging

- Every composer call writes to Audit Log
- Includes: actor, tenant, intent, archetype, audience, products referenced, warnings raised
- Does NOT include: the full prompt or response (those go to a separate diagnostic store, retention 30 days)

### 8.6 Cost controls

- Each composer call costs ~$0.05-0.10 in Anthropic API tokens
- Default rate limit (10/hour) caps user cost at $1/hour
- Spend tracked per tenant in monthly review

### 8.7 Failure modes

- Anthropic API unavailable → return 503, draft not saved, user retries
- Validator fails draft → return draft with warnings, user decides
- Section schema violation → re-prompt the composer up to 3 times; if still invalid, return error
- Refinement timeout → return error, suggest "Generate again from scratch"

---

## 9. What stays out of scope for Session 2

To prevent scope creep:

- ❌ Image generation (Session 3)
- ❌ Asset upload UI (Session 3)
- ❌ Pexels integration (Session 3)
- ❌ SVG-to-PNG rasterisation (Session 3)
- ❌ A/B testing variants (future)
- ❌ Send-time optimisation per audience (future)
- ❌ Multi-step drip campaigns (future)
- ❌ Auto-newsletter cron (Session 4)
- ❌ Email Templates table seeded with new templates (will use existing + UI to add manually)

What IS in scope for Session 2:
- ✅ The composer endpoint
- ✅ The refinement endpoint
- ✅ The UI in the Emails tab
- ✅ The section card editing
- ✅ The validation layer
- ✅ The audit logging
- ✅ Save to Email Queue (uses existing API)
- ✅ Send via existing send-now (no change needed)
- ✅ Placeholder image slots with clear "image coming Session 3" indicators

---

## 10. Session 2 build order

When we get to Session 2:

1. **Read the luna-email-composer skill** (always — never skip)
2. **Read travelgenix-email-design, travelgenix-humanizer, travelgenix-security** (always)
3. **Audit existing Email Templates table records** — read all of them, document what's there
4. **Build the composer endpoint** — the system prompt construction first, then the API wrapper
5. **Test the composer in isolation** — 10 test prompts with mocked context, eyeball every output
6. **Build the validation layer** — make it strict
7. **Build the refinement endpoint** — same pattern, simpler
8. **Build the UI** — modal, section cards, refinement input, save flow
9. **End-to-end test** — Andy generates 5 real emails, we adjust
10. **Document any deviations from this design doc** in the skill for future sessions

Estimated time: full session.

---

## 11. The honest acknowledgement

This is a big build. Six layers of system prompt, eight section types, validation, audit, UI, refinement. Done right it's the foundation of Travelgenix's email program for years. Done in a hurry it's a buggy mess.

Hence: three sessions, not one. Session 1 is the architecture. Session 2 is the composer + UI without images. Session 3 is the visual layer.

The skill we wrote in this session is what protects all three from regression. Future sessions reference it. Future builds extend it. Future failures get diagnosed against it.

---

*End of architecture doc.*

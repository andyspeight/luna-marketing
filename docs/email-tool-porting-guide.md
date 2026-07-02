# Email Tool — Porting Guide

How to rebuild the Luna Marketing email tool in another project, exactly as it
works here: the on-canvas builder, the section renderer, the approval queue,
and the Brevo sending pipeline. Written for a developer or an AI coding agent
starting from this repo.

**Source of truth:** this repository (`andyspeight/luna-marketing`). Every
file named below can be copied verbatim unless the "adapt" note says
otherwise.

---

## 1. What the tool is

A section-based email builder. Users assemble an email from ~53 pre-designed
"sections" (hero, text, CTA, feature list, footer, etc.), edit the text
directly on a live preview of the email, then save it into an approval queue.
Approved emails are sent through **Brevo** (ex-Sendinblue) — as a proper
marketing **campaign** to audience lists, or as **transactional** one-offs
for drips and test sends. A cron picks up approved + scheduled emails hourly.

The email HTML is server-rendered, table-based, Outlook-bulletproof, and
**byte-identical for sends** regardless of any editor features (see §6).

---

## 2. Architecture

```
Builder UI (single-page app)
  └─ POST /api/email-render {sections, editable:true}   ← live preview
        └─ lib/email-renderer.js → lib/email-sections/<type>.js (render+schema)
  └─ Save:
        new email    → POST /api/email-compose   (creates queue record, status "Awaiting Approval")
        editing      → POST /api/email-action    (action:"edit" — updates the SAME record)
  └─ Send test       → transactional send to a named address
Approval (human) → Status "Approved"
Sending:
  └─ POST /api/email-send-audience {emailId, listIds}  ← the real send (Brevo CAMPAIGN + sendNow)
  └─ GET  /api/email-cron (hourly, Bearer CRON_SECRET) ← approved + Scheduled Send <= now
  └─ POST /api/email-send-now / email-drip             ← transactional paths
Stats/webhooks: api/brevo-webhook.js (opens/clicks/bounces back into the DB)
```

Storage is Airtable here, but nothing depends on Airtable specifically — any
DB works if you keep the fields in §5.

---

## 3. Files to copy

### The rendering core (copy verbatim — zero app coupling)
| File | Role |
|---|---|
| `lib/email-renderer.js` | `renderEmail({sections, unsubUrl, previewText, title, brand, editable})` → `{html, plainText, errors, warnings}`. Builds the full document scaffold (600px table, mobile media queries). |
| `lib/email-sections/*.js` (~53 files) | One section per file, each exporting `{render(props, brand, editable), schema}`. `schema.fields` drives the editor form. |
| `lib/email-sections/_helpers.js` | `escHtml`, `safeUrl`, `safeHex`, `scaleFont` (S→Huge text sizing), `editAttr`/`richAttr`/`richInline` (editor hooks + markdown bold/italic/link). |
| `lib/email-sections/_outlook-bulletproof.js` | VML bulletproof buttons, image-with-overlay. |
| `lib/email-brand.js` | Brand tokens (colours, fonts, logo, company block) + `getBrand(clientKit)` for per-client overrides. **Adapt:** replace the Travelgenix defaults with the new project's brand. |

### The API layer (adapt the storage calls, keep the contracts)
| File | Role |
|---|---|
| `api/email-render.js` | Thin wrapper over `renderEmail`. Pass `editable:true` ONLY for previews. |
| `api/email-compose.js` | Create queue record. Sanitises HTML, generates the unsub token, stores `Sections JSON` for round-tripping. |
| `api/email-action.js` | `approve` / `reject` / `edit` / `cancel` with an audit log. `edit` updates in place (subject, preview, bodies, sectionsJson, audience, schedule). Refuses edits to Sent. |
| `api/email-templates.js`, `email-templates-save.js` | Named templates (sections JSON snapshots). |
| `api/brevo-helper.js` | The whole Brevo wrapper — transactional, contacts, lists, campaigns, stats. Copy verbatim. |
| `api/email-send-audience.js` | The real send: requires Status="Approved", creates a Brevo **campaign** (sender name/reply-to resolved from the client record with fallbacks), targets `listIds`, calls `sendCampaignNow`, writes back campaign id + sent time. |
| `api/email-send-now.js`, `api/email-drip.js`, `api/email-send.js` | Transactional paths (tests, drips). |
| `api/email-cron.js` | Hourly: Status="Approved" AND (`Scheduled Send` <= now OR empty) → send. Protect with `Authorization: Bearer CRON_SECRET`. |
| `api/brevo-webhook.js` | Brevo events (delivered/open/click/bounce) back onto the record. |
| `api/email-list.js`, `email-detail.js`, `email-delete.js`, `api/audiences.js` | Queue listing, detail, delete, Brevo list browsing. |

### The builder UI (the biggest piece — lift from `public/client.html`)
Everything is in one file here; the email-builder parts are self-contained
and marked. Search for these anchors and copy each region:

1. `EB2_STYLES` — all builder CSS (scoped `.eb2-*`, uses `--tg-*` design tokens; bring the tokens or remap).
2. `function drawComposeForm` — the three-zone layout: top bar (Desktop/Mobile toggle, Preview, Schedule, Save), left rail (Blocks palette in labelled groups + Layers list), centre (inbox "envelope" + preview iframe `#builderPreviewFrame`), right (inspector driven by `renderPropertiesForm`).
3. `SECTION_META = {` — the client-side mirror of every section's `schema`. **Keep this in lockstep with the server schemas** (it drives the inspector form).
4. `__builderRenderPreview` → POSTs to `/api/email-render` with `editable:true`, writes the iframe (`sandbox="allow-same-origin"`), then calls the three enablers below.
5. `__builderEnableInlineEdit` + `__tgInlineCommit` + `__tgEnsureRichBar`/`__tgHtmlToMd` — contenteditable on `[data-tg-edit]` elements, commits keystrokes back into the sections model without reloading the iframe (preserves the caret), floating bold/italic/link toolbar for `[data-tg-rich]` fields, HTML↔markdown round-trip.
6. `__builderEnableBlockHover` — per-block hover toolbar (drag grip, move ↑↓, duplicate, delete) pinned INSIDE the block's top-right corner (pinning it above causes a hover-tunnel bug).
7. `__builderEnableCanvasDrop` + `__builderAddSectionAtIndex` + `__builderMoveSectionToIndex` — drag blocks from the palette onto the email with a drop-indicator line; drag existing blocks to reorder.
8. `renderPropertiesForm` / `renderField` — schema-driven form (text, longText, url, colour with brand swatches, `fontSize` S→Huge select, select, group, array-of-items).
9. Schedule modal (`__builderOpenScheduleModal` etc.), save flow (`__emailComposeSave` — render WITHOUT `editable`, then create-or-edit depending on `emailState.editingEmailId`).

### Optional subsystems (skip if not needed)
- AI composer (`api/email-compose-ai.js`, `email-compose-refine.js`, `lib/content-composer-*`) — needs `ANTHROPIC_API_KEY`.
- AI image generation (`api/image-generate-v2.js`, `lib/image-generator-v2.js`, `lib/brief-generator.js`, `lib/html-image-generator.js`) — needs HCTI + Vercel Blob.

---

## 4. Environment variables

| Var | Purpose |
|---|---|
| `BREVO_API_KEY` | Brevo v3 API key (`https://api.brevo.com/v3`, header `api-key`). |
| `BREVO_SENDER_NAME` / `BREVO_SENDER_EMAIL` | Default sender (per-client reply-to overrides it where present). Sender email **must be a verified sender in Brevo**. |
| `BREVO_LIST_*` | Numeric Brevo list ids per audience segment (e.g. `BREVO_LIST_INBOUND=12`). `resolveListId()` maps segment names → env names. |
| `AIRTABLE_KEY` | Storage (replace with your DB credentials if not Airtable). |
| `CRON_SECRET` | Bearer token protecting `/api/email-cron` (schedule it hourly, e.g. Vercel cron). |
| `PUBLIC_BASE_URL` | Used to build absolute unsubscribe URLs. |
| `ANTHROPIC_API_KEY` | Only for the optional AI composer. |

---

## 5. Data model (minimum fields)

**Email Queue** (one row per email):
`Subject`, `Preview Text`, `Body HTML` (rendered, sanitised), `Body Plain`,
`Sections JSON` (the builder's round-trip source — array of `{type, props}`),
`Status` (single select: `Awaiting Approval → Approved → Sent`, plus
`Rejected`, `Cancelled`), `Audience`, `Audience Segment`, `Email Type`,
`Recipient Email` (tests/drips), `Scheduled Send` (datetime),
`Unsub URL Token`, `Brevo Campaign ID`, `Sent At`, `Send Result`,
`Error Log`, `Client` (tenant link — drop if single-tenant).

**Clients** (tenant record): business name, reply-to email, logo/brand-kit
fields consumed by `getBrand`.

**Audit Log**: actor, action, subject id, details JSON — written by
`email-action.js` and the send endpoints.

---

## 6. Non-negotiable design rules (why it works)

1. **Sends are byte-clean.** `renderEmail` only emits editor hooks
   (`data-tg-edit`, `data-tg-rich`, `<tbody data-tg-sec>`) when
   `editable:true`. Save and send paths must NEVER pass `editable`. Test it:
   render with and without and assert no `data-tg-` in the send output.
2. **Table-based HTML only.** No flex/grid in email markup. Buttons use the
   VML bulletproof pattern. `bgcolor` attributes back every CSS background.
3. **Gmail strips `position`/`transform`/`filter` styles.** Never use
   absolutely-positioned decorative elements — a positioned div falls into
   normal flow as a giant empty block (we shipped that bug). Put glows in
   `background-image` stacks instead.
4. **No inline SVG in emails.** Gmail/Outlook/Yahoo strip it. Icons are
   hosted PNGs (`/public/email-icons/`, pre-rendered per colour theme) or
   emoji.
5. **Mobile clamp interplay.** The scaffold's `@media` rules clamp
   `.tg-hero-headline`/`.tg-hero-subhead` with `!important`; sections DROP
   those classes when the user picks a custom `fontSize` so the choice wins.
6. **Centred buttons need `margin:0 auto`** as well as `align="center"` —
   some webmail drops the deprecated attribute.
7. **User text is escaped** (`escHtml`), URLs validated (`safeUrl`), colours
   validated (`safeHex` — strict 6-digit hex) at the renderer. Prose fields
   go through `richInline` (markdown bold/italic/link only).
8. **Client & server schemas must not drift.** `SECTION_META` in the UI
   mirrors each section's `schema`. When you add a field, add it in both.
9. **If your DB is Airtable: paginate.** Single requests cap at 100 records
   (we shipped that bug too — scheduled items vanished).

---

## 7. Brevo specifics worth knowing

- **Campaigns vs transactional:** audience sends use the *campaign* API
  (`POST /emailCampaigns` then `POST /emailCampaigns/{id}/sendNow`) — proper
  unsubscribe handling, dedupe across lists, visible in Brevo's UI.
  Tests/drips use `POST /smtp/email` (transactional).
- **Unsubscribe:** the renderer replaces `{{UNSUB_URL}}` in footers; compose
  writes an `Unsub URL Token` per email. In campaign sends Brevo injects its
  own unsubscribe handling as well.
- **Hard gate:** `email-send-audience` refuses anything not `Approved` —
  keep that; it's the only thing between a draft and 10,000 inboxes.
- **Webhook:** point Brevo's webhook at `/api/brevo-webhook` for
  delivered/open/click/bounce write-back.

---

## 8. Suggested porting order

1. Copy `lib/email-*` wholesale; adapt `email-brand.js` to the new brand.
   Smoke-test: `renderEmail` on a few sections, assert byte-clean sends.
2. Stand up the DB with §5's fields; port `email-render`, `email-compose`,
   `email-action`, `email-list`, `email-detail`.
3. Copy `brevo-helper.js`; set env vars; wire `email-send-now` and send a
   transactional test to yourself.
4. Port the builder UI regions from `client.html` (§3, in the listed order —
   preview first, then inline edit, then drag/drop, then schedule/save).
5. Add `email-send-audience` + `email-cron` + the webhook. Send a real
   campaign to a one-person test list before anything bigger.

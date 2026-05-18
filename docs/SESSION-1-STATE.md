# Email AI Composer — Session 1 State

**Where we are:** End of Session 1. Foundation locked.
**Date:** 15 May 2026
**Next:** Session 2 — Build the composer endpoint + UI + validation.

---

## What this document is for

If a fresh Claude session picks up the email composer build (whether tomorrow or in three weeks), this doc is the first thing to read. It captures the exact state at the end of Session 1 so the next session opens with full context — no need to reconstruct from memory or scroll past chats.

Read order for next session:
1. **This file** (SESSION-1-STATE.md)
2. **`docs/email-composer-architecture.md`** in the luna-marketing repo
3. **The luna-email-composer skill** (auto-loads when the composer is touched)
4. Then start building

---

## Three-session plan

| Session | Goal | Status |
|---|---|---|
| **Session 1** | Architecture, skill, design doc. No code. | ✅ Done |
| **Session 2** | Build the composer endpoint, refinement endpoint, UI in client.html. Placeholder images. | ⏳ Next |
| **Session 3** | Visual layer — SVG generation, Asset Library upload UI, SVG-to-PNG pipeline | Future |

---

## What's done

### Skill written and installed
- **File:** `/mnt/skills/user/luna-email-composer/SKILL.md`
- **Length:** 470 lines
- **Status:** Installed and active. Auto-discovers on any composer-related work.
- **Contains:** Five non-negotiable laws, input/output contract, refinement loop spec, 6-layer system prompt blueprint, anti-hallucination tactics, failure modes, evaluation criteria.

### Architecture doc written
- **File:** `docs/email-composer-architecture.md` in the luna-marketing repo (once you push it)
- **Length:** 592 lines
- **Status:** Locked. Source of truth for how the composer is built.
- **Contains:** Data layer spec, system prompt construction, validation layer, UI flow with wireframes, API endpoint definitions, security review, scope boundary for Session 2.

### Decisions locked
- Sections JSON output (not raw HTML) — preserves editability
- 6-layer system prompt construction — deterministic, debuggable
- 8 automated validation checks — banned words, em dashes, Oxford commas, number hallucinations, quoted strings, URL allowlist, section schema, competitor names
- Refinement via prompt OR direct section edit — hybrid of A and B per Andy's call
- Brevo as the send provider — no change to existing send pipeline
- Placeholder images for Session 2 — visual layer deferred to Session 3

### Existing infrastructure confirmed
- **Email Templates table** `tblEJaTMeop8dy4d5` exists with 4 records:
  - `recODNyEIDIKyLHK5`
  - `recWtYpvmxSLM6vaH`
  - `reckTDoPcPwZnkdi4`
  - `recv1WVOUpNIB5itM`
- All have Sections JSON populated (confirmed via Airtable search)
- Full contents not yet inspected — to be done at start of Session 2
- Email render engine (`lib/email-renderer.js`, `api/email-render.js`) is live and accepts sections JSON
- `email-compose.js` is live, accepts sectionsJson, writes to Email Queue
- `email-send-now.js` is live, Brevo wired, audit log working
- Webhook for delivery status is live

---

## What's NOT done (tail items from before Session 1)

These were on the list but didn't get done in Session 1. Pick them up early in Session 2 or whenever fits:

### Content Engine UI deployment (3 files staged, not pushed)
Files sitting in outputs from earlier session:
- `api/content-engine-products.js` — full CRUD with owner override
- `api/content-engine-preview.js` — renderer preview endpoint
- `public/client.html` — patched with Content Engine tab, view, render function

Deploy order: preview → products → client.html. Each is a push to GitHub, auto-deploys to Vercel.

### Verification of deployed Promotion Engine output
- Yesterday's deploy of `lib/promotion-client.js`, patched `cron-generate.js`, patched `generate-blog.js`, patched `email-compose.js` — never verified in production
- Action: trigger social cron manually, look at output, check Promotion Engine closers are appearing in real posts
- Action: trigger blog generator in test mode (`?test=true`), confirm Solutions block appears in HTML

### "Promoted Product" linked field on Post Queue
- Not added yet
- 30-second job in Airtable
- Enables proper cooldown tracking — required for Phase 2.5 of Promotion Engine

---

## Open questions for Session 2

These should be resolved early in Session 2:

### Q1: Which Anthropic model for the composer?
Default suggestion: claude-opus-4.6 for quality
Cheaper alternative: claude-sonnet-4.6 (faster, lower cost, may be enough)
Recommendation: opus for first month, then evaluate against rework rate, drop to sonnet if quality holds

### Q2: How does the composer handle templates?
Two options when user picks a template:
- **(a)** Template provides starting Sections JSON, composer regenerates from scratch using template as structural hint
- **(b)** Template provides starting Sections JSON, composer only refines/fills slots, preserves template structure
Recommendation: (a) for v1 — simpler and more flexible. Templates as inspiration, not constraint.

### Q3: Where do refinement conversations live?
Each draft accumulates a refinement history. Two options:
- Store in Airtable as JSON on the Email Queue record
- Store in-memory only, lost on page reload
Recommendation: Airtable storage — enables "pick up where you left off" and is searchable for analysis later.

### Q4: How are warnings surfaced in the UI?
Composer returns `warnings: [...]` for soft issues. Two display options:
- Banner at top of preview, all warnings together
- Per-section warnings shown next to the relevant section card
Recommendation: per-section. More actionable. Banner only for cross-cutting warnings (e.g. "audience hasn't been emailed in 35 days").

---

## Critical reminders for Session 2

Things future-me will forget without prompting:

### Read the skill FIRST
Every Session 2 task starts with `view /mnt/skills/user/luna-email-composer/SKILL.md`. The skill is the contract. Do not assume you remember it.

### Read travelgenix-email-design too
The four archetypes, the design dials, the component library — all there. The composer outputs sections that the renderer turns into emails following that design system. Don't reinvent.

### Read travelgenix-humanizer too
The banned word list. The em dash rule. Every email must pass humaniser rules. The composer enforces this at generation time, validator catches anything that slips through.

### Don't ship anything that hasn't been validated end-to-end
The composer is high-stakes. One hallucinated stat in a client email is a credibility incident. Test with 10 real-feeling prompts before declaring Session 2 done.

### Multi-tenant from day one
Same pattern as Content Engine. Owner override allowed. Non-owner: tenant must match logged-in user. Every API call validates this server-side.

---

## Session 2 build order (from architecture doc §10)

When we start Session 2:

1. **Read the luna-email-composer skill** (mandatory)
2. **Read travelgenix-email-design, travelgenix-humanizer, travelgenix-security**
3. **Audit existing Email Templates table records** — read all 4, document Sections JSON shape, decide which to keep/replace
4. **Build the composer endpoint** — system prompt construction first (the heart), then the API wrapper
5. **Test the composer in isolation** — 10 test prompts with mocked context, eyeball every output for hallucinations, voice, structure
6. **Build the validation layer** — strict, fail-closed
7. **Build the refinement endpoint** — same pattern, simpler
8. **Build the UI in client.html** — modal, section cards, refinement input, save flow
9. **End-to-end test** — Andy generates 5 real emails, we adjust based on output
10. **Document any deviations from architecture doc** in the skill for future sessions

Estimated time: full session (60-120 minutes of focused work).

---

## Quick reference — IDs and paths

### Airtable
- **Base:** `appSoIlSe0sNaJ4BZ`
- **Clients table:** `tblUkzvBujc94Yali`
- **Travelgenix tenant:** `recFXQY7be6gMr4In`
- **Email Templates:** `tblEJaTMeop8dy4d5`
- **Email Queue:** `tblzM5FsiLiriVLT1`
- **Audit Log:** `tblLjf5OIp71hAEvC`
- **Product Library:** `tblGBl8X3RIVnCwDM` (25 humanised records)
- **Topic Mappings:** `tblBHXi2TVGQ5ke3W` (30 records)
- **Asset Library:** `tbljfFYXrNtAzexAJ` (empty — Session 3 populates)

### Repo
- **GitHub:** `andyspeight/luna-marketing`
- **Production URL:** `https://luna-marketing.vercel.app`
- **Portal URL:** `https://marketing.travelify.io/client.html`
- **Auth:** id.travelify.io SSO via `tg_session` cookie

### Environment variables to confirm before Session 2 build
- `ANTHROPIC_API_KEY` — required for composer
- `AIRTABLE_KEY` — already set
- `BREVO_API_KEY` — already set
- `PROMOTION_ENGINE_SECRET` — already set (composer may not need this directly)

---

## Files to deploy from earlier sessions (still pending)

| File | Path | Purpose |
|---|---|---|
| `content-engine-products.js` | `api/` in repo | Content Engine CRUD endpoint |
| `content-engine-preview.js` | `api/` in repo | Content Engine preview renderer |
| Patched `client.html` | `public/` in repo | Adds Content Engine tab + modal |

These are sitting in your downloads from the previous session under `content-engine-v1/`. Deploy when convenient — not blocking Session 2.

---

## What "done" looks like at end of Session 2

The bar for Session 2 completion:

- ✅ Andy can sit at the portal, click "Compose with AI", type "Write an email about Luna Chat for Boost-tier clients", and 10-15 seconds later see a fully drafted, brand-voiced, properly sectioned email with placeholder images.
- ✅ Refinement works: "make it shorter" produces a sensible shorter version.
- ✅ Direct section editing works: clicking a section card lets him edit text inline.
- ✅ Saved drafts appear in the existing Email Queue.
- ✅ The existing "Send now" flow still works on AI-composed drafts.
- ✅ Validator flags issues before the user can save (em dash, banned word, hallucinated stat).
- ✅ Audit log entries appear for every composer call.
- ✅ 5 real test emails generated, reviewed, with notes on what needs adjusting before Session 3.

What's deliberately NOT in Session 2:
- ❌ Real image generation (Session 3)
- ❌ Asset upload UI (Session 3)
- ❌ Pexels integration (Session 3)
- ❌ Auto-newsletter cron (Session 4 or later)

---

## Sign-off

**Session 1 complete.** Skill installed. Architecture locked. State captured. Ready to pause or push into Session 2 with full context preserved.

Next session opens by reading this file plus the skill plus travelgenix-email-design. Then we build.

*— End of Session 1 State document.*

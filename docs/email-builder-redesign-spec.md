# Email Builder Redesign — Build Spec

**Status:** Approved to build · phased
**Prototype:** `public/email-builder-mockup.html` (interactive concept — open in a browser)
**Owner:** Luna Marketing
**Last updated:** July 2026

---

## 1. Why we're doing this

The current email composer is a **three-panel, form-driven tool**: a section list, a
properties **form**, and a separate **server-rendered preview iframe**. You edit in the
middle panel and look at the right panel to see the result. Concretely (refs into
`public/client.html`):

- **Edit ≠ see.** Middle panel (`.email-builder-middle`, ~L5333) is a form built by
  `renderField()` (~L6537); the result appears in a sandboxed iframe
  (`#builder-preview-frame`, ~L5367). No on-canvas editing.
- **Feels laggy.** Every keystroke → `__builderUpdateField()` (~L6872) →
  `__builderPreviewDebounced()` (500ms, ~L7762) → `POST /api/email-render` →
  `iframe.doc.write()`. Type-and-wait, not WYSIWYG.
- **No rich text.** Copy fields are plain `<textarea>`/`<input>`; no bold/italic/link/
  colour inline.
- **Clunky structure edits.** Sections drag to reorder, but array items (offers,
  features, links) only move with ↑/↓ buttons; add-section is a wall of ~48 buttons;
  add/delete/reorder call `drawEmails()` which rebuilds the whole UI (loses focus/scroll).

**Goal:** a modern, on-canvas WYSIWYG builder — edit directly on the email, drag blocks
in, contextual settings, instant feedback — without losing what already works (the
section renderer, AI composer, live-offer hydration, brand kit, Brevo send).

---

## 2. The one hard constraint: rendering fidelity

Our emails render through a serious server-side system — `lib/email-sections/*`
(Outlook-bulletproof table HTML), plus AI compose, Travelify offer hydration, the brand
kit, and Brevo delivery. The current preview's *one* virtue is that it shows the **actual
HTML that sends**.

**A from-scratch on-canvas editor that renders its own browser approximation risks
diverging from Outlook/Gmail** ("looked great in the builder, broke in the inbox"), which
is worse than today's problem.

**Rule: the server renderer stays the source of truth.** We edit *on top of* the real
rendered output, not a re-implementation of it. This is why we go with the incremental
wedge (below) rather than a big-bang custom engine or an off-the-shelf SDK that brings its
own content model.

---

## 3. Target UX (what the prototype demonstrates)

1. **Direct manipulation** — drag blocks from a grouped, searchable palette onto the
   email; a drop indicator shows where they'll land. Drag a handle to reorder. Hover a
   block for move/duplicate/delete. A "+" in each seam opens a quick-add menu
   (blocks + "Generate with AI…").
2. **Inline editing** — click any text and type. Select it → a floating toolbar (bold,
   italic, link, size, **full colour palette + custom picker**, per-word).
3. **Contextual settings** — the right panel shows *only* the selected block's options
   (colours with brand quick-pick, alignment, padding, per-text **Small→Huge** size,
   heading line-height/letter-spacing).
4. **Responsive & instant** — local live render (no per-keystroke server round-trip);
   Desktop/Mobile toggle; **large text auto-reduces on mobile** so "Huge" headlines fit a
   phone. Layers outline, autosave, undo/redo.
5. **Whole-email anatomy** — inbox "envelope" (From, audience, editable Subject + Preview
   text); AI assist slide-over (brand/offer-aware); Send/Schedule flow
   (audience → review/test → schedule).
6. **Native look** — built on existing design tokens; light + dark; the email canvas
   stays light (as it renders in an inbox).

---

## 4. Block inventory (target)

Existing content sections keep their renderers. Prototype block set (maps to real
sections where one exists):

| Group | Blocks |
|---|---|
| Headers & heroes | Header, Hero (coloured/dark/image) |
| Content | Text, Features (tiles), Columns, List, Quote, Testimonial, Button, Image, Video, Gallery |
| Commerce | Offers (live Travelify), Stats, CTA banner |
| Structure & footer | Divider, Spacer, Social, Footer |

Every text slot carries a size preset (S/M/L/XL/Huge) that auto-reduces on mobile; every
colour control offers a brand quick-pick row.

---

## 5. Data model / contract

Keep the current shape: an email is an ordered array of `{ type, props }` sections.
Renderers already read `props`; the redesign adds **editing metadata**, not a new model.

**Enabler — editable-element attributes.** Each section renderer emits a stable
`data-tg-edit="<propPath>"` on every user-editable text element (e.g.
`data-tg-edit="headline"`, `data-tg-edit="features.0.heading"`). This is what lets a click
on the rendered email map back to a section prop. It is **additive and invisible** — no
change to how the email renders or sends.

Colour/size/spacing already live in props (this session shipped per-field size + colour
controls across the section library); the on-canvas controls write the same props.

---

## 6. Phased plan

Built as an incremental wedge on the existing builder — each phase ships value on its own.

### Phase 1 — On-canvas inline editing (biggest felt win, lowest risk)
Keep the current 3-panel builder and server preview; make the preview **directly
editable**.
- **1a. Foundation:** emit `data-tg-edit` attributes from the section renderers (start
  with the most-used: hero-coloured, feature-tiles, text, cta; then the rest). *Safe,
  additive.*
- **1b. Inline edit layer (`client.html`):** on preview load, mark
  `[data-tg-edit]` elements `contenteditable`; on input, write back to the section prop
  via the existing `setNestedValue`; re-render on blur/section-change (not per keystroke,
  to keep the caret).
- **1c. Floating rich-text toolbar:** bold / italic / link / colour (brand palette +
  custom) / size, applied to the selection.

### Phase 2 — Direct manipulation
- Replace the section picker + middle form with **drag-to-place** blocks (palette →
  canvas with drop indicator) and the **contextual inspector** (per-block settings only).
- Drag-to-reorder for array items (offers/features/links), not just ↑/↓.
- Avoid full `drawEmails()` rebuilds — patch the DOM so focus/scroll survive.

### Phase 3 — Instant + assist
- Local live render to kill the 500ms lag (server render remains the source of truth for
  test/send and final output).
- Layers outline, undo/redo, AI-assist slide-over, Send/Schedule flow polish.

---

## 7. Risks & decisions

- **Fidelity (see §2):** never replace the server renderer; edit on top of it. Test/send
  always uses the real render.
- **contentEditable quirks:** scope editing to text slots only; sanitise pasted HTML to
  the allowed inline set (bold/italic/link/colour/size) already supported by
  `_helpers.inlineMarkdown`.
- **Build vs buy:** an embeddable SDK (Beefree/Unlayer/GrapesJS) was considered and set
  aside — each brings its own content model and export HTML, which would fight the AI
  composer, offer hydration and bulletproof renderer. Revisit only if the wedge stalls.
- **Backwards compatibility:** the data model is unchanged, so existing saved emails and
  the AI composer keep working throughout.

---

## 8. Definition of done (Phase 1)

- Section renderers emit `data-tg-edit` on all editable text (no visual/behavioural
  change to sent email — verified by snapshot of rendered HTML sans attributes).
- In the builder, clicking hero/text/feature/cta copy on the preview lets you edit it in
  place; changes persist to props and survive save/reload.
- A floating toolbar styles the selection; output round-trips through the server renderer
  unchanged for everything except the intended edit.

# Design References

Canonical email design mockups for the Luna Marketing email rendering system.

## What these are

Visual ground-truth references showing exactly what each email archetype should look like when rendered. They're not production code and they're not shipped to clients. They're the source of truth for the renderer, the AI plan generator, and any human reviewing email design quality.

Every email Luna Marketing produces should match the visual standard set here.

## What's in this folder

| File | Archetype | Use case |
|------|-----------|----------|
| `marketing-newsletter.html` | B (Marketing Newsletter) | Monthly destination newsletter, seasonal campaigns, client-facing editorial |
| `b2b-weekly.html` | A (B2B Weekly) | Recurring Friday B2B newsletter — The Travelgenix Weekly |
| `product-launch.html` | C (Product Launch) | New product or feature announcements (e.g. Luna Chat launch) |
| `transactional.html` | D (Transactional) | Booking confirmations, receipts, password resets, system-triggered emails |

## How they fit the stack

```
User describes email in plain English
         ↓
AI plan generator (Part E)
         ↓
Sections JSON (matches the schema in travelgenix-email-design SKILL.md §5)
         ↓
Email Templates table in Airtable (appSoIlSe0sNaJ4BZ / tblEJaTMeop8dy4d5)
         ↓
Renderer (Part C) — must produce HTML matching THESE references
         ↓
Brevo → recipient inbox
```

## Anti-fabrication rule

The names, prices, stats, and quotes in these mockups are placeholders for design purposes. The AI plan generator and renderer must NEVER ship emails with these placeholder values — every dynamic value must come from real data (Airtable record, supplier API, or explicit user input).

## When to update these references

Update only when the design system itself changes. Updating one mockup means updating the corresponding archetype in the `travelgenix-email-design` skill. Don't update mockups to fit one-off campaigns — campaigns compose from the existing components, they don't redefine them.

## Related

- **Skill:** `travelgenix-email-design` — design law, component library, archetype rules, structured plan schema
- **Airtable table:** Email Templates (`tblEJaTMeop8dy4d5` in `appSoIlSe0sNaJ4BZ`)
- **Web preview:** Open any HTML file in a browser. Each has a dark-mode toggle in the top right.

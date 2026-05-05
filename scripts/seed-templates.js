// scripts/seed-templates.js
// One-off script to seed the Email Templates table with the 5 starting templates.
// Run via: node scripts/seed-templates.js
// Requires AIRTABLE_KEY env var.
//
// IMPORTANT: Run this AFTER the Email Templates table has been created in Airtable.

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const TEMPLATES_TABLE = "Email Templates";

// The 5 starting templates. Each template = name + sections array.
// Section props use sensible placeholders that Luna or Andy can edit.

const TEMPLATES = [
  {
    name: "Newsletter",
    description: "Multi-section newsletter with hero, three articles, CTA",
    category: "Marketing",
    sections: [
      { type: "header", props: {} },
      {
        type: "hero",
        props: {
          headline: "Your headline goes here",
          subhead: "Lead with the single most important thing this newsletter is about.",
          ctaText: "Read more",
          ctaUrl: "https://travelgenix.io",
          accent: "teal",
        },
      },
      {
        type: "article",
        props: {
          headline: "First story",
          body: "Open with a one-sentence hook, then add 2-3 short sentences of context. Keep it scannable — most readers skim newsletters on mobile.",
          linkText: "Read the full story",
          linkUrl: "https://travelgenix.io",
          imagePosition: "left",
        },
      },
      { type: "divider", props: { style: "thin" } },
      {
        type: "article",
        props: {
          headline: "Second story",
          body: "Different angle, different image. Mix product news, customer stories, industry takes.",
          linkText: "Learn more",
          linkUrl: "https://travelgenix.io",
          imagePosition: "right",
        },
      },
      { type: "divider", props: { style: "thin" } },
      {
        type: "article",
        props: {
          headline: "Third story",
          body: "Close the article block with something practical — a tip, a how-to, or a quick win.",
          linkText: "See the guide",
          linkUrl: "https://travelgenix.io",
          imagePosition: "left",
        },
      },
      {
        type: "cta",
        props: {
          headline: "Want to talk?",
          body: "Book a 15-minute call. No pitch — just a chat about what you are working on.",
          ctaText: "Book a call",
          ctaUrl: "https://travelgenix.io/demo",
          variant: "tint",
        },
      },
      {
        type: "footer",
        props: {
          tagline: "Everything just got a little easier...",
        },
      },
    ],
  },
  {
    name: "Product update",
    description: "Single-feature announcement: hero, explainer, CTA",
    category: "Marketing",
    sections: [
      { type: "header", props: {} },
      {
        type: "hero",
        props: {
          headline: "[Feature] is here",
          subhead: "One-sentence promise that names the outcome, not the feature.",
          ctaText: "See it in action",
          ctaUrl: "https://travelgenix.io",
          accent: "teal",
        },
      },
      {
        type: "text",
        props: {
          headline: "What is new",
          body: "Open with the problem this solves. Then explain how the new feature changes the workflow. Keep paragraphs short — 2-3 sentences max.\n\nUse **bold** to highlight the most important phrase. End with a clear next step.",
        },
      },
      {
        type: "two-column",
        props: {
          left: {
            headline: "Benefit one",
            body: "Outcome-led one-liner. What does the customer get?",
            linkText: "Learn more",
            linkUrl: "https://travelgenix.io",
          },
          right: {
            headline: "Benefit two",
            body: "Different outcome, same crisp framing.",
            linkText: "Learn more",
            linkUrl: "https://travelgenix.io",
          },
        },
      },
      {
        type: "cta",
        props: {
          headline: "Ready to see it?",
          body: "Book a 15-minute demo and we will show you the feature on a real itinerary.",
          ctaText: "Book a demo",
          ctaUrl: "https://travelgenix.io/demo",
          variant: "solid",
        },
      },
      { type: "footer", props: {} },
    ],
  },
  {
    name: "Event invite",
    description: "Date and venue prominent, RSVP CTA — for trade shows, webinars, dinners",
    category: "Marketing",
    sections: [
      { type: "header", props: {} },
      {
        type: "hero",
        props: {
          headline: "Come and see us at [event]",
          subhead: "[Date] · [Venue] · [City]",
          ctaText: "Book a meeting",
          ctaUrl: "https://travelgenix.io/event",
          accent: "pink",
        },
      },
      {
        type: "text",
        props: {
          headline: "What we will be showing",
          body: "Tell them why this is worth their time. One paragraph: what you will demonstrate, what they will leave knowing, and why now.",
        },
      },
      {
        type: "two-column",
        props: {
          left: {
            headline: "When",
            body: "[Day, Date]\n[Start time] – [End time]",
          },
          right: {
            headline: "Where",
            body: "[Venue name]\n[Stand / room number]\n[City, country]",
          },
        },
      },
      {
        type: "cta",
        props: {
          headline: "Want to book a slot?",
          body: "We are blocking out 30-minute meeting slots — first come, first served.",
          ctaText: "Reserve a slot",
          ctaUrl: "https://travelgenix.io/event",
          variant: "tint",
        },
      },
      { type: "footer", props: {} },
    ],
  },
  {
    name: "Welcome",
    description: "Single-column warm welcome for new clients or signups",
    category: "Onboarding",
    sections: [
      { type: "header", props: {} },
      {
        type: "hero",
        props: {
          headline: "Welcome to Travelgenix",
          subhead: "We are genuinely glad you are here. Here is what happens next.",
          ctaText: "Get started",
          ctaUrl: "https://travelgenix.io/start",
          accent: "teal",
        },
      },
      {
        type: "text",
        body: "",
        props: {
          headline: "What to expect this week",
          body: "Over the next few days you will hear from your account manager and get access to your dashboard. Two things happen first:\n\n1. We set up your branding and supplier connections.\n2. We walk you through Travelgenix University so you know how to get the most out of every feature.\n\nIf you have any questions before then, just reply to this email. A real person will read it.",
        },
      },
      {
        type: "cta",
        props: {
          headline: "Have a question right now?",
          body: "We are easy to reach. Reply to this email or book a quick call.",
          ctaText: "Book a call",
          ctaUrl: "https://travelgenix.io/contact",
          variant: "tint",
        },
      },
      {
        type: "footer",
        props: {
          tagline: "Everything just got a little easier...",
        },
      },
    ],
  },
  {
    name: "Drip step",
    description: "Minimal conversational drip email — single column, one CTA",
    category: "Drip",
    sections: [
      { type: "header", props: {} },
      {
        type: "text",
        props: {
          headline: "Quick thought",
          body: "Open with one sentence that names the prospect's problem in their own words.\n\nFollow with one sentence about how Travelgenix specifically addresses that problem. Not a feature list — one specific thing.\n\nClose with a soft ask. Not 'book a demo' — something easier, like 'reply if you want to know more' or 'happy to send a 2-minute video walkthrough'.",
        },
      },
      {
        type: "cta",
        props: {
          headline: "",
          body: "If this resonates, here is a 15-minute slot.",
          ctaText: "Pick a time",
          ctaUrl: "https://travelgenix.io/contact",
          variant: "plain",
        },
      },
      {
        type: "footer",
        props: {
          showUnsub: true,
        },
      },
    ],
  },
  {
    name: "Blank canvas",
    description: "Just header and footer — stack any sections you want in between",
    category: "Custom",
    sections: [
      { type: "header", props: {} },
      { type: "footer", props: {} },
    ],
  },
];

async function main() {
  if (!AIRTABLE_KEY) {
    console.error("AIRTABLE_KEY env var required");
    process.exit(1);
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TEMPLATES_TABLE)}`;

  const records = TEMPLATES.map((t) => ({
    fields: {
      "Name": t.name,
      "Description": t.description,
      "Category": t.category,
      "Sections JSON": JSON.stringify(t.sections, null, 2),
      "Active": true,
    },
  }));

  // Airtable allows up to 10 per call
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: batch, typecast: true }),
    });
    if (!r.ok) {
      console.error(`Batch ${i / 10 + 1} failed:`, await r.text());
      process.exit(1);
    }
    const data = await r.json();
    console.log(`Seeded ${data.records.length} templates (batch ${i / 10 + 1})`);
  }

  console.log("✓ Done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

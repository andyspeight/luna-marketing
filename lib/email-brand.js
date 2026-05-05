// lib/email-brand.js
// Single source of truth for Travelgenix email branding.
// Used by all section templates and the renderer.

const BRAND = {
  // Travelgenix palette
  teal: "#0ABAB5",
  tealDeep: "#067A75",
  tealDarker: "#055552",
  pink: "#EC2D8E",
  yellow: "#FFB627",

  // Neutrals
  ink: "#0F172A",
  inkSoft: "#334155",
  inkMuted: "#64748B",
  inkLight: "#94A3B8",

  // Surfaces
  paper: "#F5F1EA",         // warm cream background
  surface: "#FFFFFF",       // card white
  surfaceMuted: "#F8FAFC",  // very light grey-blue

  // Lines
  rule: "#E5E0D5",
  ruleSubtle: "#F1F5F9",
  ruleDark: "#CBD5E1",
};

const LOGO_URL =
  "https://irp.cdn-website.com/89c0010b/dms3rep/multi/Travelgenix-RecreteOurLogo-SM-13Sep2023-V1-Black-8529449a.png";

const COMPANY = {
  name: "Travelgenix",
  url: "https://travelgenix.io",
  address: "Travelgenix Ltd, Bournemouth, United Kingdom",
  supportEmail: "support@travelgenix.io",
};

// Email-safe font stack. Inter where it loads, system fallbacks otherwise.
const FONTS = {
  body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  heading: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

module.exports = { BRAND, LOGO_URL, COMPANY, FONTS };

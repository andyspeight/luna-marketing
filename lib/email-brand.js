// lib/email-brand.js
// Single source of truth for Travelgenix email branding.
// Used by all section templates and the renderer.
//
// May 2026 update — added new design system tokens (DESIGN_TOKENS) alongside
// the existing palette (BRAND). New components built per the
// travelgenix-email-design skill use DESIGN_TOKENS. Existing components
// continue to use BRAND. Both can coexist; long-term plan is gradual
// migration of older components onto the new tokens.

const BRAND = {
  // Travelgenix legacy palette (pre-design-system)
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

// New design system tokens (May 2026) — used by all components built
// per the travelgenix-email-design skill. See SKILL.md §3.1 for full mapping.
const DESIGN_TOKENS = {
  // Primary brand
  primary: "#1B2B5B",        // Navy — masthead, top bars, dark heroes
  primaryDark: "#0A0F1F",    // Deep navy — layered launch heroes
  primaryLight: "#2A3F7A",   // Mid navy — gradient pairing

  // Accent
  accent: "#00B4D8",         // Vivid teal — primary CTA, links, kickers
  accentLight: "#48CAE4",    // Light teal — kicker on dark, gradient pair
  accentDark: "#0096B7",     // Dark teal — link hover

  // Status (for transactional)
  success: "#10B981",        // Green — confirmation, settled, paid
  successBg: "#ECFDF5",      // Pale green tile background

  // Text
  textPrimary: "#0F172A",    // Body headlines (matches legacy ink)
  textSecondary: "#475569",  // Body copy
  textTertiary: "#94A3B8",   // Meta, captions, dates

  // Surfaces
  bgPrimary: "#FFFFFF",      // Email background (white, not warm cream)
  bgSecondary: "#F8FAFC",    // Section background, footer
  bgTertiary: "#F1F5F9",     // Card background, dividers
  border: "#E2E8F0",
  borderLight: "#F1F5F9",
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

module.exports = { BRAND, DESIGN_TOKENS, LOGO_URL, COMPANY, FONTS };

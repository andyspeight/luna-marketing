// lib/email-brand.js
// Single source of truth for Travelgenix email branding.
// Used by all section templates and the renderer.
//
// May 2026 update — added new design system tokens (DESIGN_TOKENS) alongside
// the existing palette (BRAND). New components built per the
// travelgenix-email-design skill use DESIGN_TOKENS. Existing components
// continue to use BRAND. Both can coexist; long-term plan is gradual
// migration of older components onto the new tokens.
//
// May 2026 update 2 — brand kit support. The constants below are still
// exported as before (Travelgenix defaults). NEW: getBrand(clientKit)
// returns the same shape with the client's overrides merged in. Sections
// that take a brand parameter get per-client theming; sections that don't
// (legacy callers) continue to use the static Travelgenix defaults.

// ─────────────────────────────────────────────────────────────────────
// LEGACY TOKENS — Travelgenix pre-design-system palette. Some older
// components still reference these; keeping the export so they don't
// break. New code should not add references to BRAND.
// ─────────────────────────────────────────────────────────────────────
const BRAND = {
  teal: "#0ABAB5",
  tealDeep: "#067A75",
  tealDarker: "#055552",
  pink: "#EC2D8E",
  yellow: "#FFB627",

  ink: "#0F172A",
  inkSoft: "#334155",
  inkMuted: "#64748B",
  inkLight: "#94A3B8",

  paper: "#F5F1EA",
  surface: "#FFFFFF",
  surfaceMuted: "#F8FAFC",

  rule: "#E5E0D5",
  ruleSubtle: "#F1F5F9",
  ruleDark: "#CBD5E1",
};

// ─────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — Travelgenix defaults. Every component uses these.
// A subset (primary, primaryDark, primaryLight, accent, accentLight,
// accentDark) is overridable per-client by the brand kit. The rest are
// universal email design tokens (text colours, surfaces, borders,
// status) and stay fixed across clients.
// ─────────────────────────────────────────────────────────────────────
const DESIGN_TOKENS = {
  primary: "#1B2B5B",
  primaryDark: "#0A0F1F",
  primaryLight: "#2A3F7A",

  accent: "#00B4D8",
  accentLight: "#48CAE4",
  accentDark: "#0096B7",

  success: "#10B981",
  successBg: "#ECFDF5",

  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textTertiary: "#94A3B8",

  bgPrimary: "#FFFFFF",
  bgSecondary: "#F8FAFC",
  bgTertiary: "#F1F5F9",
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

// ─────────────────────────────────────────────────────────────────────
// Colour utilities — used to derive primaryLight/primaryDark from a
// client's chosen primary colour.
// ─────────────────────────────────────────────────────────────────────
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}
function rgbToHex({ r, g, b }) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
// Lighten by mixing with white. amt is 0..1, where 0.25 = 25% lighter.
function lighten(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return rgbToHex({
    r: c.r + (255 - c.r) * amt,
    g: c.g + (255 - c.g) * amt,
    b: c.b + (255 - c.b) * amt,
  });
}
// Darken by mixing with black.
function darken(hex, amt) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return rgbToHex({ r: c.r * (1 - amt), g: c.g * (1 - amt), b: c.b * (1 - amt) });
}

// ─────────────────────────────────────────────────────────────────────
// getBrand(clientKit)
//
// Returns the same { DESIGN_TOKENS, FONTS, LOGO_URL, COMPANY, BRAND }
// shape as the module's static exports, but with the client's brand kit
// overrides merged in. Designed so that:
//
//   • If clientKit is null/undefined/empty, returns exact Travelgenix
//     defaults (backward compat — components that don't take a brand
//     param still work).
//
//   • Only the overridable subset is replaced: primary, primaryDark,
//     primaryLight, accent, accentLight, accentDark, font, logo URL,
//     company name/url/supportEmail. Other tokens stay as defaults.
//
//   • primaryLight is auto-derived as a 20% lighten of primary unless
//     a manual override is later added. primaryDark uses the explicit
//     darkColour from the brand kit if present, else a 45% darken of
//     primary.
//
//   • accentLight and accentDark are derived similarly from accent.
//
// clientKit shape mirrors the output of brand-kit.js buildBrandKit().
// ─────────────────────────────────────────────────────────────────────
function getBrand(clientKit) {
  if (!clientKit || typeof clientKit !== "object") {
    return { DESIGN_TOKENS, FONTS, LOGO_URL, COMPANY, BRAND };
  }

  // Case-insensitive hex equality. Lets us detect when a client's stored
  // colour matches the canonical Travelgenix value (case-irrespective of
  // how it was saved) so we can preserve hand-tuned tints instead of
  // recomputing them mathematically.
  const sameHex = (a, b) =>
    typeof a === "string" &&
    typeof b === "string" &&
    a.toLowerCase() === b.toLowerCase();

  const primary = clientKit.primaryColour || DESIGN_TOKENS.primary;
  // For Travelgenix's canonical primary, preserve hand-tuned shades.
  // For any other primary, derive lighter/darker variants mathematically.
  const primaryDark = clientKit.darkColour
    || (sameHex(primary, DESIGN_TOKENS.primary) ? DESIGN_TOKENS.primaryDark : darken(primary, 0.45));
  const primaryLight = sameHex(primary, DESIGN_TOKENS.primary)
    ? DESIGN_TOKENS.primaryLight
    : lighten(primary, 0.2);

  const accent = clientKit.accentColour || DESIGN_TOKENS.accent;
  const accentLight = sameHex(accent, DESIGN_TOKENS.accent)
    ? DESIGN_TOKENS.accentLight
    : lighten(accent, 0.25);
  const accentDark = sameHex(accent, DESIGN_TOKENS.accent)
    ? DESIGN_TOKENS.accentDark
    : darken(accent, 0.2);

  const fontName = clientKit.font || "Inter";
  const fontStack = `'${fontName}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

  const logo = clientKit.logoUrl || LOGO_URL;

  return {
    DESIGN_TOKENS: {
      ...DESIGN_TOKENS,
      primary,
      primaryDark,
      primaryLight,
      accent,
      accentLight,
      accentDark,
    },
    FONTS: { body: fontStack, heading: fontStack },
    LOGO_URL: logo,
    LOGO_DARK_URL: clientKit.logoDarkUrl || logo,
    LOGO_MARK_URL: clientKit.logoMarkUrl || "",
    COMPANY: {
      name: clientKit.businessDisplayName || clientKit.businessName || COMPANY.name,
      url: clientKit.websiteUrl || COMPANY.url,
      address: COMPANY.address,
      supportEmail: clientKit.replyToEmail || COMPANY.supportEmail,
    },
    BRAND,
    BRAND_KIT: clientKit,
  };
}

module.exports = {
  BRAND,
  DESIGN_TOKENS,
  LOGO_URL,
  COMPANY,
  FONTS,
  getBrand,
  lighten,
  darken,
  hexToRgb,
  rgbToHex,
};

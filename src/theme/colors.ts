// ---------------------------------------------------------------------------
// Chakaas Player — "Arc Reactor" design system (Iron Man / J.A.R.V.I.S. HUD)
// ---------------------------------------------------------------------------
//
// DARK-FIRST. The default app scheme is `dark`. Two genuinely distinct palettes
// live here: `darkColors` (the real Arc Reactor set) and `lightColors` (a true
// light set — NOT a clone of dark).
//
// Each palette exposes the canonical SEMANTIC tokens (bg, bgElevated, bgRaised,
// surface, border, borderAccent, textPrimary, textSecondary, textTertiary,
// accent, accentGlow, accentMuted, gold, goldMuted, danger, overlay, plus the
// brandGradient / goldGradient arrays).
//
// To keep the app compiling AND rendering dark immediately while individual
// screens migrate, every palette ALSO carries the historical LEGACY aliases
// (background, surface, text, card, accent, border, …) mapped onto the new
// values. Do not remove these aliases until every screen has migrated.
// ---------------------------------------------------------------------------

// Brand gradients (shared between schemes for the hero/FAB/accent surfaces).
const brandGradient = ['#19E3FF', '#0A84FF'] as const; // cyan → blue
const goldGradient = ['#FFD479', '#F5B642'] as const; // Iron Man gold

// ---------------------------------------------------------------------------
// `palette` — flat token bag consumed directly by some legacy primitives.
// Recoloured to the Arc Reactor DARK values so module-scope StyleSheets that
// read `palette.*` render dark out of the box. Every historical key is kept.
// ---------------------------------------------------------------------------
export const palette = {
  black: '#000000',
  white: '#FFFFFF',

  // Surfaces (dark canvas → elevated → raised)
  background: '#07090D',
  groupedBackground: '#07090D',
  surface: '#0E1218',
  surfaceMuted: '#161C26',

  // Hairlines
  separator: 'rgba(255,255,255,0.08)',
  separatorSubtle: 'rgba(255,255,255,0.06)',

  // Text
  textPrimary: '#EAF6FF',
  textSecondary: '#8A97A6',
  textTertiary: '#5A6473',

  // Arc-reactor cyan accent
  accent: '#19E3FF',
  accentPressed: '#0A84FF',
  accentSoft: 'rgba(25,227,255,0.16)',
  purple: '#5FF0FF', // legacy "secondary accent" → arc glow
  blue: '#0A84FF',

  // Semantic
  success: '#34D399',
  error: '#FF3B47',
  warning: '#F5B642',

  // Glass / shimmer tokens used by frosted headers and skeleton placeholders.
  glass: 'rgba(7,9,13,0.6)',
  shimmerBase: '#161C26',
  shimmerHighlight: '#1E2632',
} as const;

// ---------------------------------------------------------------------------
// DARK — the real Arc Reactor set (DEFAULT scheme).
// ---------------------------------------------------------------------------
export const darkColors = {
  // ── Canonical semantic tokens ──────────────────────────────────────────
  bg: '#07090D',
  bgElevated: '#0E1218',
  bgRaised: '#161C26',
  surface: '#0E1218', // alias of bgElevated for legacy callers
  border: 'rgba(255,255,255,0.08)',
  borderAccent: 'rgba(25,227,255,0.14)',
  textPrimary: '#EAF6FF',
  textSecondary: '#8A97A6',
  textTertiary: '#5A6473',
  accent: '#19E3FF',
  accentGlow: '#5FF0FF',
  accentMuted: 'rgba(25,227,255,0.16)',
  gold: '#F5B642',
  goldMuted: 'rgba(245,182,66,0.16)',
  danger: '#FF3B47',
  overlay: 'rgba(3,5,8,0.6)',
  brandGradient,
  goldGradient,

  // ── Legacy aliases (kept so un-migrated screens compile + render dark) ──
  background: '#07090D', // → bg
  surfaceElevated: '#161C26', // → bgRaised
  borderSubtle: 'rgba(255,255,255,0.06)',
  text: '#EAF6FF', // → textPrimary
  accentSecondary: '#5FF0FF', // → accentGlow
  tabBar: '#0E1218', // → bgElevated
  card: '#0E1218', // → bgElevated
  playerBackground: '#07090D', // → bg
  miniPlayer: '#0E1218', // → bgElevated
} as const;

// ---------------------------------------------------------------------------
// LIGHT — a genuine light scheme (used by the toggle). NOT a clone of dark.
// ---------------------------------------------------------------------------
export const lightColors = {
  // ── Canonical semantic tokens ──────────────────────────────────────────
  bg: '#F4F6F8',
  bgElevated: '#FFFFFF',
  bgRaised: '#EBEFF3',
  surface: '#FFFFFF', // alias of bgElevated for legacy callers
  border: 'rgba(0,0,0,0.08)',
  borderAccent: 'rgba(10,180,214,0.18)',
  textPrimary: '#0B0F14',
  textSecondary: '#5A6473',
  textTertiary: '#8A97A6',
  accent: '#0AB4D6',
  accentGlow: '#19E3FF',
  accentMuted: 'rgba(10,180,214,0.14)',
  gold: '#C8860A',
  goldMuted: 'rgba(200,134,10,0.16)',
  danger: '#E03038',
  overlay: 'rgba(11,15,20,0.4)',
  brandGradient,
  goldGradient,

  // ── Legacy aliases ──────────────────────────────────────────────────────
  background: '#F4F6F8', // → bg
  surfaceElevated: '#EBEFF3', // → bgRaised
  borderSubtle: 'rgba(0,0,0,0.05)',
  text: '#0B0F14', // → textPrimary
  accentSecondary: '#19E3FF', // → accentGlow
  tabBar: '#FFFFFF',
  card: '#FFFFFF',
  playerBackground: '#F4F6F8',
  miniPlayer: '#FFFFFF',
} as const;

// The semantic contract every consumer can rely on. `darkColors` carries extra
// legacy aliases, so we derive the shared shape from the union of both sets.
export type SemanticColors = typeof darkColors;
export type Colors = typeof darkColors | typeof lightColors;

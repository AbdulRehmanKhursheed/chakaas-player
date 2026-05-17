export const palette = {
  black: '#000000',
  white: '#FFFFFF',
  background: '#F5F5F7',
  groupedBackground: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F9F9FB',
  separator: '#D2D2D7',
  separatorSubtle: '#E5E5EA',
  textPrimary: '#1D1D1F',
  textSecondary: '#6E6E73',
  textTertiary: '#8E8E93',

  // Apple Music-inspired brand accent
  accent: '#FA233B',
  accentPressed: '#D91F34',
  accentSoft: 'rgba(250,35,59,0.10)',
  purple: '#AF52DE',
  blue: '#007AFF',

  // Semantic
  success: '#34C759',
  error: '#FF3B30',
  warning: '#FF9F0A',

  // Glass / shimmer tokens — used by frosted headers and skeleton placeholders.
  // Kept in `palette` so both dark and light themes can pick them up without
  // duplicating values.
  glass: 'rgba(20,20,22,0.7)',
  shimmerBase: '#222222',
  shimmerHighlight: '#333333',
} as const;

export const darkColors = {
  background: palette.background,
  surface: palette.surface,
  surfaceElevated: palette.surface,
  border: palette.separator,
  borderSubtle: palette.separatorSubtle,
  text: palette.textPrimary,
  textSecondary: palette.textSecondary,
  textTertiary: palette.textTertiary,
  accent: palette.accent,
  accentSecondary: palette.purple,
  tabBar: '#FFFFFF',
  card: palette.surface,
  playerBackground: palette.background,
  miniPlayer: '#FFFFFF',
} as const;

export const lightColors = {
  background: palette.background,
  surface: palette.surface,
  surfaceElevated: palette.surface,
  border: palette.separator,
  borderSubtle: palette.separatorSubtle,
  text: palette.textPrimary,
  textSecondary: palette.textSecondary,
  textTertiary: palette.textTertiary,
  accent: palette.accent,
  accentSecondary: palette.purple,
  tabBar: '#FFFFFF',
  card: '#FFFFFF',
  playerBackground: palette.background,
  miniPlayer: '#FFFFFF',
} as const;

export type Colors = typeof darkColors | typeof lightColors;

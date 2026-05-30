import { darkColors, lightColors } from './colors';
import { textStyles } from './typography';
import { spacing, borderRadius, darkShadows, lightShadows } from './spacing';
import { useUIStore } from '@/stores/uiStore';

export type Theme = {
  colors: typeof darkColors | typeof lightColors;
  typography: typeof textStyles;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
  shadows: typeof darkShadows;
  isDark: boolean;
};

const darkTheme: Theme = {
  colors: darkColors,
  typography: textStyles,
  spacing,
  borderRadius,
  shadows: darkShadows,
  isDark: true,
};

const lightTheme: Theme = {
  colors: lightColors,
  typography: textStyles,
  spacing,
  borderRadius,
  shadows: lightShadows,
  isDark: false,
};

// Convenience export for cases where the theme is needed outside React
// (e.g. StyleSheet.create calls at module scope). Defaults to DARK so
// module-scope styles render the Arc Reactor look out of the box.
export const theme = darkTheme;

export function useTheme(): Theme {
  const colorScheme = useUIStore((state) => state.colorScheme);
  return colorScheme === 'dark' ? darkTheme : lightTheme;
}

// Re-export building blocks for consumers that need individual tokens
export { darkColors, lightColors, palette } from './colors';
export type { Colors, SemanticColors } from './colors';
export { textStyles, fontSizes, fontWeights, lineHeights, letterSpacings } from './typography';
export type { TextStyles, TextStyleKey } from './typography';
export { spacing, borderRadius, darkShadows, lightShadows } from './spacing';
export type { Spacing, SpacingKey, BorderRadius, BorderRadiusKey, Shadows } from './spacing';

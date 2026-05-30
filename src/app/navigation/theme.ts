import {
  DefaultTheme,
  DarkTheme,
  type Theme,
} from '@react-navigation/native';
import { darkColors, lightColors } from '@/theme/colors';

// ---------------------------------------------------------------------------
// Chakaas Player navigation theme — "Arc Reactor" (dark-first)
// ---------------------------------------------------------------------------
//
// Built on React Navigation's `DarkTheme` so any color slot we don't override
// inherits a sensible dark default. The default export (`navigationTheme`) is
// the DARK theme; `lightNavigationTheme` is provided for the scheme toggle and
// `getNavigationTheme(scheme)` resolves whichever the UI store has selected.
//
// Arc Reactor dark tokens:
//   background   → #07090D  (app canvas)
//   card         → #0E1218  (elevated surfaces / headers)
//   text         → #EAF6FF  (cool white)
//   primary      → #19E3FF  (arc-reactor cyan)
//   border       → rgba(255,255,255,0.08)
// ---------------------------------------------------------------------------

export const darkNavigationTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: darkColors.accent,
    background: darkColors.bg,
    card: darkColors.bgElevated,
    text: darkColors.textPrimary,
    border: darkColors.border,
    notification: darkColors.accent,
  },
};

export const lightNavigationTheme: Theme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: lightColors.accent,
    background: lightColors.bg,
    card: lightColors.bgElevated,
    text: lightColors.textPrimary,
    border: lightColors.border,
    notification: lightColors.accent,
  },
};

/** Resolve the navigation theme for the active color scheme. Defaults to dark. */
export function getNavigationTheme(scheme: 'dark' | 'light'): Theme {
  return scheme === 'light' ? lightNavigationTheme : darkNavigationTheme;
}

// Default export remains `navigationTheme` for backward compatibility — now the
// DARK theme so the app renders dark out of the box.
export const navigationTheme: Theme = darkNavigationTheme;

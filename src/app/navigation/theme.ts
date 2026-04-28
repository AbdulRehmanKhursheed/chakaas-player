import { DefaultTheme, type Theme } from '@react-navigation/native';

// ---------------------------------------------------------------------------
// Chakaas Player navigation theme
// ---------------------------------------------------------------------------

/**
 * Custom light navigation theme for React Navigation.
 *
 * Built on top of the built-in `DefaultTheme` so that any color slot not
 * explicitly overridden inherits a sensible light default.
 *
 * Apple-style light tokens:
 *   background   → #F5F5F7
 *   card         → #FFFFFF
 *   text         → #1D1D1F
 *   primary      → #FA233B
 */
export const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#FA233B',
    background: '#F5F5F7',
    card: '#FFFFFF',
    text: '#1D1D1F',
    border: '#E5E5EA',
    notification: '#FA233B',
  },
};

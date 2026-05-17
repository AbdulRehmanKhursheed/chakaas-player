import { Platform } from 'react-native';

// 8pt grid spacing system
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  // Bottom-sheet / large rounded surfaces. Apple Music uses ~24 px on its
  // pull-up sheets; we use the same here so things feel native.
  sheet: 24,
  full: 9999,
} as const;

// Primary elevation tokens.
export const darkShadows = {
  sm: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.6,
      shadowRadius: 3,
    },
    android: { elevation: 2 },
  }) ?? {},
  md: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.7,
      shadowRadius: 8,
    },
    android: { elevation: 4 },
  }) ?? {},
  lg: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.8,
      shadowRadius: 16,
    },
    android: { elevation: 8 },
  }) ?? {},
  xl: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.9,
      shadowRadius: 24,
    },
    android: { elevation: 12 },
  }) ?? {},
  accent: Platform.select({
    ios: {
      shadowColor: '#FA233B',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
    },
    android: { elevation: 6 },
  }) ?? {},
} as const;

// Shadow tokens for light theme (softer, more diffuse)
export const lightShadows = {
  sm: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
      shadowRadius: 3,
    },
    android: { elevation: 2 },
  }) ?? {},
  md: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.10,
        shadowRadius: 12,
    },
    android: { elevation: 4 },
  }) ?? {},
  lg: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
    },
    android: { elevation: 8 },
  }) ?? {},
  xl: Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.14,
        shadowRadius: 28,
    },
    android: { elevation: 12 },
  }) ?? {},
  accent: Platform.select({
    ios: {
      shadowColor: '#FA233B',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
    },
    android: { elevation: 6 },
  }) ?? {},
} as const;

export type Spacing = typeof spacing;
export type SpacingKey = keyof Spacing;
export type BorderRadius = typeof borderRadius;
export type BorderRadiusKey = keyof BorderRadius;
export type Shadows = typeof darkShadows;

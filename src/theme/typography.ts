export const fontSizes = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 22,
  '2xl': 26,
  '3xl': 34,
  '4xl': 40,
  '5xl': 46,
} as const;

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
  black: '900' as const,
};

export const lineHeights = {
  tight: 1.2,
  normal: 1.4,
  relaxed: 1.6,
} as const;

export const letterSpacings = {
  tight: -0.5,
  normal: 0,
  wide: 0.5,
  wider: 1,
  widest: 2,
} as const;

export const textStyles = {
  display: {
    fontSize: fontSizes['4xl'],
    fontWeight: fontWeights.black,
    letterSpacing: -1.2,
  },
  h1: {
    fontSize: fontSizes['3xl'],
    fontWeight: fontWeights.extrabold,
    letterSpacing: -1,
  },
  h2: {
    fontSize: fontSizes['2xl'],
    fontWeight: fontWeights.bold,
    letterSpacing: -0.6,
  },
  h3: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
  },
  h4: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
  },
  bodyLg: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.regular,
  },
  body: {
    fontSize: fontSizes.base,
    fontWeight: fontWeights.regular,
    letterSpacing: -0.1,
  },
  bodySm: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.regular,
  },
  caption: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.regular,
    letterSpacing: letterSpacings.wide,
  },
  overline: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    letterSpacing: letterSpacings.widest,
  },
  label: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
} as const;

export type TextStyles = typeof textStyles;
export type TextStyleKey = keyof TextStyles;

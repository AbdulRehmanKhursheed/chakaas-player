import React from 'react';
import { Text, TextStyle, TextProps } from 'react-native';
import { useTheme } from '@/theme';

// ─── Shared extras ───────────────────────────────────────────────────────────

interface TypographyProps extends Omit<TextProps, 'style'> {
  children?: React.ReactNode;
  numberOfLines?: number;
  /** Override colour directly */
  color?: string;
  style?: TextStyle | TextStyle[];
}

// ─── Title  (h1 — display heading) ───────────────────────────────────────────

export function Title({
  children,
  numberOfLines,
  color,
  style,
  ...rest
}: TypographyProps) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[typography.h1, { color: color ?? colors.text }, style]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ─── Subtitle  (h3 — section heading) ────────────────────────────────────────

export function Subtitle({
  children,
  numberOfLines,
  color,
  style,
  ...rest
}: TypographyProps) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[typography.h3, { color: color ?? colors.text }, style]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────────────

export function Body({
  children,
  numberOfLines,
  color,
  style,
  ...rest
}: TypographyProps) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[typography.body, { color: color ?? colors.text }, style]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ─── Caption ──────────────────────────────────────────────────────────────────

export function Caption({
  children,
  numberOfLines,
  color,
  style,
  ...rest
}: TypographyProps) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[typography.caption, { color: color ?? colors.textTertiary }, style]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ─── Label ────────────────────────────────────────────────────────────────────

interface LabelProps extends TypographyProps {
  /** When true, renders label text in the theme accent colour. */
  accent?: boolean;
  /** Explicit uppercase transform */
  uppercase?: boolean;
}

export function Label({
  children,
  numberOfLines,
  color,
  accent = false,
  uppercase = false,
  style,
  ...rest
}: LabelProps) {
  const { colors, typography } = useTheme();
  const resolvedColor = color ?? (accent ? colors.accent : colors.textSecondary);
  return (
    <Text
      style={[
        typography.label,
        { color: resolvedColor },
        uppercase && { textTransform: 'uppercase', letterSpacing: 1 },
        style,
      ]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ─── Overline (small caps label used for section headers) ────────────────────

export function Overline({
  children,
  numberOfLines,
  color,
  style,
  ...rest
}: TypographyProps) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[typography.overline, { color: color ?? colors.textTertiary, textTransform: 'uppercase' }, style]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ─── Display (hero text) ──────────────────────────────────────────────────────

export function Display({
  children,
  numberOfLines,
  color,
  style,
  ...rest
}: TypographyProps) {
  const { colors, typography } = useTheme();
  return (
    <Text
      style={[typography.display, { color: color ?? colors.text }, style]}
      numberOfLines={numberOfLines}
      {...rest}
    >
      {children}
    </Text>
  );
}

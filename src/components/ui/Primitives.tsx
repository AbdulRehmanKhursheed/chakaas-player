import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Mini-player bottom inset so list content never hides behind the docked
// player. Kept as a constant so screens that opt in get a consistent gap.
const MINI_PLAYER_INSET = 76;

// ─── Screen ────────────────────────────────────────────────────────────────
// Themed app canvas + safe-area handling. `bottomInset` reserves room for the
// docked MiniPlayer.

interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  safeTop?: boolean;
  /** Reserve bottom space for the docked MiniPlayer. */
  bottomInset?: boolean;
}

export function Screen({
  children,
  style,
  padded = false,
  safeTop = false,
  bottomInset = false,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.bg },
        padded && styles.screenPadded,
        safeTop && { paddingTop: insets.top },
        bottomInset && { paddingBottom: insets.bottom + MINI_PLAYER_INSET },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─── Header (large-title, optional dark glass) ───────────────────────────────

interface HeaderProps {
  title: string;
  subtitle?: string;
  /** Frosted dark-glass background behind the title. */
  blur?: boolean;
  rightAction?: React.ReactNode;
  leftAction?: React.ReactNode;
  safeTop?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Header({
  title,
  subtitle,
  blur = false,
  rightAction,
  leftAction,
  safeTop = true,
  style,
}: HeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.header,
        safeTop && { paddingTop: insets.top + 4 },
        style,
      ]}
    >
      {blur ? (
        <>
          <BlurView
            intensity={40}
            tint="dark"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View
            style={[styles.headerHairline, { backgroundColor: colors.borderAccent }]}
            pointerEvents="none"
          />
        </>
      ) : null}
      <View style={styles.headerRow}>
        {leftAction ? <View style={styles.headerSide}>{leftAction}</View> : null}
        <View style={styles.headerTextBlock}>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightAction ? <View style={styles.headerSide}>{rightAction}</View> : null}
      </View>
    </View>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
// Dark elevated surface with a cyan-tinted hairline. Soft elevation only — no
// heavy black drop shadow.

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  /** Use the raised tile colour instead of the elevated card colour. */
  raised?: boolean;
}

export function Card({ children, style, elevated = false, raised = false }: CardProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: raised ? colors.bgRaised : colors.bgElevated,
          borderColor: colors.border,
        },
        elevated && {
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.18,
              shadowRadius: 16,
            },
            android: { elevation: 4 },
          }),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─── SectionHeader ─────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
}: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionText}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text style={[styles.sectionAction, { color: colors.accent }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── SearchField ─────────────────────────────────────────────────────────────

interface SearchFieldProps extends Omit<TextInputProps, 'style'> {
  value: string;
  onChangeText: (text: string) => void;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  style,
  inputStyle,
  ...rest
}: SearchFieldProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.searchField,
        { backgroundColor: colors.bgRaised, borderColor: colors.border },
        style,
      ]}
    >
      <Ionicons name="search" size={19} color={colors.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={[styles.searchInput, { color: colors.textPrimary }, inputStyle]}
        {...rest}
      />
      {value.length > 0 ? (
        <TouchableOpacity onPress={() => onChangeText('')} activeOpacity={0.75}>
          <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Button (primary cyan / gradient + secondary) ────────────────────────────
// Primary renders the cyan→blue brand gradient. `gold` uses the Iron Man gold
// gradient for premium CTAs. Secondary is a translucent accent-tinted surface.

interface ButtonProps {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'gold' | 'ghost';
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  icon,
  onPress,
  variant = 'primary',
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const isGradient = variant === 'primary' || variant === 'gold';
  const gradientColors = variant === 'gold' ? colors.goldGradient : colors.brandGradient;

  const textColor =
    variant === 'primary'
      ? '#07090D'
      : variant === 'gold'
        ? '#1A1205'
        : variant === 'secondary'
          ? colors.accent
          : colors.textPrimary;

  const inner = (
    <View style={styles.btnInner}>
      {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
      <Text style={[styles.btnLabel, { color: textColor }]}>{label}</Text>
    </View>
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[
        styles.btn,
        fullWidth && styles.btnFullWidth,
        variant === 'secondary' && { backgroundColor: colors.accentMuted },
        variant === 'ghost' && styles.btnGhost,
        disabled && styles.disabled,
        style,
      ]}
    >
      {isGradient ? (
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {inner}
    </TouchableOpacity>
  );
}

// ─── PillButton (kept for backward-compat) ───────────────────────────────────
// Compact pill control. Existing callers pass `variant` of
// 'primary' | 'secondary' | 'plain' — preserved exactly.

interface PillButtonProps {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'plain';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function PillButton({
  label,
  icon,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: PillButtonProps) {
  const { colors } = useTheme();
  const primary = variant === 'primary';
  const plain = variant === 'plain';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
      style={[
        styles.pill,
        primary && styles.pillPrimaryClip,
        !primary && !plain && { backgroundColor: colors.accentMuted },
        plain && styles.pillPlain,
        disabled && styles.disabled,
        style,
      ]}
    >
      {primary ? (
        <LinearGradient
          colors={colors.brandGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {icon ? (
        <Ionicons
          name={icon}
          size={17}
          color={primary ? '#07090D' : colors.accent}
        />
      ) : null}
      <Text
        style={[
          styles.pillText,
          { color: primary ? '#07090D' : colors.accent },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Chip (small filter/tag pill) ────────────────────────────────────────────

interface ChipProps {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, icon, selected = false, onPress, style }: ChipProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.78}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.accentMuted : colors.bgRaised,
          borderColor: selected ? colors.borderAccent : colors.border,
        },
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? colors.accent : colors.textSecondary}
        />
      ) : null}
      <Text
        style={[
          styles.chipText,
          { color: selected ? colors.accent : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  message,
  icon = 'musical-notes',
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accentMuted, borderColor: colors.borderAccent }]}>
        <Ionicons name={icon} size={30} color={colors.accent} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{title}</Text>
      {message ? (
        <Text style={[styles.emptyMessage, { color: colors.textSecondary }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <PillButton label={actionLabel} onPress={onAction} style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  screenPadded: {
    paddingHorizontal: 20,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerHairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerSide: {
    minWidth: 40,
    justifyContent: 'center',
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  headerSubtitle: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '500',
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionText: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
  },
  sectionAction: {
    fontSize: 14,
    fontWeight: '700',
  },
  searchField: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 0,
  },
  btn: {
    minHeight: 50,
    paddingHorizontal: 22,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnFullWidth: {
    alignSelf: 'stretch',
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnLabel: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  pill: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    overflow: 'hidden',
  },
  pillPrimaryClip: {
    backgroundColor: 'transparent',
  },
  pillPlain: {
    backgroundColor: 'transparent',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  disabled: {
    opacity: 0.45,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 46,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  emptyMessage: {
    marginTop: 7,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: 18,
  },
});

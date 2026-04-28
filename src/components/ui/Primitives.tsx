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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '@/theme/colors';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  safeTop?: boolean;
}

export function Screen({ children, style, padded = false, safeTop = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        padded && styles.screenPadded,
        safeTop && { paddingTop: insets.top },
        style,
      ]}
    >
      {children}
    </View>
  );
}

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}

export function Card({ children, style, elevated = false }: CardProps) {
  return (
    <View style={[styles.card, elevated && styles.cardElevated, style]}>
      {children}
    </View>
  );
}

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
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

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
  return (
    <View style={[styles.searchField, style]}>
      <Ionicons name="search" size={19} color={palette.textTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textTertiary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={[styles.searchInput, inputStyle]}
        {...rest}
      />
      {value.length > 0 ? (
        <TouchableOpacity onPress={() => onChangeText('')} activeOpacity={0.75}>
          <Ionicons name="close-circle" size={18} color={palette.textTertiary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

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
  const primary = variant === 'primary';
  const plain = variant === 'plain';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
      style={[
        styles.pill,
        primary && styles.pillPrimary,
        !primary && !plain && styles.pillSecondary,
        plain && styles.pillPlain,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={17}
          color={primary ? palette.white : palette.accent}
        />
      ) : null}
      <Text style={[styles.pillText, primary && styles.pillPrimaryText]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

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
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={palette.accent} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <PillButton label={actionLabel} onPress={onAction} style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.background,
  },
  screenPadded: {
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.10)',
  },
  cardElevated: {
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 18,
      },
      android: { elevation: 4 },
    }),
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
    color: palette.textPrimary,
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '500',
    color: palette.textSecondary,
  },
  sectionAction: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.accent,
  },
  searchField: {
    minHeight: 48,
    borderRadius: 18,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.10)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.05,
        shadowRadius: 14,
      },
      android: { elevation: 2 },
    }),
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: palette.textPrimary,
    paddingVertical: 0,
  },
  pill: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  pillPrimary: {
    backgroundColor: palette.accent,
  },
  pillSecondary: {
    backgroundColor: palette.accentSoft,
  },
  pillPlain: {
    backgroundColor: 'transparent',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '800',
    color: palette.accent,
    letterSpacing: -0.1,
  },
  pillPrimaryText: {
    color: palette.white,
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
    backgroundColor: palette.accentSoft,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  emptyMessage: {
    marginTop: 7,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    color: palette.textSecondary,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: 18,
  },
});

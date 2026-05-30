import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { HomeStack } from './HomeStack';
import { LibraryStack } from './LibraryStack';
import { SearchStack } from './SearchStack';
import { DownloadsStack } from './DownloadsStack';
import { SettingsStack } from './SettingsStack';
import { useDownloadStore } from '@/stores/downloadStore';
import { MiniPlayer } from '@/screens/nowPlaying/MiniPlayer';
import { useTheme } from '@/theme';
import type { BottomTabParamList } from '@/types/navigation';

// ---------------------------------------------------------------------------
// Navigator instance
// ---------------------------------------------------------------------------

const Tab = createBottomTabNavigator<BottomTabParamList>();

// ---------------------------------------------------------------------------
// Tab icon map
// ---------------------------------------------------------------------------

type TabIconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<keyof BottomTabParamList, { active: TabIconName; inactive: TabIconName }> = {
  Home: { active: 'musical-notes', inactive: 'musical-notes-outline' },
  Library: { active: 'albums', inactive: 'albums-outline' },
  Search: { active: 'search', inactive: 'search-outline' },
  Downloads: { active: 'arrow-down-circle', inactive: 'arrow-down-circle-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const TAB_HEIGHT = 58;
const TAB_BAR_EXTRA_HEIGHT = 10;
const TAB_BAR_BOTTOM_MARGIN = 12;
// Sit the MiniPlayer flush on top of the tab bar — no floating gap. Matches
// Spotify / Apple Music behaviour and keeps a tighter visual stack.
const MINI_PLAYER_GAP = 0;

// ---------------------------------------------------------------------------
// Download badge count
// ---------------------------------------------------------------------------

/**
 * Returns the count of active (non-done, non-error) downloads for the badge.
 */
function useActiveDownloadCount(): number {
  return useDownloadStore((s) =>
    s.queue.filter((d) => d.status !== 'done' && d.status !== 'error').length,
  );
}

// ---------------------------------------------------------------------------
// Custom tab bar icon component
// ---------------------------------------------------------------------------

interface TabIconColors {
  active: string;
  inactive: string;
  glyphActiveBg: string;
  glowColor: string;
  badge: string;
  badgeBorder: string;
  badgeText: string;
}

interface TabIconProps {
  label: string;
  icon: TabIconName;
  focused: boolean;
  badgeCount?: number;
  palette: TabIconColors;
}

function TabIcon({ label, icon, focused, badgeCount, palette }: TabIconProps) {
  const color = focused ? palette.active : palette.inactive;
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0;

  return (
    <View style={styles.iconWrapper}>
      <View
        style={[
          styles.glyphContainer,
          focused && {
            backgroundColor: palette.glyphActiveBg,
            // Soft cyan HUD glow behind the active glyph.
            shadowColor: palette.glowColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.9,
            shadowRadius: 10,
            elevation: 6,
          },
        ]}
      >
        <Ionicons name={icon} size={focused ? 24 : 23} color={color} />
        {showBadge && (
          <View style={[styles.badge, { backgroundColor: palette.badge, borderColor: palette.badgeBorder }]}>
            <Text style={[styles.badgeText, { color: palette.badgeText }]}>
              {badgeCount > 99 ? '99+' : badgeCount}
            </Text>
          </View>
        )}
      </View>

      <Text
        style={[
          styles.iconLabel,
          { color },
          focused && styles.iconLabelActive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bottom tab navigator
// ---------------------------------------------------------------------------

/**
 * BottomTabNavigator renders the five primary sections of the app:
 * BottomTabNavigator renders the five primary sections of the app with a
 * safe-area-aware floating tab bar and a Downloads badge for active work.
 */
export function BottomTabNavigator() {
  const insets = useSafeAreaInsets();
  const activeDownloadCount = useActiveDownloadCount();
  const { colors, isDark } = useTheme();

  // Tab-bar colour palette derived from the Arc Reactor tokens. Active glyphs
  // glow cyan; inactive sit in steel grey on a translucent dark glass dock.
  const tabPalette: TabIconColors = {
    active: colors.accent,
    inactive: colors.textSecondary,
    glyphActiveBg: colors.accentMuted,
    glowColor: colors.accentGlow,
    badge: colors.accent,
    badgeBorder: colors.bgElevated,
    badgeText: colors.bg,
  };

  const tabBarBottom = Math.max(TAB_BAR_BOTTOM_MARGIN, insets.bottom ? 8 : TAB_BAR_BOTTOM_MARGIN);
  const tabBarHeight = TAB_HEIGHT + insets.bottom + TAB_BAR_EXTRA_HEIGHT;
  const tabChromeHeight = tabBarBottom + tabBarHeight;

  return (
    <View style={{ flex: 1 }}>
    <Tab.Navigator
      screenOptions={({ route }) => {
        const routeName = route.name as keyof BottomTabParamList;
        const icons = TAB_ICONS[routeName];
        const badgeCount = routeName === 'Downloads' ? activeDownloadCount : undefined;

        return {
          headerShown: false,
          tabBarShowLabel: false, // Label rendered inside TabIcon instead
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textSecondary,
          // Translucent dark-glass dock — the BlurView background fills it in.
          tabBarBackground: () => (
            <BlurView
              intensity={isDark ? 40 : 60}
              tint={isDark ? 'dark' : 'light'}
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: 32,
                  overflow: 'hidden',
                  backgroundColor: colors.overlay,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.borderAccent,
                },
              ]}
            />
          ),
          tabBarStyle: {
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: tabBarBottom,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            borderWidth: 0,
            elevation: 0,
            height: tabBarHeight,
            paddingBottom: insets.bottom + 5,
            paddingTop: 6,
            borderRadius: 32,
            // Soft cyan-tinted elevation — no heavy black drop shadow.
            ...Platform.select({
              android: { elevation: 12 },
              ios: {
                shadowColor: colors.accent,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: isDark ? 0.18 : 0.12,
                shadowRadius: 18,
              },
            }),
          } as ViewStyle,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              label={routeName}
              icon={focused ? icons.active : icons.inactive}
              focused={focused}
              badgeCount={badgeCount}
              palette={tabPalette}
            />
          ),
        };
      }}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Library" component={LibraryStack} />
      <Tab.Screen name="Search" component={SearchStack} />
      <Tab.Screen name="Downloads" component={DownloadsStack} />
      <Tab.Screen name="Settings" component={SettingsStack} />
    </Tab.Navigator>

    {/*
     * MiniPlayer overlays above the tab bar across all tab screens.
     * It auto-hides when there's no active track and slides in when a song
     * starts playing. Tap → NowPlaying, swipe up → NowPlaying.
     * Positioned to sit just above the floating tab bar.
     */}
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: tabChromeHeight + MINI_PLAYER_GAP,
        zIndex: 20,
        elevation: 20,
      }}
    >
      <MiniPlayer />
    </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    width: 64,
    minHeight: TAB_HEIGHT,
  } as ViewStyle,

  glyphContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 30,
    borderRadius: 17,
  } as ViewStyle,

  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  } as ViewStyle,

  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 12,
  } as TextStyle,

  iconLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -0.1,
    marginTop: 3,
    textAlign: 'center',
  } as TextStyle,

  iconLabelActive: {
    fontWeight: '700',
    letterSpacing: 0.2,
  } as TextStyle,
});

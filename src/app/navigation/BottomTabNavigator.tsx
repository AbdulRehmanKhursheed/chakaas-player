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

import { HomeStack } from './HomeStack';
import { LibraryStack } from './LibraryStack';
import { SearchStack } from './SearchStack';
import { DownloadsStack } from './DownloadsStack';
import { SettingsStack } from './SettingsStack';
import { useDownloadStore } from '@/stores/downloadStore';
import { MiniPlayer } from '@/screens/nowPlaying/MiniPlayer';
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
// Design tokens (inlined to avoid circular imports from theme)
// ---------------------------------------------------------------------------

const COLORS = {
  active: '#FA233B',
  inactive: '#8E8E93',
  tabBar: '#FFFFFF',
  border: 'rgba(60,60,67,0.12)',
  badge: '#FA233B',
  badgeText: '#FFFFFF',
} as const;

const TAB_HEIGHT = 58;

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

interface TabIconProps {
  label: string;
  icon: TabIconName;
  focused: boolean;
  badgeCount?: number;
}

function TabIcon({ label, icon, focused, badgeCount }: TabIconProps) {
  const color = focused ? COLORS.active : COLORS.inactive;
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0;

  return (
    <View style={styles.iconWrapper}>
      <View style={[styles.glyphContainer, focused && styles.glyphContainerActive]}>
        <Ionicons name={icon} size={focused ? 24 : 23} color={color} />
        {showBadge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
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

  // Total height of the physical tab bar rendered on-screen.
  const tabBarHeight = TAB_HEIGHT + insets.bottom;

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
          tabBarActiveTintColor: COLORS.active,
          tabBarInactiveTintColor: COLORS.inactive,
          tabBarStyle: {
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: Math.max(12, insets.bottom ? 8 : 12),
            backgroundColor: COLORS.tabBar,
            borderTopColor: COLORS.border,
            borderTopWidth: 0,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: COLORS.border,
            height: tabBarHeight + 10,
            paddingBottom: insets.bottom + 5,
            paddingTop: 6,
            borderRadius: 32,
            ...Platform.select({
              android: { elevation: 18 },
              ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.12,
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
        bottom: tabBarHeight + 16,
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

  glyphContainerActive: {
    backgroundColor: 'rgba(250,35,59,0.10)',
  } as ViewStyle,

  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.badge,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  } as ViewStyle,

  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.badgeText,
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

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SettingsScreen } from '@/screens/settings/SettingsScreen';

// ---------------------------------------------------------------------------
// Param list
// ---------------------------------------------------------------------------

export type SettingsStackParamList = {
  Settings: undefined;
};

// ---------------------------------------------------------------------------
// Navigator instance
// ---------------------------------------------------------------------------

const Stack = createNativeStackNavigator<SettingsStackParamList>();

// ---------------------------------------------------------------------------
// SettingsStack
// ---------------------------------------------------------------------------

/**
 * SettingsStack wraps the Settings tab in its own native stack.
 *
 * Future sub-screens (e.g. "Audio Quality", "EQ Presets", "About") can be
 * added as nested screens here without affecting the other tabs.
 */
export function SettingsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F5F5F7' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}

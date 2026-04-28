import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { DownloadsScreen } from '@/screens/downloads/DownloadsScreen';

// ---------------------------------------------------------------------------
// Param list
// ---------------------------------------------------------------------------

export type DownloadsStackParamList = {
  Downloads: undefined;
};

// ---------------------------------------------------------------------------
// Navigator instance
// ---------------------------------------------------------------------------

const Stack = createNativeStackNavigator<DownloadsStackParamList>();

// ---------------------------------------------------------------------------
// DownloadsStack
// ---------------------------------------------------------------------------

/**
 * DownloadsStack covers the download queue tab.
 * Currently a single-screen stack; nested detail screens can be added here.
 */
export function DownloadsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F5F5F7' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Downloads" component={DownloadsScreen} />
    </Stack.Navigator>
  );
}

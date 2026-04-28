import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '@/screens/home/HomeScreen';

// ---------------------------------------------------------------------------
// Param list
// ---------------------------------------------------------------------------

export type HomeStackParamList = {
  Home: undefined;
};

// ---------------------------------------------------------------------------
// Navigator instance
// ---------------------------------------------------------------------------

const Stack = createNativeStackNavigator<HomeStackParamList>();

// ---------------------------------------------------------------------------
// HomeStack
// ---------------------------------------------------------------------------

/**
 * HomeStack wraps the home tab in its own native stack so that future
 * sub-screens (e.g. "Recently Played" detail, featured playlist preview)
 * can be pushed without affecting the other tab stacks.
 *
 * Currently only the HomeScreen root is registered; add sub-screens here
 * as they are built.
 */
export function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F5F5F7' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}

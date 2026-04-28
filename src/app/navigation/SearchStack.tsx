import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SearchScreen } from '@/screens/search/SearchScreen';

// ---------------------------------------------------------------------------
// Param list
// ---------------------------------------------------------------------------

/**
 * The Search tab accepts an optional pre-filled `query` so other parts of the
 * app can deep-link into a search result (e.g. tapping an artist name).
 */
export type SearchStackParamList = {
  Search: { query?: string } | undefined;
};

// ---------------------------------------------------------------------------
// Navigator instance
// ---------------------------------------------------------------------------

const Stack = createNativeStackNavigator<SearchStackParamList>();

// ---------------------------------------------------------------------------
// SearchStack
// ---------------------------------------------------------------------------

/**
 * SearchStack wraps the Search tab in its own native stack.
 *
 * Only the SearchScreen root is registered here. Future enhancements
 * such as a "YouTube results" sub-page or a channel/artist view can be
 * added as nested screens without affecting the other tabs.
 */
export function SearchStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F5F5F7' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Search" component={SearchScreen} />
    </Stack.Navigator>
  );
}

import React from 'react';
import { DatabaseProvider as WatermelonDBProvider } from '@nozbe/watermelondb/react';
import { database } from '@/db';

// ---------------------------------------------------------------------------
// DatabaseProvider
// ---------------------------------------------------------------------------

/**
 * Wraps the application in WatermelonDB's React context so that any component
 * inside the tree can consume database collections via `useDatabase()` or the
 * `withDatabase` / `withObservables` HOCs.
 *
 * The `database` singleton is imported from `@/db` (configured with the SQLite
 * JSI adapter for New Architecture performance).
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  return (
    <WatermelonDBProvider database={database}>
      {children}
    </WatermelonDBProvider>
  );
}

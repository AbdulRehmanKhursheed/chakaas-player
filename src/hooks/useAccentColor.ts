/**
 * useAccentColor
 *
 * Extracts the dominant colour from an album artwork image (URL or local path)
 * using react-native-image-colors, then pushes the result into the UI store so
 * the rest of the app can react to it.
 *
 * Returns the current accent colours and a loading flag.
 */

import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { getColors } from 'react-native-image-colors';
import { useUIStore } from '@/stores/uiStore';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccentColorResult {
  /** Primary accent colour derived from the artwork (hex string). */
  accentColor: string;
  /** Lighter variant of the accent colour suitable for text/icons. */
  accentColorLight: string;
  /** True while colour extraction is in progress. */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/**
 * Lightens a hex colour by blending it toward white at the given ratio.
 * `ratio = 0` returns the original colour; `ratio = 1` returns white.
 */
function lightenHex(hex: string, ratio: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const blend = (channel: number) =>
    Math.round(channel + (255 - channel) * ratio)
      .toString(16)
      .padStart(2, '0');

  return `#${blend(r)}${blend(g)}${blend(b)}`;
}

/**
 * Picks the most useful platform-specific dominant colour from the result
 * returned by `getColors`. Falls back to the app accent if nothing is found.
 */
function extractDominantColor(
  result: Awaited<ReturnType<typeof getColors>>,
): string {
  const fallback = '#FA233B';

  if (result.platform === 'android') {
    return result.dominant ?? result.vibrant ?? result.muted ?? fallback;
  }

  if (result.platform === 'ios') {
    return result.primary ?? result.secondary ?? fallback;
  }

  if (result.platform === 'web') {
    return result.dominant ?? fallback;
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Extracts the dominant colour from `imageUri` and syncs it to the UI store.
 *
 * - Skips extraction when `imageUri` is null/undefined.
 * - Cancels in-flight extraction if `imageUri` changes before it completes.
 */
export function useAccentColor(
  imageUri: string | null | undefined,
): AccentColorResult {
  const accentColor = useUIStore((s) => s.accentColor);
  const accentColorLight = useUIStore((s) => s.accentColorLight);
  const setAccentColor = useUIStore((s) => s.setAccentColor);

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!imageUri) return;

    let cancelled = false;
    setIsLoading(true);

    getColors(imageUri, {
      fallback: '#FA233B',
      cache: true,
      key: imageUri,
      // Use medium quality for a good speed/accuracy balance
      quality: 'low',
      ...(Platform.OS === 'android' && { pixelSpacing: 5 }),
    })
      .then((result) => {
        if (cancelled) return;
        const dominant = extractDominantColor(result);
        const light = lightenHex(dominant, 0.45);
        setAccentColor(dominant, light);
        logger.info('[useAccentColor] Extracted colour:', dominant, '→ light:', light);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.error('[useAccentColor] Failed to extract colour:', error);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [imageUri, setAccentColor]);

  return { accentColor, accentColorLight, isLoading };
}

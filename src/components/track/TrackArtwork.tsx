import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import FastImage from 'react-native-fast-image';
import { Blurhash } from 'react-native-blurhash';
import { Ionicons } from '@expo/vector-icons';
import { normalizeLocalUri } from '@/utils/layout';

// ─── Props ───────────────────────────────────────────────────────────────────

interface TrackArtworkProps {
  uri: string | null;
  blurhash: string | null;
  size: number;
  borderRadius?: number;
}

// ─── Fallback placeholder colors ─────────────────────────────────────────────

const PLACEHOLDER_COLORS = [
  '#FFF1F3',
  '#F2F2F7',
  '#EAF2FF',
  '#F7EFFB',
  '#F8F5EC',
  '#EEF8F1',
];

function getColorForString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TrackArtwork({
  uri,
  blurhash,
  size,
  borderRadius = 8,
}: TrackArtworkProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // FastImage on Android won't load bare absolute paths (e.g. paths returned
  // by RNBlobUtil) without a `file://` prefix. Normalise once here so every
  // call site doesn't have to.
  const resolvedUri = normalizeLocalUri(uri);
  const placeholderColor = getColorForString(resolvedUri ?? 'default');

  // Recycled rows in a FlatList swap the `uri` prop without unmounting this
  // component — without resetting the loaded/error flags here, a previously
  // errored row would stick to its placeholder forever and a previously
  // loaded row would render the OLD artwork until the new one loads.
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [resolvedUri]);

  const containerStyle = {
    width: size,
    height: size,
    borderRadius,
    overflow: 'hidden' as const,
  };

  if (!resolvedUri || imageError) {
    return (
      <View style={[containerStyle, styles.placeholder, { backgroundColor: placeholderColor }]}>
        <Ionicons name="musical-notes" size={size * 0.38} color="#FA233B" />
      </View>
    );
  }

  return (
    <View style={containerStyle}>
      {/* Blurhash shown until image is loaded */}
      {blurhash && !imageLoaded && (
        <Blurhash
          blurhash={blurhash}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}

      {/* Colored placeholder if no blurhash and image not yet loaded */}
      {!blurhash && !imageLoaded && (
        <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: placeholderColor }]}>
          <Ionicons name="musical-notes" size={size * 0.38} color="#FA233B" />
        </View>
      )}

      <FastImage
        source={{
          uri: resolvedUri,
          priority: FastImage.priority.normal,
          cache: FastImage.cacheControl.immutable,
        }}
        style={{ width: size, height: size }}
        resizeMode={FastImage.resizeMode.cover}
        onLoad={() => setImageLoaded(true)}
        onError={() => setImageError(true)}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

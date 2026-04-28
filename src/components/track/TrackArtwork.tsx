import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import FastImage from 'react-native-fast-image';
import { Blurhash } from 'react-native-blurhash';
import { Ionicons } from '@expo/vector-icons';

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

  const placeholderColor = getColorForString(uri ?? 'default');

  const containerStyle = {
    width: size,
    height: size,
    borderRadius,
    overflow: 'hidden' as const,
  };

  if (!uri || imageError) {
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
          uri,
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

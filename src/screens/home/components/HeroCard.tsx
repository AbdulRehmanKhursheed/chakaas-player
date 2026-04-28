import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import FastImage from 'react-native-fast-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/db/models/Track';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HeroCardProps {
  track: Track;
  onPress: (track: Track) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HeroCard({ track, onPress }: HeroCardProps) {
  const handlePress = useCallback(() => onPress(track), [track, onPress]);

  const artworkUri = track.artworkPath ?? undefined;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={handlePress}
      style={styles.container}
    >
      {/* Album art — full bleed */}
      {artworkUri ? (
        <FastImage
          source={{
            uri: artworkUri,
            priority: FastImage.priority.high,
            cache: FastImage.cacheControl.immutable,
          }}
          style={StyleSheet.absoluteFill}
          resizeMode={FastImage.resizeMode.cover}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholderBg]}>
          <Ionicons name="musical-notes" size={58} color="#FA233B" />
        </View>
      )}

      {/* Bottom gradient overlay */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.96)']}
        locations={[0, 0.5, 1]}
        style={styles.gradient}
      />

      {/* Text metadata */}
      <View style={styles.textContainer}>
        <Text style={styles.title} numberOfLines={2}>
          {track.title}
        </Text>
        {!!track.artist && (
          <Text style={styles.artist} numberOfLines={1}>
            {track.artist}
          </Text>
        )}
      </View>

      <View style={styles.playButton}>
        <Ionicons name="play" size={16} color="#FFFFFF" style={styles.playIcon} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: 180,
    height: 240,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
      },
      android: { elevation: 10 },
    }),
  },
  placeholderBg: {
    backgroundColor: '#FFF1F3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
  },
  textContainer: {
    position: 'absolute',
    bottom: 14,
    left: 12,
    right: 44,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.82)',
    marginTop: 3,
  },
  playButton: {
    position: 'absolute',
    bottom: 14,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FA233B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    marginLeft: 2,
  },
});

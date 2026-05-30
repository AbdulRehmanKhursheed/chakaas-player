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
import { useTheme } from '@/theme';
import type { Track } from '@/db/models/Track';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HeroCardProps {
  track: Track;
  onPress: (track: Track) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HeroCard({ track, onPress }: HeroCardProps) {
  const { colors } = useTheme();
  const handlePress = useCallback(() => onPress(track), [track, onPress]);

  const artworkUri = track.artworkPath ?? undefined;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={handlePress}
      style={[
        styles.container,
        { backgroundColor: colors.bgElevated, borderColor: colors.borderAccent },
      ]}
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
        <View style={[StyleSheet.absoluteFill, styles.placeholderBg, { backgroundColor: colors.bgRaised }]}>
          <Ionicons name="musical-notes" size={58} color={colors.accent} />
        </View>
      )}

      {/* Bottom gradient overlay — fades artwork into the dark canvas */}
      <LinearGradient
        colors={['transparent', 'rgba(3,5,8,0.65)', 'rgba(3,5,8,0.96)']}
        locations={[0, 0.5, 1]}
        style={styles.gradient}
      />

      {/* Text metadata */}
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
          {track.title}
        </Text>
        {!!track.artist && (
          <Text style={[styles.artist, { color: colors.textSecondary }]} numberOfLines={1}>
            {track.artist}
          </Text>
        )}
      </View>

      {/* Glowing cyan play control */}
      <View style={styles.playButtonWrap}>
        <LinearGradient
          colors={colors.brandGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.playButton,
            {
              shadowColor: colors.accent,
              ...Platform.select({
                ios: {
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.6,
                  shadowRadius: 10,
                },
                android: { elevation: 6 },
              }),
            },
          ]}
        >
          <Ionicons name="play" size={16} color="#07090D" style={styles.playIcon} />
        </LinearGradient>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: 180,
    height: 240,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  placeholderBg: {
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
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  artist: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 3,
  },
  playButtonWrap: {
    position: 'absolute',
    bottom: 14,
    right: 12,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    marginLeft: 2,
  },
});

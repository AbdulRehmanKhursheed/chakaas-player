import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/types/track';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useTheme } from '@/theme';
import { TrackArtwork } from './TrackArtwork';

// ─── Option definition ───────────────────────────────────────────────────────

interface MenuOption {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
  accent?: boolean;
  hidden?: boolean;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TrackContextMenuProps {
  track: Track | null;
  isVisible: boolean;
  onClose: () => void;
  /** Called when "Play Next" is selected */
  onPlayNext?: (track: Track) => void;
  /** Called when "Add to Queue" is selected */
  onAddToQueue?: (track: Track) => void;
  /** Called when like/unlike is toggled */
  onToggleLike?: (track: Track) => void;
  /** Called when "Add to Playlist" is selected */
  onAddToPlaylist?: (track: Track) => void;
  /** Called when "View Artist" is selected */
  onViewArtist?: (artist: string) => void;
  /** Called when "View Album" is selected */
  onViewAlbum?: (album: string) => void;
  /** Called when "Delete from Library" is selected */
  onDelete?: (track: Track) => void;
}

// ─── MenuItem ────────────────────────────────────────────────────────────────

function MenuItem({
  icon,
  label,
  onPress,
  destructive = false,
  accent = false,
}: Omit<MenuOption, 'id' | 'hidden'>) {
  const { colors } = useTheme();
  const iconColor = destructive ? colors.danger : accent ? colors.accent : colors.textSecondary;
  const labelColor = destructive ? colors.danger : accent ? colors.accent : colors.textPrimary;
  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      activeOpacity={0.65}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.menuItemIconWrap, { backgroundColor: colors.bgRaised }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <Text style={[styles.menuItemLabel, { color: labelColor }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TrackContextMenu({
  track,
  isVisible,
  onClose,
  onPlayNext,
  onAddToQueue,
  onToggleLike,
  onAddToPlaylist,
  onViewArtist,
  onViewAlbum,
  onDelete,
}: TrackContextMenuProps) {
  const { colors } = useTheme();
  const withClose = useCallback(
    (fn?: () => void) => () => {
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // ignore — haptics are a nice-to-have
      }
      onClose();
      // Defer the action by one frame so the sheet's close animation can
      // start before the parent screen pushes a new route / opens another
      // sheet on top of us. Avoids the "snap to invisible" jank we used to
      // see when tapping "View Artist" → navigation unmounted the sheet
      // mid-anim.
      if (fn) {
        requestAnimationFrame(fn);
      }
    },
    [onClose],
  );

  if (!track) return null;

  const options: MenuOption[] = [
    {
      id: 'play_next',
      icon: 'play-skip-forward',
      label: 'Play Next',
      onPress: withClose(() => onPlayNext?.(track)),
    },
    {
      id: 'add_queue',
      icon: 'add-circle',
      label: 'Add to Queue',
      onPress: withClose(() => onAddToQueue?.(track)),
    },
    {
      id: 'like',
      icon: track.liked ? 'heart' : 'heart-outline',
      label: track.liked ? 'Unlike' : 'Like',
      accent: !track.liked,
      onPress: withClose(() => onToggleLike?.(track)),
    },
    {
      id: 'playlist',
      icon: 'list',
      label: 'Add to Playlist',
      onPress: withClose(() => onAddToPlaylist?.(track)),
    },
    {
      id: 'artist',
      icon: 'person',
      label: 'View Artist',
      onPress: withClose(() => onViewArtist?.(track.artist)),
      hidden: !track.artist || !onViewArtist,
    },
    {
      id: 'album',
      icon: 'disc',
      label: 'View Album',
      onPress: withClose(() => onViewAlbum?.(track.album)),
      hidden: !track.album || !onViewAlbum,
    },
    {
      id: 'delete',
      icon: 'trash',
      label: 'Delete from Library',
      destructive: true,
      onPress: withClose(() => onDelete?.(track)),
    },
  ];

  const visibleOptions = options.filter((o) => !o.hidden);

  return (
    <BottomSheet
      isVisible={isVisible}
      onClose={onClose}
      snapPoint={Math.min(visibleOptions.length * 56 + 140, 520)}
    >
      {/* Track identity header */}
      <View style={styles.header}>
        <TrackArtwork
          uri={track.artwork_path}
          blurhash={null}
          size={48}
          borderRadius={10}
        />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={[styles.headerMeta, { color: colors.textSecondary }]} numberOfLines={1}>
            {track.artist}
            {track.album ? ` · ${track.album}` : ''}
          </Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Menu options */}
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={styles.optionsList}
      >
        {visibleOptions.map((option, index) => (
          <React.Fragment key={option.id}>
            <MenuItem
              icon={option.icon}
              label={option.label}
              onPress={option.onPress}
              destructive={option.destructive}
              accent={option.accent}
            />
            {/* Separator — not after the last item */}
            {index < visibleOptions.length - 1 && (
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
            )}
          </React.Fragment>
        ))}
        {/* Bottom safe area buffer */}
        <View style={{ height: Platform.OS === 'ios' ? 24 : 12 }} />
      </ScrollView>
    </BottomSheet>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerMeta: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
  },
  optionsList: {
    flex: 1,
    paddingTop: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 56,
    gap: 16,
  },
  menuItemIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemLabel: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 74,
    marginRight: 20,
  },
});

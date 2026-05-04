/**
 * Core track entity. Represents a single audio track regardless of its
 * origin (Saavn / YouTube download or local device file).
 */
export interface Track {
  /** Stable UUID assigned at import time. */
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  /** Total track length in milliseconds. */
  duration_ms: number;
  /** Absolute path to the audio file on-device. Empty string when not yet downloaded. */
  file_path: string;
  /** Absolute path to the cached artwork image, or null if none. */
  artwork_path: string | null;
  /** YouTube video ID, or null when this track wasn't sourced from YouTube. */
  youtube_id: string | null;
  /** Unix timestamp (seconds) when the track was added to the library. */
  added_at: number;
  /** Where the track originated. */
  source: 'youtube' | 'saavn' | 'local';
  /** Whether the user has liked/hearted this track. */
  liked: boolean;
}

/**
 * A single play event recorded when the user plays a track. Used for
 * play-count stats and the recommendation engine.
 */
export interface Play {
  /** Stable UUID for this play record. */
  id: string;
  /** Foreign key → Track.id */
  track_id: string;
  /** Unix timestamp (seconds) when playback started. */
  played_at: number;
  /** How many milliseconds of the track were actually played. */
  duration_played_ms: number;
  /**
   * Fraction of the track that was heard: duration_played_ms / track.duration_ms.
   * Range [0, 1]. A value ≥ 0.8 typically counts as a full listen.
   */
  completion_ratio: number;
  /** True if the user manually skipped before the track ended. */
  was_skipped: boolean;
}

/**
 * A user-created playlist that holds an ordered set of tracks.
 */
export interface Playlist {
  /** Stable UUID. */
  id: string;
  name: string;
  /** Unix timestamp (seconds) when the playlist was created. */
  created_at: number;
  /** Absolute path to a custom artwork image, or null to use auto-generated art. */
  artwork_path: string | null;
}

/**
 * Represents a single item in the download queue.
 */
export interface DownloadItem {
  /** Stable UUID for this download job. */
  id: string;
  /** YouTube video ID being downloaded. */
  youtubeId: string;
  title: string;
  artist: string;
  /** URL of the thumbnail image shown in the download queue UI. */
  thumbnail: string;
  /** Download/conversion progress as a percentage [0, 100]. */
  progress: number;
  /**
   * Current stage of the download pipeline:
   *   queued       – waiting to start
   *   downloading  – fetching audio stream from YouTube
   *   converting   – running ffmpeg to produce final MP3/AAC
   *   tagging      – writing ID3/metadata tags
   *   done         – file is on-disk and in the library
   *   error        – pipeline failed; see `error` for details
   */
  status: 'queued' | 'downloading' | 'converting' | 'tagging' | 'done' | 'error';
  /** Human-readable error message, set only when status === 'error'. */
  error?: string;
}

/**
 * A single result item from a music search.
 *
 * Historically named `YouTubeSearchResult` for backward compatibility with
 * existing screens, but now provider-agnostic — the `provider` discriminant
 * tells the download pipeline whether to resolve via JioSaavn or YouTube.
 *
 * For Saavn results, the encrypted media URL is captured at search time so
 * the download path can call `song.generateAuthToken` later without hitting
 * search again.
 */
export interface YouTubeSearchResult {
  /**
   * Provider-native ID. YouTube videoId for `provider === 'youtube'`,
   * Saavn song id (e.g. "aRZbUYD7") for `provider === 'saavn'`.
   */
  id: string;
  title: string;
  /** Artist or channel name. */
  author: string;
  /** Track duration in milliseconds. */
  duration_ms: number;
  /** URL of the best-quality thumbnail / artwork available for display. */
  thumbnail: string;
  /** Free-form metadata (YouTube view-count or Saavn album). */
  view_count: string;
  /**
   * Which backend produced this result. Defaults to `youtube` when omitted
   * for backward compatibility — code paths that were written before the
   * provider abstraction continue to behave identically.
   */
  provider?: 'youtube' | 'saavn';
  /** Saavn `encrypted_media_url`. Present iff `provider === 'saavn'`. */
  saavnEncryptedUrl?: string;
  /** Whether the Saavn 320 kbps tier is available; falls back to 160 kbps if not. */
  saavnHas320kbps?: boolean;
  /** Album name from Saavn metadata, used when writing the DB row. */
  saavnAlbum?: string;
}

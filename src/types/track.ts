/**
 * Audio feature vector extracted from a track, modelled after Spotify's
 * audio-features endpoint. All continuous fields are normalised to [0, 1]
 * unless noted otherwise.
 */
export interface TrackFeatures {
  /** Perceived intensity and activity. 0 = calm/low-energy, 1 = fast/loud/noisy. */
  energy: number;
  /** Musical positiveness. 0 = sad/angry/tense, 1 = happy/cheerful/euphoric. */
  valence: number;
  /** How suitable the track is for dancing. 0 = least danceable, 1 = most. */
  danceability: number;
  /** Estimated tempo in beats per minute (BPM). Not normalised. */
  tempo: number;
  /** Presence of acoustic instruments. 0 = electric/synthesized, 1 = fully acoustic. */
  acousticness: number;
  /** Predicts whether there are no vocals. Values above 0.5 are instrumental. */
  instrumentalness: number;
}

/**
 * Core track entity. Represents a single audio track regardless of its
 * origin (local file or YouTube stream/download).
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
  /** YouTube video ID, or null for local-only tracks. */
  youtube_id: string | null;
  /** Spotify track ID used for metadata enrichment, or null if not linked. */
  spotify_id: string | null;
  /** Audio features, populated after analysis. null until analysed. */
  features: TrackFeatures | null;
  /** Unix timestamp (seconds) when the track was added to the library. */
  added_at: number;
  /** Where the track originated. */
  source: 'youtube' | 'local';
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
 * Six-dimensional taste vector used by the recommendation engine.
 * The tuple order maps directly to TrackFeatures in a fixed sequence so
 * that dot-product similarity is straightforward.
 *
 * Index mapping:
 *   0 → energy
 *   1 → valence
 *   2 → danceability
 *   3 → tempo_norm  (tempo / 200, clamped to [0, 1])
 *   4 → acousticness
 *   5 → instrumentalness
 */
export type TasteVector = [number, number, number, number, number, number];

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
 * A single result item returned by a YouTube search query.
 */
export interface YouTubeSearchResult {
  /** YouTube video ID. */
  id: string;
  title: string;
  /** Channel / uploader name. */
  author: string;
  /** Track duration in milliseconds. */
  duration_ms: number;
  /** URL of the best-quality thumbnail available for display. */
  thumbnail: string;
  /** Human-readable view count string as returned by the YouTube API (e.g. "1.2M views"). */
  view_count: string;
}

/**
 * Shared types for music providers (Saavn, YouTube, etc.).
 *
 * The app speaks a single canonical shape — `MusicSearchResult` — regardless
 * of where a result originated. The `provider` discriminant tells the
 * download pipeline which resolver to call.
 */

export type ProviderId = 'youtube' | 'saavn';

/**
 * All sources the multi-source resolver might attribute a stream to. Optional
 * field on `AudioStreamInfo` — existing call sites ignore it.
 */
export type ResolverSourceId =
  | 'saavn'
  | 'saavn-mirror'
  | 'youtube'
  | 'piped'
  | 'invidious'
  | 'audius'
  | 'soundcloud'
  | 'internet_archive'
  | 'jamendo'
  | 'hungama';

/**
 * Metadata about an individual audio stream that the DownloadManager will
 * fetch. Mirrors `AudioStreamInfo` from YoutubeExtractor but lifted into a
 * shared module so both providers and the manager can import it without
 * cycles.
 */
export interface AudioStreamInfo {
  /** Fully-signed, ready-to-download HTTPS URL. */
  url: string;
  /** MIME type (e.g. "audio/mp4", "audio/webm; codecs=opus"). */
  mimeType: string;
  /** Source bitrate in bits per second. */
  bitrate: number;
  /** File-extension hint: 'm4a' (AAC), 'webm' (Opus), or 'mp3' (MPEG). */
  container: 'm4a' | 'webm' | 'mp3';
  /** Informational. Always false for Saavn (already AAC). */
  needsTranscode: boolean;
  /** Bitrate the user effectively hears. */
  effectiveBitrate: number;
  /** Track length in milliseconds. 0 when unknown. */
  durationMs: number;
  /**
   * Extra headers the CDN requires for the GET to succeed. Saavn's CDN
   * checks `Referer` + `User-Agent`; YouTube doesn't need anything special
   * but accepts mobile UAs. The DownloadManager merges these on top of its
   * default header sets.
   */
  requestHeaders?: Record<string, string>;
  /**
   * Source attribution — which resolver branch produced this stream. Useful
   * for logging / analytics / future quality heuristics. Optional so existing
   * code keeps working without changes.
   */
  source?: ResolverSourceId;
}

/**
 * Saavn-specific fields. Present only on results produced by the Saavn
 * provider. Lets the download pipeline call `getSaavnStreamUrl` without
 * re-querying search.
 */
export interface SaavnResultExtras {
  /** Server-side encrypted blob — input to `song.generateAuthToken`. */
  encryptedMediaUrl: string;
  /** Whether 320 kbps tier is available; falls back to 160 kbps if not. */
  has320kbps: boolean;
  /** Album name from search metadata, used for DB write. */
  album: string;
}

/**
 * Provider-agnostic search result. UI components and download flows accept
 * this single shape.
 *
 * Field naming preserves backward compatibility with the old
 * `YouTubeSearchResult` shape (id/title/author/duration_ms/thumbnail/view_count)
 * so existing screens render it without refactoring.
 */
export interface MusicSearchResult {
  /** Which backend produced this row. */
  provider: ProviderId;
  /** Provider-native ID. YouTube videoId or Saavn song id. */
  id: string;
  title: string;
  /** Channel / artist name. */
  author: string;
  /** Duration in milliseconds. 0 when unknown. */
  duration_ms: number;
  /** High-quality thumbnail / artwork URL. */
  thumbnail: string;
  /** Free-form metadata line (YouTube view-count / Saavn album). */
  view_count: string;
  /** Saavn extras — present iff `provider === 'saavn'`. */
  saavn?: SaavnResultExtras;
}

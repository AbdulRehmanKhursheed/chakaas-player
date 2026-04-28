import RNBlobUtil from 'react-native-blob-util';
import { YouTubeSearchResult } from '@/types/track';
import { logger } from '@/utils/logger';

// ── Singleton Innertube instance ──────────────────────────────────────────

type InnertubeInstance = {
  search(query: string, filters?: Record<string, unknown>): Promise<any>;
  getInfo(videoId: string): Promise<any>;
  session: { player: unknown };
};

let _innertube: InnertubeInstance | null = null;

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const ANDROID_CLIENT_VERSION = '21.03.36';
const ANDROID_USER_AGENT =
  'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip';
const IOS_CLIENT_VERSION = '20.11.6';
const IOS_USER_AGENT =
  'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)';

function textFromRuns(node: any): string {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) {
    return node.runs
      .map((run: any) => run?.text)
      .filter(Boolean)
      .join('');
  }
  return '';
}

function parseDurationToMs(value: string): number {
  const parts = value
    .split(':')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) return 0;

  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}

function extractBalancedObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractVideoRenderers(html: string): any[] {
  const marker = '"videoRenderer":';
  const renderers: any[] = [];
  let searchFrom = 0;

  while (renderers.length < 30) {
    const markerIndex = html.indexOf(marker, searchFrom);
    if (markerIndex < 0) break;

    const objectStart = html.indexOf('{', markerIndex + marker.length);
    if (objectStart < 0) break;

    const objectJson = extractBalancedObject(html, objectStart);
    if (!objectJson) break;

    try {
      renderers.push(JSON.parse(objectJson));
    } catch {
      // Skip malformed chunks. YouTube can inject partial renderers.
    }

    searchFrom = objectStart + objectJson.length;
  }

  return renderers;
}

function collectVideoRenderers(node: unknown, out: any[] = []): any[] {
  if (!node || out.length >= 50) return out;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, out);
      if (out.length >= 50) break;
    }
    return out;
  }

  if (typeof node !== 'object') return out;

  const record = node as Record<string, unknown>;
  const videoRenderer = record.videoRenderer;
  if (videoRenderer && typeof videoRenderer === 'object') {
    out.push(videoRenderer);
    if (out.length >= 50) return out;
  }

  for (const value of Object.values(record)) {
    collectVideoRenderers(value, out);
    if (out.length >= 50) break;
  }

  return out;
}

function rendererToSearchResult(renderer: any): YouTubeSearchResult | null {
  const id = renderer.videoId;
  if (!id) return null;

  const title = textFromRuns(renderer.title).trim();
  if (!title) return null;

  const author =
    textFromRuns(renderer.ownerText).trim() ||
    textFromRuns(renderer.shortBylineText).trim() ||
    textFromRuns(renderer.longBylineText).trim() ||
    'YouTube';

  const thumbnails = renderer.thumbnail?.thumbnails ?? [];
  const thumbnail =
    thumbnails.length > 0
      ? thumbnails[thumbnails.length - 1]?.url ?? ''
      : '';

  return {
    id,
    title,
    author,
    duration_ms: parseDurationToMs(textFromRuns(renderer.lengthText)),
    thumbnail: thumbnail.startsWith('//') ? `https:${thumbnail}` : thumbnail,
    view_count: textFromRuns(renderer.viewCountText) || 'YouTube',
  };
}

async function searchYouTubeInnerTubeHttp(
  query: string,
  limit: number,
): Promise<YouTubeSearchResult[]> {
  const response = await RNBlobUtil.fetch(
    'POST',
    'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
    {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      Accept: 'application/json',
    },
    JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240304.00.00',
          hl: 'en',
          gl: 'US',
        },
      },
      query,
      params: 'EgIQAQ%3D%3D',
    }),
  );

  const status = response.info().status;
  if (status < 200 || status >= 300) {
    throw new Error(`InnerTube HTTP search returned ${status}`);
  }

  const textRaw = response.text();
  const jsonText = typeof textRaw === 'string' ? textRaw : await (textRaw as Promise<string>);
  const data = JSON.parse(jsonText);
  const seen = new Set<string>();
  const results: YouTubeSearchResult[] = [];

  for (const renderer of collectVideoRenderers(data)) {
    const result = rendererToSearchResult(renderer);
    if (!result || seen.has(result.id)) continue;
    seen.add(result.id);
    results.push(result);
    if (results.length >= limit) break;
  }

  return results;
}

async function searchYouTubeWeb(
  query: string,
  limit: number,
): Promise<YouTubeSearchResult[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const response = await RNBlobUtil.fetch('GET', url, {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  });

  const htmlRaw = response.text();
  const html = typeof htmlRaw === 'string' ? htmlRaw : await (htmlRaw as Promise<string>);
  const seen = new Set<string>();
  const results: YouTubeSearchResult[] = [];

  for (const renderer of extractVideoRenderers(html)) {
    const result = rendererToSearchResult(renderer);
    if (!result || seen.has(result.id)) continue;

    seen.add(result.id);
    results.push(result);

    if (results.length >= limit) break;
  }

  return results;
}

function canExtendEventTarget(): boolean {
  try {
    const EventTargetCtor = (globalThis as any).EventTarget;
    if (typeof EventTargetCtor !== 'function') return false;
    class TestEventTarget extends EventTargetCtor {}
    void TestEventTarget;
    return true;
  } catch {
    return false;
  }
}

function installYoutubeiHermesPolyfills(): void {
  const global = globalThis as any;

  if (typeof global.Event !== 'function') {
    global.Event = class Event {
      type: string;
      bubbles: boolean;
      cancelable: boolean;
      composed: boolean;
      defaultPrevented = false;

      constructor(type: string, opts?: { bubbles?: boolean; cancelable?: boolean; composed?: boolean }) {
        this.type = String(type);
        this.bubbles = !!opts?.bubbles;
        this.cancelable = !!opts?.cancelable;
        this.composed = !!opts?.composed;
      }

      preventDefault() {
        if (this.cancelable) this.defaultPrevented = true;
      }

      stopPropagation() {}
      stopImmediatePropagation() {}
    };
  }

  if (!canExtendEventTarget()) {
    global.EventTarget = class EventTarget {
      private __listeners = new Map<string, Map<any, AddEventListenerOptions | boolean | undefined>>();

      addEventListener(type: string, listener: any, options?: AddEventListenerOptions | boolean) {
        if (!listener) return;
        const key = String(type);
        if (!this.__listeners.has(key)) {
          this.__listeners.set(key, new Map());
        }
        this.__listeners.get(key)?.set(listener, options);
      }

      removeEventListener(type: string, listener: any) {
        this.__listeners.get(String(type))?.delete(listener);
      }

      dispatchEvent(event: Event) {
        const listeners = this.__listeners.get(String(event.type));
        if (!listeners) return true;

        for (const [listener, options] of [...listeners.entries()]) {
          if (typeof listener === 'function') {
            listener.call(this, event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }

          const once = typeof options === 'object' && options?.once;
          if (once) listeners.delete(listener);
        }

        return !event.defaultPrevented;
      }
    };
  }

  if (typeof global.CustomEvent !== 'function') {
    global.CustomEvent = class CustomEvent extends global.Event {
      detail: unknown;

      constructor(type: string, opts?: { detail?: unknown; bubbles?: boolean; cancelable?: boolean; composed?: boolean }) {
        super(type, opts);
        this.detail = opts?.detail;
      }
    };
  }
}

async function loadYoutubei() {
  installYoutubeiHermesPolyfills();
  // Use the pre-bundled single-file build instead of the dist/ ESM tree.
  // The dist/ tree relies on Hermes module-evaluation order and class-extends
  // semantics that occasionally fail under Metro's inlineRequires; the bundle
  // file resolves all internal imports at build time so it loads cleanly.
  // @ts-expect-error — sub-path import not in package "exports", but Metro resolves it fine.
  const mod = await import('youtubei.js/bundle/react-native.js');
  const InnertubeClass = (mod as any).Innertube ?? (mod as any).default;

  if (!InnertubeClass?.create) {
    throw new Error('youtubei.js loaded without an Innertube.create export');
  }

  return InnertubeClass;
}

/**
 * Returns a lazily-created, cached Innertube instance.
 *
 * A custom `fetch` adapter is injected so that all HTTP requests made
 * internally by YouTubei.js are routed through `react-native-blob-util`
 * instead of the default browser/Node fetch. This is required because React
 * Native's built-in `fetch` doesn't support the binary streaming that
 * YouTubei.js needs for cipher decryption and player.js downloads.
 *
 * `generate_session_locally: true` avoids a round-trip to YouTube's
 * /generate_204 endpoint on first load, improving cold-start time.
 */
async function getInnertube(): Promise<InnertubeInstance> {
  if (_innertube) return _innertube;

  const Innertube = await loadYoutubei();

  const innertube = await Innertube.create({
    // Generate the session visitor data locally instead of fetching it,
    // reducing the number of bootstrap requests.
    generate_session_locally: true,
    enable_session_cache: false,

    // ── Custom fetch adapter ─────────────────────────────────────────────
    fetch: async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      // Normalise input to a plain URL string while preserving Request fields.
      let url: string;
      const requestInput =
        typeof input !== 'string' &&
        !(typeof URL !== 'undefined' && input instanceof URL)
          ? (input as Request)
          : null;

      if (typeof input === 'string') {
        url = input;
      } else if (typeof URL !== 'undefined' && input instanceof URL) {
        url = input.toString();
      } else {
        // Request object
        url = requestInput?.url ?? '';
      }

      const method = ((init?.method ?? requestInput?.method ?? 'GET') as string).toUpperCase();
      logger.info(`[Innertube fetch] ${method} ${url.slice(0, 120)}${url.length > 120 ? '…' : ''}`);

      // Flatten headers to a plain Record<string, string> for RNBlobUtil.
      let headers: Record<string, string> = {};
      const requestHeaders = init?.headers ?? requestInput?.headers;
      if (requestHeaders) {
        if (typeof Headers !== 'undefined' && requestHeaders instanceof Headers) {
          requestHeaders.forEach((value: string, key: string) => {
            headers[key] = value;
          });
        } else if (Array.isArray(requestHeaders)) {
          for (const [key, value] of requestHeaders) {
            headers[key] = value;
          }
        } else {
          headers = requestHeaders as Record<string, string>;
        }
      }

      // Body must be a string for RNBlobUtil. POST bodies from YouTubei.js are
      // always JSON strings.
      let body = '';
      if (init?.body != null) {
        body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
      } else if (
        requestInput &&
        method !== 'GET' &&
        method !== 'HEAD' &&
        typeof requestInput.text === 'function'
      ) {
        body = await requestInput.text();
      }

      try {
        const res = await RNBlobUtil.fetch(method as any, url, headers, body || undefined);
        const status = res.info().status;
        const responseTextRaw = res.text();
        const responseText =
          typeof responseTextRaw === 'string'
            ? responseTextRaw
            : await (responseTextRaw as Promise<string>);

        if (typeof Response === 'undefined') {
          return {
            ok: status >= 200 && status < 300,
            status,
            headers: new Map(),
            url,
            text: async () => responseText,
            json: async () => JSON.parse(responseText),
            arrayBuffer: async () => {
              const bytes = new Uint8Array(responseText.length);
              for (let i = 0; i < responseText.length; i += 1) {
                bytes[i] = responseText.charCodeAt(i) & 0xff;
              }
              return bytes.buffer;
            },
          } as unknown as Response;
        }

        // Build a standards-compliant Response so YouTubei.js can call
        // .json() / .text() on it as usual.
        return new Response(responseText, {
          status,
          headers: {},
        });
      } catch (err) {
        throw new Error(`YouTubei fetch failed for ${url}: ${err}`);
      }
    },
  });

  _innertube = innertube;
  return innertube;
}

/**
 * Invalidates the cached Innertube instance. Call this if you start seeing
 * cipher decryption errors, which usually mean the cached player.js is stale.
 */
export function resetInnertube(): void {
  _innertube = null;
}

// ── Search ────────────────────────────────────────────────────────────────

/**
 * Searches YouTube for `query` and returns up to `limit` video results mapped
 * to the app's `YouTubeSearchResult` type.
 *
 * Only `type: 'video'` results are requested to filter out channels/playlists.
 */
export async function searchYouTube(
  query: string,
  limit = 10,
): Promise<YouTubeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  let backendResponded = false;

  try {
    const apiResults = await searchYouTubeInnerTubeHttp(trimmed, limit);
    backendResponded = true;
    if (apiResults.length > 0) return apiResults;
  } catch (err) {
    logger.error('[YoutubeExtractor] direct InnerTube search failed:', err);
  }

  try {
    const webResults = await searchYouTubeWeb(trimmed, limit);
    backendResponded = true;
    if (webResults.length > 0) return webResults;
  } catch (err) {
    logger.error('[YoutubeExtractor] web search failed:', err);
  }

  try {
    const yt = await getInnertube();
    const results = await yt.search(trimmed, { type: 'video' });

    backendResponded = true;
    return (results.videos ?? []).slice(0, limit).map((v: any): YouTubeSearchResult => {
      const thumbnails = Array.isArray(v.thumbnails) ? [...v.thumbnails] : [];
      thumbnails.sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0));

      return {
        id: v.id ?? '',
        title: v.title?.text ?? String(v.title ?? 'Unknown'),
        author: v.author?.name ?? 'Unknown',
        duration_ms: (v.duration?.seconds ?? 0) * 1000,
        thumbnail: thumbnails[0]?.url ?? v.best_thumbnail?.url ?? '',
        view_count: v.view_count?.text ?? v.short_view_count?.text ?? '0 views',
      };
    });
  } catch (err) {
    logger.error('[YoutubeExtractor] search failed:', err);
    resetInnertube();
  }

  if (backendResponded) return [];
  throw new Error('YouTube search is unavailable right now. Please try again.');
}

// ── Audio stream extraction ────────────────────────────────────────────────

export interface AudioStreamInfo {
  /** Fully deciphered, ready-to-download stream URL. */
  url: string;
  /** MIME type as reported by YouTube (e.g. "audio/webm; codecs=opus"). */
  mimeType: string;
  /** Nominal bitrate in bits per second. */
  bitrate: number;
  /** File-extension hint derived from the MIME type: 'm4a' or 'webm'. */
  container: 'm4a' | 'webm';
  /**
   * `true` when the source codec is not AAC and we must re-encode to land
   * in an M4A container (lossy). `false` when the source is already AAC and
   * we can stream-copy / passthrough bit-for-bit.
   */
  needsTranscode: boolean;
  /**
   * Effective bitrate the user will hear. For AAC sources this equals the
   * source bitrate (passthrough). For Opus → AAC transcodes this equals the
   * target bitrate of the FFmpeg encoder (320k = 320000).
   */
  effectiveBitrate: number;
  /**
   * Track duration in milliseconds, taken from YouTube's video info.
   * 0 when unknown (very rare — getInfo always returns duration).
   */
  durationMs: number;
}

type DirectClientConfig = {
  name: 'ANDROID' | 'IOS';
  version: string;
  userAgent: string;
  contextClient: Record<string, unknown>;
};

const DIRECT_CLIENTS: DirectClientConfig[] = [
  {
    name: 'ANDROID',
    version: ANDROID_CLIENT_VERSION,
    userAgent: ANDROID_USER_AGENT,
    contextClient: {
      clientName: 'ANDROID',
      clientVersion: ANDROID_CLIENT_VERSION,
      androidSdkVersion: 36,
      osName: 'Android',
      osVersion: '16',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'IOS',
    version: IOS_CLIENT_VERSION,
    userAgent: IOS_USER_AGENT,
    contextClient: {
      clientName: 'IOS',
      clientVersion: IOS_CLIENT_VERSION,
      deviceModel: 'iPhone10,4',
      osName: 'iOS',
      osVersion: '16.7.7.20H330',
      hl: 'en',
      gl: 'US',
    },
  },
];

async function getDirectClientAudioStream(
  videoId: string,
  client: DirectClientConfig,
): Promise<AudioStreamInfo> {
  const response = await RNBlobUtil.fetch(
    'POST',
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
    {
      'Content-Type': 'application/json',
      'User-Agent': client.userAgent,
      Accept: 'application/json',
    },
    JSON.stringify({
      context: {
        client: client.contextClient,
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  );

  const status = response.info().status;
  const textRaw = response.text();
  const jsonText = typeof textRaw === 'string' ? textRaw : await (textRaw as Promise<string>);

  if (status < 200 || status >= 300) {
    throw new Error(`${client.name} player request returned ${status}`);
  }

  const data = JSON.parse(jsonText);
  const playabilityStatus = data.playabilityStatus?.status;
  if (playabilityStatus && playabilityStatus !== 'OK') {
    throw new Error(
      `${client.name} player status ${playabilityStatus}: ${data.playabilityStatus?.reason ?? 'unknown reason'}`,
    );
  }

  const formats: any[] = data.streamingData?.adaptiveFormats ?? [];
  const audioFormats = formats.filter(
    (f: any) =>
      typeof f.url === 'string' &&
      /^https?:\/\//i.test(f.url) &&
      !String(f.url).includes('sabr=1') &&
      String(f.mimeType ?? '').startsWith('audio/'),
  );

  if (audioFormats.length === 0) {
    throw new Error(`${client.name} player returned no direct audio streams for video ${videoId}`);
  }

  const scored = audioFormats.map((f: any) => {
    const mime = (f.mimeType as string | undefined) ?? '';
    const isAAC = mime.includes('mp4');
    const bitrate = (f.bitrate as number | undefined) ?? 0;
    return {
      f,
      isAAC,
      bitrate,
      // Prefer AAC/M4A for downloaded library files. Opus/WebM can be higher
      // on paper, but M4A is more reliable for RNTP metadata, lock-screen
      // duration, and Android media library discovery.
      score: (isAAC ? 1_000_000 : 0) + bitrate,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const isM4A = best.isAAC;

  // Android player endpoint returns videoDetails.lengthSeconds (string).
  const lengthSecondsStr = data?.videoDetails?.lengthSeconds;
  const lengthSec = typeof lengthSecondsStr === 'string' ? parseInt(lengthSecondsStr, 10) : 0;
  const durationMs = Number.isFinite(lengthSec) && lengthSec > 0 ? lengthSec * 1000 : 0;

  logger.info(
    `[YoutubeExtractor] ${client.name} direct stream selected — container:${isM4A ? 'm4a' : 'webm'} ` +
    `bitrate:${best.bitrate} url-len:${best.f.url.length} duration:${durationMs}ms (raw:${lengthSecondsStr})`,
  );

  return {
    url: best.f.url,
    mimeType: (best.f.mimeType as string | undefined) ?? 'audio/webm',
    bitrate: best.bitrate,
    container: isM4A ? 'm4a' : 'webm',
    needsTranscode: !isM4A,
    effectiveBitrate: best.bitrate,
    durationMs,
  };
}

async function getDirectAudioStream(videoId: string): Promise<AudioStreamInfo> {
  let lastError: unknown = null;
  for (const client of DIRECT_CLIENTS) {
    try {
      return await getDirectClientAudioStream(videoId, client);
    } catch (err) {
      lastError = err;
      logger.warn(`[YoutubeExtractor] ${client.name} direct stream failed:`, err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No direct audio stream available for video ${videoId}`);
}

/**
 * Fetches the adaptive streaming manifest for `videoId` and returns metadata
 * for the highest-bitrate audio-only stream.
 *
 * The returned `url` is already deciphered (n-param transformation + sig
 * applied) and is valid for a short window (~6 hours). Callers should begin
 * downloading immediately after receiving this result.
 *
 * Format-selection strategy
 * ─────────────────────────
 * We score every audio-only adaptive format with `bitrate * (isAAC ? 1.1 : 1)`
 * — a 10 % bias toward AAC. Both AAC (.m4a) and Opus (.webm) are kept at
 * SOURCE quality (no transcoding ever happens — RNTP / ExoPlayer plays both
 * containers natively on Android). The AAC bias exists because:
 *   - m4a has slightly broader Android device compatibility
 *   - lock-screen + notification metadata is more uniform across vendors
 * The scoring naturally falls back to Opus when YouTube only offers a
 * much-higher-bitrate Opus stream — Opus is more efficient than AAC, so
 * Opus 160 kbps ≈ AAC 256 kbps in perceptual quality.
 */
export async function getBestAudioStream(
  videoId: string,
): Promise<AudioStreamInfo> {
  try {
    return await getDirectAudioStream(videoId);
  } catch (err) {
    logger.warn('[YoutubeExtractor] Direct stream clients failed, falling back to youtubei:', err);
  }

  const yt = await getInnertube();
  const info = await yt.getInfo(videoId);
  const formats: any[] = info.streaming_data?.adaptive_formats ?? [];

  // Keep only audio-only adaptive streams.
  const audioFormats = formats.filter(
    (f: any) => f.has_audio === true && f.has_video === false,
  );

  if (audioFormats.length === 0) {
    throw new Error(`No audio streams available for video ${videoId}`);
  }

  // Score every audio-only stream. AAC gets a 10 % bonus to favour the
  // lossless stream-copy path. Avoid SABR URLs when possible; those are
  // session-bound streaming endpoints and often reject plain file downloads.
  const scored = audioFormats.map((f: any) => {
    const mime = (f.mime_type as string | undefined) ?? '';
    const isAAC = mime.includes('mp4');
    const bitrate = (f.bitrate as number | undefined) ?? 0;
    const rawUrl = String(f.url ?? f.signature_cipher ?? f.cipher ?? '');
    const isSabr = rawUrl.includes('sabr=1') || rawUrl.includes('/sabr/');
    const score = (isAAC ? 1_000_000 : 0) + bitrate - (isSabr ? 1_000_000 : 0);
    return { f, isAAC, bitrate, score, isSabr };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // ANDROID/IOS client returns direct .url that's already deciphered and
  // ready to download. WEB client wraps URLs in signature_cipher and needs
  // decipher(). Try direct URL first, fall through to cipher only when we
  // got the WEB-style payload.
  let url: string = '';
  const directUrl = typeof best.f.url === 'string' ? best.f.url : '';
  if (directUrl.startsWith('http')) {
    url = directUrl;
  } else {
    try {
      url = (await best.f.decipher(yt.session.player)) as string;
    } catch (err) {
      logger.error('Stream deciphering failed:', err);
      throw new Error(`Could not resolve stream URL for video ${videoId}`);
    }
  }

  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error(`Invalid audio stream URL for video ${videoId}`);
  }

  const isM4A = best.isAAC;
  // `needsTranscode` is now informational only — the DownloadManager always
  // stream-copies. We keep the field for any future code path that wants to
  // know whether the source was originally AAC or Opus.
  const needsTranscode = !isM4A;
  // Effective bitrate is always the source bitrate now (no transcoding).
  const effectiveBitrate = best.bitrate;

  // Pull duration from YouTube's video info — works regardless of search source.
  const durationSec =
    info?.basic_info?.duration ??
    info?.video_details?.duration ??
    info?.duration ??
    0;
  const durationMs = typeof durationSec === 'number' ? Math.round(durationSec * 1000) : 0;

  return {
    url,
    mimeType: (best.f.mime_type as string | undefined) ?? 'audio/webm',
    bitrate: best.bitrate,
    container: isM4A ? 'm4a' : 'webm',
    needsTranscode,
    effectiveBitrate,
    durationMs,
  };
}

/**
 * Legacy alias kept for backward compatibility with any existing call-sites
 * that use the old `getAudioStreamUrl(videoId)` signature.
 *
 * @deprecated Use `getBestAudioStream` instead.
 */
export async function getAudioStreamUrl(videoId: string): Promise<string | null> {
  try {
    const stream = await getBestAudioStream(videoId);
    return stream.url;
  } catch (err) {
    logger.error('[YoutubeExtractor] getAudioStreamUrl failed for', videoId, ':', err);
    return null;
  }
}

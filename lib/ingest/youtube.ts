import { saveRows, sourceCounts } from '@/lib/ingest/store';
import { toIsoDate, type IngestRow } from '@/lib/ingest/text';

const SEARCH = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';
const THREADS = 'https://www.googleapis.com/youtube/v3/commentThreads';
export const YOUTUBE_CALL_CAP = 100;
export const YOUTUBE_UNIT_CAP = 2500;
export const YOUTUBE_QUERIES = [
  'should I stop my SIP',
  'SIP returns after 1 year',
  'is SIP worth it',
  'SIP vs lumpsum',
  'why my SIP not growing'
] as const;
const SEARCH_LANGUAGES = ['en', 'hi'] as const;
const VIDEOS_PER_QUERY = 5;
const SEARCH_RESULTS = 10;
const COMMENT_PAGES_PER_VIDEO = 3;

type YtSearchItem = { id?: { kind?: string; videoId?: string } };
type YtVideoItem = { id?: string; statistics?: { viewCount?: string } };

type YtComment = {
  id?: string;
  snippet?: { textOriginal?: string; textDisplay?: string; publishedAt?: string };
};

type YtThread = {
  snippet?: { topLevelComment?: YtComment };
  replies?: { comments?: YtComment[] };
};

type YtPage = {
  items?: unknown[];
  nextPageToken?: string;
  error?: { message?: string; errors?: { reason?: string; message?: string }[] };
};

export type YouTubeResult = {
  source: 'youtube';
  queries: string[];
  videos: number;
  videoIds: string[];
  calls: number;
  units: number;
  fetched: number;
  inserted: number;
  duplicates: number;
  dropped: number;
  stopped: string | null;
  counts: Awaited<ReturnType<typeof sourceCounts>>;
  examples: IngestRow[];
};

export function topVideosByViews(rows: { id: string; views: number }[], limit: number): string[] {
  const best = new Map<string, number>();
  for (const row of rows) {
    const prev = best.get(row.id);
    if (prev === undefined || row.views > prev) best.set(row.id, row.views);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

export function youtubeFailure(status: number, body: string): string | null {
  let reason = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as YtPage;
    reason = parsed.error?.errors?.[0]?.reason || '';
    message = parsed.error?.message || '';
  } catch {
    message = body.slice(0, 180);
  }
  if (status === 403 && /quota/i.test(`${reason} ${message}`)) {
    return 'YouTube quota exceeded. Stopped. Comments already saved were kept, and no further calls were made.';
  }
  if (reason === 'commentsDisabled') return 'Comments are disabled on this video. Skipped it.';
  if (status === 400 || status === 404 || reason === 'videoNotFound' || reason === 'processingFailure') {
    return message || `YouTube rejected a video id (${status}). Skipped it.`;
  }
  if (status >= 400) return message || `YouTube HTTP ${status}. Stopped.`;
  return null;
}

function isHardStop(message: string): boolean {
  return /quota exceeded/i.test(message) || /unit cap/i.test(message) || /Stopped\.$/.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type YtState = { calls: number; units: number; stopped: string | null };

async function youtubeGet(url: URL, cost: number, state: YtState): Promise<YtPage | null> {
  if (state.units + cost > YOUTUBE_UNIT_CAP) {
    state.stopped = `Stopped at the YouTube unit cap of ${YOUTUBE_UNIT_CAP}. search.list costs 100 units and commentThreads costs 1. Comments already saved were kept.`;
    return null;
  }
  state.calls += 1;
  state.units += cost;
  await sleep(250);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    state.stopped = error instanceof Error ? `${error.message} Stopped.` : 'YouTube request failed. Stopped.';
    return null;
  }
  const body = await response.text();
  if (!response.ok) {
    state.stopped = youtubeFailure(response.status, body) || `YouTube HTTP ${response.status}. Stopped.`;
    return null;
  }
  try {
    return JSON.parse(body) as YtPage;
  } catch {
    state.stopped = 'YouTube returned a response that was not JSON. Stopped.';
    return null;
  }
}

async function discoverVideos(key: string, state: YtState): Promise<string[]> {
  const chosen: string[] = [];
  for (const query of YOUTUBE_QUERIES) {
    if (state.stopped) break;
    const found: string[] = [];
    for (const language of SEARCH_LANGUAGES) {
      if (state.stopped) break;
      const url = new URL(SEARCH);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('type', 'video');
      url.searchParams.set('q', query);
      url.searchParams.set('regionCode', 'IN');
      url.searchParams.set('relevanceLanguage', language);
      url.searchParams.set('order', 'relevance');
      url.searchParams.set('maxResults', String(SEARCH_RESULTS));
      url.searchParams.set('key', key);
      const page = await youtubeGet(url, 100, state);
      if (!page) {
        if (state.stopped && isHardStop(state.stopped)) return chosen;
        continue;
      }
      for (const item of (page.items ?? []) as YtSearchItem[]) {
        const id = item.id?.videoId;
        if (item.id?.kind === 'youtube#video' && id && /^[A-Za-z0-9_-]{11}$/.test(id) && !found.includes(id)) found.push(id);
      }
    }
    if (!found.length || state.stopped) continue;
    const stats = new URL(VIDEOS);
    stats.searchParams.set('part', 'statistics');
    stats.searchParams.set('id', found.join(','));
    stats.searchParams.set('key', key);
    const page = await youtubeGet(stats, 1, state);
    const views = new Map<string, number>();
    for (const item of (page?.items ?? []) as YtVideoItem[]) {
      if (item.id) views.set(item.id, Number(item.statistics?.viewCount || 0));
    }
    if (state.stopped && isHardStop(state.stopped)) return chosen;
    state.stopped = null;
    const ranked = topVideosByViews(
      found.map((id) => ({ id, views: views.get(id) ?? 0 })),
      VIDEOS_PER_QUERY
    );
    for (const id of ranked) {
      if (!chosen.includes(id)) chosen.push(id);
    }
  }
  return chosen;
}

function videoIdList(value: string[]): string[] {
  const ids: string[] = [];
  for (const raw of value) {
    for (const part of raw.split(/[\s,]+/)) {
      const id = part.trim();
      if (/^[A-Za-z0-9_-]{11}$/.test(id) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function rowFromComment(comment: YtComment | undefined): IngestRow | null {
  const id = comment?.id;
  const text = comment?.snippet?.textOriginal || comment?.snippet?.textDisplay || '';
  const date = toIsoDate(comment?.snippet?.publishedAt);
  if (!id || !date || !text.trim()) return null;
  return { id: `youtube:${id}`, source: 'youtube', date, text };
}

export async function pullYouTube(rawIds: string[], maxCalls = 80): Promise<YouTubeResult> {
  const supplied = videoIdList(rawIds);
  const callCap = Math.min(YOUTUBE_CALL_CAP, Math.max(1, Math.floor(maxCalls)));
  const base = {
    source: 'youtube' as const,
    queries: supplied.length ? [] : [...YOUTUBE_QUERIES],
    videos: supplied.length,
    videoIds: supplied,
    calls: 0,
    units: 0,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    dropped: 0,
    stopped: null as string | null,
    counts: await sourceCounts(),
    examples: [] as IngestRow[]
  };
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return { ...base, stopped: 'YOUTUBE_API_KEY is not set. No YouTube calls were made.' };
  }

  const state: YtState = { calls: 0, units: 0, stopped: null };
  const videoIds = supplied.length ? supplied : await discoverVideos(key, state);
  if (!videoIds.length) {
    return {
      ...base,
      calls: state.calls,
      units: state.units,
      stopped: state.stopped || 'YouTube search returned no videos. No comments were requested.'
    };
  }
  if (state.stopped && isHardStop(state.stopped)) {
    return {
      ...base,
      videos: videoIds.length,
      videoIds,
      calls: state.calls,
      units: state.units,
      stopped: state.stopped
    };
  }
  state.stopped = null;

  const examples: IngestRow[] = [];
  const notes: string[] = [];
  let commentCalls = 0;
  let fetched = 0;
  let inserted = 0;
  let duplicates = 0;
  let dropped = 0;

  for (const videoId of videoIds) {
    if (state.stopped) break;
    let pageToken = '';
    let pages = 0;
    while (!state.stopped) {
      if (commentCalls >= callCap) {
        state.stopped = `Stopped at the call cap of ${callCap} commentThreads request${callCap === 1 ? '' : 's'} so the daily YouTube quota is not used up.`;
        break;
      }
      if (pages >= COMMENT_PAGES_PER_VIDEO) break;
      const url = new URL(THREADS);
      url.searchParams.set('part', 'snippet,replies');
      url.searchParams.set('videoId', videoId);
      url.searchParams.set('maxResults', '100');
      url.searchParams.set('textFormat', 'plainText');
      url.searchParams.set('order', 'time');
      url.searchParams.set('key', key);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      commentCalls += 1;
      const page = await youtubeGet(url, 1, state);
      if (!page) {
        if (state.stopped && isHardStop(state.stopped)) break;
        if (state.stopped) {
          notes.push(`${videoId}: ${state.stopped}`);
          state.stopped = null;
        }
        break;
      }
      pages += 1;
      const rows: IngestRow[] = [];
      for (const thread of (page.items ?? []) as YtThread[]) {
        const top = rowFromComment(thread.snippet?.topLevelComment);
        const replies = (thread.replies?.comments ?? []).map(rowFromComment);
        for (const row of [top, ...replies]) {
          if (!row) {
            dropped += 1;
            continue;
          }
          fetched += 1;
          rows.push(row);
        }
      }
      const saved = await saveRows(rows);
      inserted += saved.inserted;
      duplicates += saved.duplicates;
      dropped += saved.dropped;
      for (const example of saved.examples) {
        if (examples.length < 3) examples.push(example);
      }
      pageToken = page.nextPageToken || '';
      if (!pageToken) break;
    }
  }

  const note = notes.length ? notes.join(' ') : null;
  return {
    source: 'youtube',
    queries: supplied.length ? [] : [...YOUTUBE_QUERIES],
    videos: videoIds.length,
    videoIds,
    calls: state.calls,
    units: state.units,
    fetched,
    inserted,
    duplicates,
    dropped,
    stopped: state.stopped && note ? `${state.stopped} ${note}` : state.stopped || note,
    counts: await sourceCounts(),
    examples
  };
}

import { saveRows, sourceCounts } from '@/lib/ingest/store';
import { toIsoDate, type IngestRow } from '@/lib/ingest/text';

export const PLAY_APP_ID = 'com.nextbillion.groww';
export const PLAY_LIMIT_MAX = 3000;

type PlayReview = {
  id?: string;
  text?: string;
  score?: number;
  date?: Date | string | null;
};

type PlayPage = {
  data?: PlayReview[];
  nextPaginationToken?: string | null;
};

type PlayClient = {
  sort: { NEWEST: number };
  reviews: (opts: Record<string, unknown>) => Promise<PlayPage>;
};

export type PlayStoreResult = {
  source: 'playstore';
  appId: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  dropped: number;
  stopped: string | null;
  counts: Awaited<ReturnType<typeof sourceCounts>>;
  examples: IngestRow[];
};

export async function pullPlayStore(limit: number): Promise<PlayStoreResult> {
  const wanted = Math.min(PLAY_LIMIT_MAX, Math.max(1, Math.floor(limit)));
  const gplay = (await import('google-play-scraper')).default as unknown as PlayClient;
  const examples: IngestRow[] = [];
  let fetched = 0;
  let inserted = 0;
  let duplicates = 0;
  let dropped = 0;
  let token: string | null = null;
  let stopped: string | null = null;

  while (fetched < wanted) {
    let page: PlayPage;
    try {
      page = await gplay.reviews({
        appId: PLAY_APP_ID,
        sort: gplay.sort.NEWEST,
        lang: 'en',
        country: 'in',
        num: Math.min(150, wanted - fetched),
        paginate: true,
        nextPaginationToken: token,
        throttle: 2
      });
    } catch (error) {
      stopped = error instanceof Error ? error.message : 'Play Store request failed';
      break;
    }
    const reviews = page.data ?? [];
    if (!reviews.length) break;
    fetched += reviews.length;
    const rows: IngestRow[] = [];
    for (const review of reviews) {
      const date = toIsoDate(review.date);
      const text = typeof review.text === 'string' ? review.text : '';
      const id = review.id ? `playstore:${review.id}` : '';
      if (!id || !date || !text.trim()) {
        dropped += 1;
        continue;
      }
      const score = Number.isInteger(review.score) ? review.score : undefined;
      rows.push({ id, source: 'playstore', date, text, score });
    }
    const saved = await saveRows(rows);
    inserted += saved.inserted;
    duplicates += saved.duplicates;
    dropped += saved.dropped;
    for (const example of saved.examples) {
      if (examples.length < 3) examples.push(example);
    }
    token = page.nextPaginationToken ?? null;
    if (!token) break;
  }

  return {
    source: 'playstore',
    appId: PLAY_APP_ID,
    fetched,
    inserted,
    duplicates,
    dropped,
    stopped,
    counts: await sourceCounts(),
    examples
  };
}

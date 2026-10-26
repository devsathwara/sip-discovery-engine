import { prisma } from '@/lib/db';
import { saveRows, sourceCounts } from '@/lib/ingest/store';
import { toIsoDate, type IngestRow } from '@/lib/ingest/text';

const ACTOR = 'harshmaur~reddit-scraper';
const RUNS = `https://api.apify.com/v2/acts/${ACTOR}/runs`;

export const REDDIT_SUBREDDITS = [
  'IndiaInvestments',
  'mutualfunds',
  'personalfinanceindia',
  'IndianStreetBets',
  'FIRE_Ind'
] as const;

export const REDDIT_TERMS = [
  'stopped SIP',
  'pause SIP',
  'reduce SIP',
  'SIP returns',
  'SIP worth it',
  'cancel SIP',
  'SIP not growing'
] as const;

export type RedditSearch = {
  query: string;
  subreddit: string;
};

export function redditPlan(): RedditSearch[] {
  const searches: RedditSearch[] = [];
  for (const query of REDDIT_TERMS) {
    for (const subreddit of REDDIT_SUBREDDITS) {
      searches.push({ query, subreddit });
    }
  }
  return searches;
}

export function redditRecordId(dataType: unknown, id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null;
  if (dataType === 'post') return id.startsWith('t3_') ? `reddit:${id}` : null;
  if (dataType === 'comment') {
    if (id.startsWith('t1_')) return `reddit:${id}`;
    if (/^[a-z0-9]+$/i.test(id)) return `reddit:t1_${id}`;
  }
  return null;
}

export type RedditResult = {
  source: 'reddit';
  actor: string;
  full: boolean;
  searchesRun: number;
  fetched: number;
  postsFetched: number;
  commentsFetched: number;
  inserted: number;
  postsInserted: number;
  commentsInserted: number;
  duplicates: number;
  dropped: number;
  t3Stored: number;
  t1Stored: number;
  stopped: string | null;
  counts: Awaited<ReturnType<typeof sourceCounts>>;
  examples: IngestRow[];
};

function token(): string | null {
  return process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || null;
}

function rowFromActor(raw: unknown): IngestRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = redditRecordId(item.dataType, item.id);
  if (!id) return null;
  const date = toIsoDate(item.dataType === 'comment' ? item.commentCreatedAt || item.createdAt : item.createdAt);
  if (!date) return null;
  const body = typeof item.body === 'string' ? item.body : '';
  const title = typeof item.title === 'string' ? item.title : '';
  const text = item.dataType === 'comment' ? body : [title, body].filter(Boolean).join('\n');
  if (!text.trim()) return null;
  return { id, source: 'reddit', date, text };
}

async function apifyJson(url: string, key: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Apify ${response.status}: ${body.slice(0, 240) || response.statusText} Stopped.`);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Apify did not return JSON. Stopped.');
  }
}

function dataOf(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error('Apify returned an unexpected payload. Stopped.');
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') throw new Error('Apify returned an unexpected payload. Stopped.');
  return data as Record<string, unknown>;
}

async function datasetItems(datasetId: string, key: string): Promise<unknown[]> {
  const items: unknown[] = [];
  const limit = 1000;
  for (let offset = 0; offset < 20000; offset += limit) {
    const page = await apifyJson(
      `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=${limit}&offset=${offset}`,
      key
    );
    if (!Array.isArray(page)) throw new Error('Apify dataset was not a list. Stopped.');
    items.push(...page);
    if (page.length < limit) break;
  }
  return items;
}

async function oneCommunity(
  subreddit: string,
  terms: readonly string[],
  key: string,
  caps: { posts: number; searchComments: number; perPost: number; chargeUsd: number }
): Promise<IngestRow[]> {
  const started = await apifyJson(`${RUNS}?timeout=1800&memory=512&maxTotalChargeUsd=${caps.chargeUsd}`, key, {
    method: 'POST',
    body: JSON.stringify({
      searchTerms: [...terms],
      withinCommunity: `r/${subreddit}`,
      searchPosts: true,
      searchComments: true,
      searchCommunities: false,
      searchSort: 'relevance',
      searchTime: 'all',
      includeNSFW: false,
      crawlCommentsPerPost: true,
      maxPostsCount: caps.posts,
      maxCommentsCount: caps.searchComments,
      maxCommentsPerPost: caps.perPost
    })
  });
  const run = dataOf(started);
  const runId = String(run.id || '');
  if (!runId) throw new Error('Apify did not return a run id. Stopped.');
  let datasetId = String(run.defaultDatasetId || '');
  let status = String(run.status || 'READY');
  const deadline = Date.now() + 1_800_000;
  while (!['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
    if (Date.now() > deadline) throw new Error('Apify run exceeded 30 minutes. Stopped.');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const polled = dataOf(await apifyJson(`https://api.apify.com/v2/actor-runs/${runId}`, key));
    status = String(polled.status || '');
    if (polled.defaultDatasetId) datasetId = String(polled.defaultDatasetId);
  }
  if (!datasetId) throw new Error(`Apify run ${status} and returned no dataset. Stopped.`);
  const items = await datasetItems(datasetId, key);
  if (status === 'FAILED' && items.length === 0) throw new Error(`Apify run FAILED. Stopped.`);
  if (status !== 'SUCCEEDED') {
    const error = new Error(`Apify run ${status}. Rows already returned were kept. Stopped.`);
    (error as Error & { rows?: IngestRow[] }).rows = items.map(rowFromActor).filter((row): row is IngestRow => Boolean(row));
    throw error;
  }
  return items.map(rowFromActor).filter((row): row is IngestRow => Boolean(row));
}

async function storedKinds(): Promise<{ t3Stored: number; t1Stored: number }> {
  const [t3Stored, t1Stored] = await Promise.all([
    prisma.ingestRecord.count({ where: { source: 'reddit', id: { startsWith: 'reddit:t3_' } } }),
    prisma.ingestRecord.count({ where: { source: 'reddit', id: { startsWith: 'reddit:t1_' } } })
  ]);
  return { t3Stored, t1Stored };
}

export async function pullReddit(options?: { full?: boolean }): Promise<RedditResult> {
  const full = options?.full === true;
  const subs = full ? [...REDDIT_SUBREDDITS] : [REDDIT_SUBREDDITS[0]];
  const terms = full ? REDDIT_TERMS : REDDIT_TERMS.slice(0, 2);
  const caps = full
    ? { posts: 8, searchComments: 12, perPost: 5, chargeUsd: 0.9 }
    : { posts: 3, searchComments: 5, perPost: 3, chargeUsd: 0.2 };
  const key = token();
  const kinds = await storedKinds();
  const base = {
    source: 'reddit' as const,
    actor: 'harshmaur/reddit-scraper',
    full,
    searchesRun: 0,
    fetched: 0,
    postsFetched: 0,
    commentsFetched: 0,
    inserted: 0,
    postsInserted: 0,
    commentsInserted: 0,
    duplicates: 0,
    dropped: 0,
    ...kinds,
    stopped: null as string | null,
    counts: await sourceCounts(),
    examples: [] as IngestRow[]
  };
  if (!key) {
    return { ...base, stopped: 'APIFY_TOKEN is not set. Reddit ingestion did not run and no posts were invented.' };
  }

  const examples: IngestRow[] = [];
  let searchesRun = 0;
  let postsFetched = 0;
  let commentsFetched = 0;
  let postsInserted = 0;
  let commentsInserted = 0;
  let duplicates = 0;
  let dropped = 0;
  let stopped: string | null = null;

  for (const subreddit of subs) {
    process.stderr.write(`reddit r/${subreddit} (${terms.length} terms)\n`);
    try {
      const rows = await oneCommunity(subreddit, terms, key, caps);
      searchesRun += terms.length;
      for (const row of rows) {
        if (row.id.startsWith('reddit:t1_')) commentsFetched += 1;
        else postsFetched += 1;
      }
      const saved = await saveRows(rows);
      for (const row of saved.rows) {
        if (row.id.startsWith('reddit:t1_')) {
          commentsInserted += 1;
          if (examples.length < 3) examples.push(row);
        } else {
          postsInserted += 1;
        }
      }
      duplicates += saved.duplicates;
      dropped += saved.dropped;
    } catch (error) {
      const partial = (error as { rows?: IngestRow[] }).rows;
      if (partial?.length) {
        searchesRun += terms.length;
        for (const row of partial) {
          if (row.id.startsWith('reddit:t1_')) commentsFetched += 1;
          else postsFetched += 1;
        }
        const saved = await saveRows(partial);
        for (const row of saved.rows) {
          if (row.id.startsWith('reddit:t1_')) {
            commentsInserted += 1;
            if (examples.length < 3) examples.push(row);
          } else postsInserted += 1;
        }
        duplicates += saved.duplicates;
        dropped += saved.dropped;
      }
      const message = error instanceof Error ? error.message : 'Reddit search failed';
      stopped = /stopped\.$/i.test(message) ? message : `${message} Stopped. Rows already saved were kept.`;
      const accountBlocked = /credit|hard limit|not enough|insufficient|usage hard/i.test(stopped);
      const partialStop = /ABORTED|TIMED-OUT/i.test(stopped);
      if (partialStop && !accountBlocked && subs.indexOf(subreddit) < subs.length - 1) {
        stopped = null;
        continue;
      }
      break;
    }
  }

  if (examples.length < 3) {
    const filler = await prisma.ingestRecord.findMany({
      where: { source: 'reddit', id: { startsWith: 'reddit:t1_' } },
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    for (const row of filler) {
      if (examples.length >= 3) break;
      if (!examples.some((example) => example.id === row.id)) {
        examples.push({ id: row.id, source: 'reddit', date: row.date, text: row.text });
      }
    }
  }

  const stored = await storedKinds();
  return {
    source: 'reddit',
    actor: 'harshmaur/reddit-scraper',
    full,
    searchesRun,
    fetched: postsFetched + commentsFetched,
    postsFetched,
    commentsFetched,
    inserted: postsInserted + commentsInserted,
    postsInserted,
    commentsInserted,
    duplicates,
    dropped,
    ...stored,
    stopped,
    counts: await sourceCounts(),
    examples
  };
}

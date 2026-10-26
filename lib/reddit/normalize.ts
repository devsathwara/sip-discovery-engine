export type NormalizedItem = {
  resultType: 'link' | 'comment';
  redditId: string;
  fullname: string | null;
  title: string;
  body: string;
  subreddit: string;
  author: string | null;
  score: number | null;
  upvoteRatio: number | null;
  numComments: number | null;
  createdAt: string | null;
  permalink: string;
  url: string | null;
  matchedQuery: string;
  postRedditId: string | null;
  parentRedditId: null;
  depth: null;
  removed: boolean;
  origin: 'reddit' | 'fixture';
};

export type DroppedItem = { drop: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRemovedText(value: string | null): boolean {
  if (!value) return false;
  return /^\[(deleted|removed)\]$/i.test(value.trim());
}

export function postIdFromPermalink(permalink: string): string | null {
  try {
    const parts = new URL(permalink).pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => part === 'comments');
    return index >= 0 && parts[index + 1] ? parts[index + 1] : null;
  } catch {
    return null;
  }
}

export function isRedditPermalink(permalink: string): boolean {
  try {
    const host = new URL(permalink).hostname.replace(/^www\./, '');
    return host === 'reddit.com' || host === 'old.reddit.com';
  } catch {
    return false;
  }
}

export function dedupeKey(item: { fullname?: string | null; resultType: string; redditId: string }): string {
  return item.fullname || `${item.resultType}:${item.redditId}`;
}

export function dedupeItems<T extends { fullname?: string | null; resultType: string; redditId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

export function relevanceScore(text: string, needles: string[]): number {
  const hay = text.toLowerCase();
  const tokens = [...new Set(needles.flatMap((needle) => needle.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2)))];
  if (!tokens.length) return 0;
  return tokens.filter((token) => hay.includes(token)).length / tokens.length;
}

export function normalizeRawItem(raw: unknown, origin: 'reddit' | 'fixture'): NormalizedItem | DroppedItem {
  const row = asRecord(raw);
  if (!row) return { drop: 'not an object' };
  const resultType = row.resultType === 'comment' ? 'comment' : row.resultType === 'link' ? 'link' : null;
  const redditId = asString(row.id);
  const permalink = asString(row.permalink);
  if (!resultType || !redditId || !permalink) return { drop: 'missing id, type, or permalink' };
  if (origin === 'reddit' && !isRedditPermalink(permalink)) return { drop: 'permalink is not a Reddit URL' };
  if (origin === 'fixture' && isRedditPermalink(permalink)) return { drop: 'fixture permalink must not pretend to be Reddit' };

  const title = asString(row.title) ?? '';
  const body = asString(row.text) ?? asString(row.body) ?? '';
  const authorRaw = asString(row.author);
  const removed = isRemovedText(body) || isRemovedText(title);
  const search = asRecord(row.searchQuery);
  const matchedQuery = asString(search?.query) ?? asString(row.matchedQuery) ?? '';
  const createdRaw = asString(row.createdAt);
  const created = createdRaw && !Number.isNaN(Date.parse(createdRaw)) ? new Date(createdRaw).toISOString() : null;

  return {
    resultType,
    redditId,
    fullname: asString(row.fullname),
    title: resultType === 'comment' ? '' : title,
    body,
    subreddit: asString(row.subreddit) ?? 'unknown',
    author: authorRaw && !isRemovedText(authorRaw) ? authorRaw : null,
    score: asNullableNumber(row.score),
    upvoteRatio: asNullableNumber(row.upvoteRatio),
    numComments: asNullableNumber(row.numComments),
    createdAt: created,
    permalink,
    url: asString(row.url),
    matchedQuery,
    postRedditId: resultType === 'comment' ? postIdFromPermalink(permalink) : redditId,
    parentRedditId: null,
    depth: null,
    removed,
    origin
  };
}

export function classifyHttp(status: number): 'rate_limit' | 'blocked' | 'config' | 'outage' {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 402 || status === 403) return status === 403 ? 'blocked' : 'config';
  return 'outage';
}

export function shouldWait(retryAt: Date | null, now: Date): boolean {
  return retryAt != null && retryAt.getTime() > now.getTime();
}

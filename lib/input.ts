import { z } from 'zod';
import { SORTS, TIME_WINDOWS, cleanSubreddit, type TimeWindow, type UiSort } from '@/lib/reddit/plan';

export type SearchRequest = {
  topic: string;
  keywords: string[];
  subreddits: string[];
  timeWindow: TimeWindow;
  sort: UiSort;
  maxPosts: number;
  maxComments: number;
  minScore?: number;
};

function textList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String).join(',') : typeof value === 'string' ? value : '';
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export const searchFields = z.object({
  topic: z.string().trim().min(3).max(200),
  keywords: z.array(z.string().trim().min(1).max(80)).max(8),
  subreddits: z.array(z.string()).min(1, 'Add at least one subreddit').max(5),
  timeWindow: z.enum(TIME_WINDOWS),
  sort: z.enum(SORTS),
  maxPosts: z.coerce.number().int().min(1).max(100),
  maxComments: z.coerce.number().int().min(0).max(100),
  minScore: z.union([z.coerce.number().int().min(0).max(100000), z.nan()]).optional()
});

export function parseSearchForm(source: FormData | Record<string, unknown>): { data: SearchRequest } | { error: string } {
  const read = (key: string) => (source instanceof FormData ? source.get(key) : source[key]);
  const keywords = textList(read('keywords'));
  const rawSubs = textList(read('subreddits'));
  const cleanedSubs = rawSubs.map((name) => cleanSubreddit(name));
  if (rawSubs.length && cleanedSubs.some((name) => !name)) {
    return { error: 'Subreddit names can use letters, numbers, and underscores only.' };
  }
  const minRaw = read('minScore');
  const parsed = searchFields.safeParse({
    topic: read('topic'),
    keywords,
    subreddits: cleanedSubs.filter((name): name is string => Boolean(name)),
    timeWindow: read('timeWindow') || 'month',
    sort: read('sort') || 'relevance',
    maxPosts: read('maxPosts') || 25,
    maxComments: read('maxComments') ?? 25,
    minScore: minRaw === '' || minRaw == null ? undefined : minRaw
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form' };
  }
  const minScore = parsed.data.minScore;
  return {
    data: {
      topic: parsed.data.topic,
      keywords: parsed.data.keywords,
      subreddits: parsed.data.subreddits,
      timeWindow: parsed.data.timeWindow,
      sort: parsed.data.sort,
      maxPosts: parsed.data.maxPosts,
      maxComments: parsed.data.maxComments,
      minScore: typeof minScore === 'number' && Number.isFinite(minScore) ? minScore : undefined
    }
  };
}

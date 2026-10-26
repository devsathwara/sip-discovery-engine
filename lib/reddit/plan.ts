import { MAX_PER_SEARCH, MAX_SEARCHES } from '@/lib/limits';

export const TIME_WINDOWS = ['hour', 'day', 'week', 'month', 'year', 'all'] as const;
export const SORTS = ['relevance', 'newest', 'discussed'] as const;

export type TimeWindow = (typeof TIME_WINDOWS)[number];
export type UiSort = (typeof SORTS)[number];
export type FeedSort = 'relevance' | 'hot' | 'top' | 'new' | 'comments';
export type ResultType = 'link' | 'comment';

export type SearchSpec = {
  query: string;
  subreddit: string;
  sort: FeedSort;
  time: TimeWindow;
  type: ResultType;
  maxResults: number;
};

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;

export function cleanSubreddit(value: string): string | null {
  const name = value.trim().replace(/^\/?r\//i, '').replace(/\/+$/, '');
  return SUBREDDIT.test(name) ? name : null;
}

export function expandQueries(topic: string, keywords: string[], limit = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase();
    if (text.length < 2 || seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(text);
  };
  add(topic);
  for (const keyword of keywords) add(keyword);
  add(`${topic} review`);
  add(`${topic} problem`);
  add(`${topic} alternative`);
  return out;
}

export function toFeedSort(sort: UiSort): FeedSort {
  if (sort === 'newest') return 'new';
  if (sort === 'discussed') return 'comments';
  return 'relevance';
}

export function buildSearchPlan(input: {
  topic: string;
  keywords: string[];
  subreddits: string[];
  timeWindow: TimeWindow;
  sort: UiSort;
  maxPosts: number;
  maxComments: number;
}): { searches: SearchSpec[]; omitted: number } {
  const subreddits = input.subreddits
    .map(cleanSubreddit)
    .filter((name): name is string => Boolean(name));
  const queries = expandQueries(input.topic, input.keywords);
  const types: ResultType[] = input.maxComments > 0 ? ['link', 'comment'] : ['link'];
  const drafts: SearchSpec[] = [];
  for (const type of types) {
    for (const subreddit of subreddits) {
      for (const query of queries) {
        drafts.push({
          query,
          subreddit,
          sort: toFeedSort(input.sort),
          time: input.timeWindow,
          type,
          maxResults: Math.min(MAX_PER_SEARCH, type === 'link' ? input.maxPosts : input.maxComments)
        });
      }
    }
  }
  return {
    searches: drafts.slice(0, MAX_SEARCHES),
    omitted: Math.max(0, drafts.length - MAX_SEARCHES)
  };
}

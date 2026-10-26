import { dedupeItems, normalizeRawItem } from '@/lib/reddit/normalize';
import type { SearchSpec } from '@/lib/reddit/plan';
import type { ProviderSearchResult, RedditDiscoveryProvider } from '@/lib/reddit/provider';

const ROWS = [
  {
    resultType: 'link',
    id: 'fixture-post-1',
    fullname: 'fixture-t3-1',
    subreddit: 'demo',
    author: 'fixture-user',
    title: 'Fixture: sleep band battery dies before morning',
    text: 'The band is comfortable, but the battery dies before morning. I wish it had a longer charge.',
    permalink: 'fixture://post/fixture-post-1',
    createdAt: '2026-04-02T00:00:00.000Z',
    score: null,
    upvoteRatio: null,
    numComments: null,
    searchQuery: { query: 'fixture' }
  },
  {
    resultType: 'link',
    id: 'fixture-post-2',
    fullname: 'fixture-t3-2',
    subreddit: 'demo',
    author: 'fixture-user',
    title: 'Fixture: is the sleep score any good?',
    text: 'Has anyone compared the sleep score with a clinic study? Just asking.',
    permalink: 'fixture://post/fixture-post-2',
    createdAt: '2026-04-03T00:00:00.000Z',
    score: null,
    numComments: null,
    searchQuery: { query: 'fixture' }
  },
  {
    resultType: 'comment',
    id: 'fixture-comment-1',
    fullname: 'fixture-t1-1',
    subreddit: 'demo',
    author: 'fixture-user',
    title: null,
    text: 'I bought the demo band and the strap irritates my wrist. The app is easy.',
    permalink: 'fixture://comment/fixture-comment-1',
    createdAt: '2026-04-04T00:00:00.000Z',
    score: null,
    numComments: null,
    searchQuery: { query: 'fixture' }
  }
];

export const fixtureProvider: RedditDiscoveryProvider = {
  id: 'fixture',
  async search(spec: SearchSpec): Promise<ProviderSearchResult> {
    const rows = ROWS.filter((row) => row.resultType === spec.type).map((row) => ({
      ...row,
      subreddit: spec.subreddit,
      searchQuery: { query: spec.query, subreddit: spec.subreddit, sort: spec.sort, time: spec.time, type: spec.type }
    }));
    const items = [];
    let droppedCount = 0;
    for (const row of rows) {
      const normalized = normalizeRawItem(row, 'fixture');
      if ('drop' in normalized) {
        droppedCount += 1;
        continue;
      }
      items.push(normalized);
    }
    const unique = dedupeItems(items);
    return { items: unique, returnedCount: unique.length, droppedCount };
  }
};

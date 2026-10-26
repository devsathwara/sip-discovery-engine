import { describe, expect, test } from 'vitest';
import { acceptAnalysis, supportedExcerpt } from '@/lib/analysis/schema';
import { analyzeFixture } from '@/lib/analysis/fixture';
import { createRateLimiter, isAuthorized } from '@/lib/auth';
import { toCsv } from '@/lib/export';
import { buildInsights, sentimentCounts, type AnalyzedRecord } from '@/lib/insights';
import { paginate } from '@/lib/pagination';
import { classifyHttp, dedupeItems, normalizeRawItem, postIdFromPermalink, shouldWait } from '@/lib/reddit/normalize';
import { buildSearchPlan, expandQueries } from '@/lib/reddit/plan';
import { renderReport } from '@/lib/report';
import { GET as getJob } from '@/app/api/discovery/jobs/[id]/route';

const post = {
  resultType: 'link',
  id: 'abc',
  fullname: 't3_abc',
  subreddit: 'fitbit',
  author: 'ada',
  title: 'Sleep band',
  text: 'The battery dies before morning.',
  permalink: 'https://www.reddit.com/r/fitbit/comments/abc/sleep_band/',
  createdAt: '2026-04-01T00:00:00.000Z',
  score: null,
  upvoteRatio: null,
  numComments: null,
  searchQuery: { query: 'sleep band' }
};

describe('search plan', () => {
  test('expands a topic and requires a subreddit', () => {
    expect(expandQueries('sleep band', ['strap'])).toContain('sleep band');
    expect(expandQueries('sleep band', ['strap'])).toContain('strap');
    const plan = buildSearchPlan({
      topic: 'sleep band',
      keywords: [],
      subreddits: ['r/fitbit'],
      timeWindow: 'month',
      sort: 'discussed',
      maxPosts: 25,
      maxComments: 10
    });
    expect(plan.searches.length).toBeGreaterThan(0);
    expect(plan.searches.every((search) => search.subreddit === 'fitbit')).toBe(true);
    expect(plan.searches.some((search) => search.sort === 'comments' && search.type === 'link')).toBe(true);
    expect(buildSearchPlan({ ...{
      topic: 'sleep band', keywords: [], subreddits: [], timeWindow: 'all', sort: 'relevance', maxPosts: 10, maxComments: 0
    } }).searches).toHaveLength(0);
  });
});

describe('reddit records', () => {
  test('dedupes by fullname and keeps null scores null', () => {
    const first = normalizeRawItem(post, 'reddit');
    const second = normalizeRawItem({ ...post, text: 'other' }, 'reddit');
    expect('drop' in first).toBe(false);
    if ('drop' in first || 'drop' in second) throw new Error('expected items');
    expect(first.score).toBeNull();
    expect(first.numComments).toBeNull();
    expect(first.parentRedditId).toBeNull();
    expect(dedupeItems([first, second])).toHaveLength(1);
  });

  test('parses a comment permalink and keeps deleted text', () => {
    expect(postIdFromPermalink(post.permalink)).toBe('abc');
    const removed = normalizeRawItem({ ...post, id: 'gone', fullname: 't3_gone', text: '[removed]', author: '[deleted]' }, 'reddit');
    if ('drop' in removed) throw new Error(removed.drop);
    expect(removed.removed).toBe(true);
    expect(removed.author).toBeNull();
  });

  test('drops a fake reddit url and an empty payload', () => {
    expect(normalizeRawItem({ ...post, permalink: 'https://example.com/nope' }, 'reddit')).toEqual({ drop: 'permalink is not a Reddit URL' });
    expect('drop' in normalizeRawItem(null, 'reddit')).toBe(true);
  });

  test('classifies provider failures separately from an empty list', () => {
    expect(classifyHttp(429)).toBe('rate_limit');
    expect(classifyHttp(403)).toBe('blocked');
    expect(classifyHttp(500)).toBe('outage');
    expect(shouldWait(new Date(Date.now() + 10_000), new Date())).toBe(true);
    expect(shouldWait(null, new Date())).toBe(false);
  });
});

describe('analysis and insights', () => {
  test('rejects invented evidence and keeps a verbatim excerpt', () => {
    const source = 'The battery dies before morning and the strap is soft.';
    expect(supportedExcerpt(source, 'The battery dies before morning')).toBe('The battery dies before morning');
    expect(supportedExcerpt(source, 'everyone loves it')).toBeNull();
    const accepted = acceptAnalysis(source, {
      ...analyzeFixture(source),
      evidence: ['everyone loves it', 'The battery dies before morning']
    });
    expect(accepted?.evidence).toEqual(['The battery dies before morning']);
    expect(acceptAnalysis(source, { sentiment: 'ecstatic' })).toBeNull();
  });

  test('counts sentiment only for review-like items and traces pros to links', () => {
    const records: AnalyzedRecord[] = [
      record('1', 'experience', 'negative', ['battery dies before morning'], 'https://www.reddit.com/r/fitbit/comments/abc/x/'),
      record('2', 'joke', 'positive', ['battery dies before morning'], 'https://www.reddit.com/r/fitbit/comments/def/x/')
    ];
    expect(sentimentCounts(records)).toMatchObject({ negative: 1, positive: 0, notUsedAsReviews: 1 });
    const insights = buildInsights(records);
    expect(insights.painPoints[0]?.count).toBe(1);
    expect(insights.painPoints[0]?.evidence[0]?.permalink).toContain('reddit.com');
    const report = renderReport({
      topic: 'sleep band',
      postCount: 1,
      commentCount: 0,
      searchCount: 1,
      emptySearches: 0,
      failedSearches: 0,
      sentiment: insights.sentiment,
      pros: insights.pros,
      cons: insights.cons,
      painPoints: insights.painPoints,
      featureRequests: [],
      competitors: [],
      products: [],
      provider: 'logiover/reddit-search-scraper'
    });
    expect(report).toContain('https://www.reddit.com/r/fitbit/comments/abc/x/');
    expect(report).toContain('not every Reddit discussion');
  });
});

describe('exports, pages, and access', () => {
  test('paginates and escapes csv', () => {
    const page = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(page.items).toEqual([3, 4]);
    expect(page.total).toBe(5);
    expect(toCsv([{ text: 'he said "hi"', score: '' }])).toContain('"he said ""hi"""');
  });

  test('requires the api key only when one is configured, and limits bursts', async () => {
    expect(isAuthorized(null, undefined)).toBe(true);
    expect(isAuthorized(null, 'secret')).toBe(false);
    expect(isAuthorized('Bearer secret', 'secret')).toBe(true);
    const allow = createRateLimiter(2, 1000);
    expect(allow('a', 0)).toBe(true);
    expect(allow('a', 10)).toBe(true);
    expect(allow('a', 20)).toBe(false);
    process.env.DISCOVERY_API_KEY = 'secret';
    const response = await getJob(new Request('http://localhost/api/discovery/jobs/missing'), {
      params: Promise.resolve({ id: 'missing' })
    });
    delete process.env.DISCOVERY_API_KEY;
    expect(response.status).toBe(401);
  });
});

function record(id: string, contentKind: string, sentiment: string, pain: string[], permalink: string): AnalyzedRecord {
  return {
    id,
    kind: 'post',
    permalink,
    text: 'The battery dies before morning.',
    subreddit: 'fitbit',
    createdAt: null,
    analysis: {
      status: 'validated',
      sentiment,
      contentKind,
      pros: [],
      cons: pain,
      painPoints: pain,
      featureRequests: [],
      benefits: [],
      dissatisfaction: pain,
      products: [],
      competitors: [],
      recommendations: [],
      evidence: ['The battery dies before morning']
    }
  };
}

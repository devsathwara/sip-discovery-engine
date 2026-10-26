import { describe, expect, it } from 'vitest';
import { cleanText, isNearDuplicate, normalizeForDedupe } from '../lib/ingest/text';
import { redditPlan, redditRecordId } from '../lib/ingest/reddit';
import { topVideosByViews, youtubeFailure } from '../lib/ingest/youtube';

describe('ingest text', () => {
  it('drops emoji-only and deleted text', () => {
    expect(cleanText('😀😀')).toBeNull();
    expect(cleanText('[deleted]')).toBeNull();
    expect(cleanText('  SIP pause  ')).toBe('SIP pause');
  });

  it('collapses exact and near-duplicate text, and keeps the first copy', () => {
    const first = normalizeForDedupe('I stopped my SIP because the mandate failed!!!');
    const same = normalizeForDedupe('i stopped my sip because the mandate failed');
    const close = normalizeForDedupe('I stopped my SIP because the mandate failed today');
    const other = normalizeForDedupe('good');
    expect(isNearDuplicate(same, first)).toBe(true);
    expect(isNearDuplicate(close, first)).toBe(true);
    expect(isNearDuplicate(other, first)).toBe(false);
  });

  it('names a YouTube quota error and does not treat it as a video skip', () => {
    const body = JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'Quota exceeded' } });
    expect(redditPlan()).toHaveLength(35);
    expect(redditPlan()[0]).toEqual({ query: 'stopped SIP', subreddit: 'IndiaInvestments' });
    expect(redditPlan().some((search) => search.query === 'cancel SIP' && search.subreddit === 'FIRE_Ind')).toBe(true);
    expect(redditRecordId('comment', 'abc123')).toBe('reddit:t1_abc123');
    expect(redditRecordId('comment', 't1_abc123')).toBe('reddit:t1_abc123');
    expect(redditRecordId('post', 't3_post1')).toBe('reddit:t3_post1');
    expect(redditRecordId('post', 'not-a-fullname')).toBeNull();
    expect(topVideosByViews([{ id: 'bbbbbbbbbbb', views: 10 }, { id: 'aaaaaaaaaaa', views: 50 }, { id: 'ccccccccccc', views: 10 }], 2)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb'
    ]);
    expect(youtubeFailure(403, body)).toMatch(/quota exceeded/i);
    expect(youtubeFailure(403, JSON.stringify({ error: { errors: [{ reason: 'commentsDisabled' }] } }))).toMatch(/disabled/i);
  });
});

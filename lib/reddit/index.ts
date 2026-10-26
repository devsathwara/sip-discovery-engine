import { apifyProvider } from '@/lib/reddit/apify';
import { fixtureProvider } from '@/lib/reddit/fixture';
import type { RedditDiscoveryProvider } from '@/lib/reddit/provider';

export function getProvider(): RedditDiscoveryProvider {
  return process.env.REDDIT_PROVIDER === 'fixture' ? fixtureProvider : apifyProvider;
}

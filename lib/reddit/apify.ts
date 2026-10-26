import { ACTOR_API, ACTOR_ID, MAX_PER_SEARCH } from '@/lib/limits';
import { classifyHttp, dedupeItems, normalizeRawItem } from '@/lib/reddit/normalize';
import type { SearchSpec } from '@/lib/reddit/plan';
import { ProviderError, type ProviderSearchResult, type RedditDiscoveryProvider } from '@/lib/reddit/provider';

const ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR_API}/run-sync-get-dataset-items`;

async function runSearch(spec: SearchSpec, token: string): Promise<ProviderSearchResult> {
  const response = await fetch(`${ENDPOINT}?timeout=50`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      searches: [
        {
          query: spec.query,
          subreddit: spec.subreddit,
          sort: spec.sort,
          time: spec.time,
          type: spec.type
        }
      ],
      maxResults: Math.min(MAX_PER_SEARCH, Math.max(1, spec.maxResults))
    }),
    signal: AbortSignal.timeout(55_000)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new ProviderError(`Apify ${response.status}: ${detail || response.statusText}`, classifyHttp(response.status));
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: { message?: string } }).error?.message || 'Apify returned an error object')
        : 'Apify did not return a dataset array';
    throw new ProviderError(message, 'outage');
  }

  const items = [];
  let droppedCount = 0;
  for (const row of payload) {
    const normalized = normalizeRawItem(row, 'reddit');
    if ('drop' in normalized) {
      droppedCount += 1;
      continue;
    }
    items.push(normalized);
  }
  const unique = dedupeItems(items);
  return { items: unique, returnedCount: unique.length, droppedCount: droppedCount + (items.length - unique.length) };
}

export const apifyProvider: RedditDiscoveryProvider = {
  id: ACTOR_ID,
  async search(spec) {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
      throw new ProviderError('APIFY_API_TOKEN is not set. Collection did not run and no sample was invented.', 'config');
    }
    return runSearch(spec, token);
  }
};

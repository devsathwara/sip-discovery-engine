import type { SearchSpec } from '@/lib/reddit/plan';
import type { NormalizedItem } from '@/lib/reddit/normalize';

export type ProviderSearchResult = {
  items: NormalizedItem[];
  returnedCount: number;
  droppedCount: number;
};

export interface RedditDiscoveryProvider {
  id: string;
  search(spec: SearchSpec): Promise<ProviderSearchResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'rate_limit' | 'outage' | 'blocked'
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

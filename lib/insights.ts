import { phraseKey } from '@/lib/json';

export type Evidence = { excerpt: string; permalink: string; kind: 'post' | 'comment' };

export type Insight = { label: string; count: number; evidence: Evidence[] };

export type AnalyzedRecord = {
  id: string;
  kind: 'post' | 'comment';
  permalink: string;
  text: string;
  subreddit: string;
  createdAt: string | null;
  title?: string;
  analysis: {
    status: string;
    sentiment: string;
    contentKind: string;
    pros: string[];
    cons: string[];
    painPoints: string[];
    featureRequests: string[];
    benefits: string[];
    dissatisfaction: string[];
    products: string[];
    competitors: string[];
    recommendations: string[];
    evidence: string[];
  } | null;
};

const REVIEW_KINDS = new Set(['experience', 'other']);

function usable(record: AnalyzedRecord): boolean {
  return record.analysis?.status === 'validated' && REVIEW_KINDS.has(record.analysis.contentKind);
}

export function sentimentCounts(records: AnalyzedRecord[]) {
  const counts = { positive: 0, negative: 0, neutral: 0, mixed: 0, notUsedAsReviews: 0, notAnalyzed: 0 };
  for (const record of records) {
    if (!record.analysis || record.analysis.status === 'pending' || record.analysis.status === 'skipped') {
      counts.notAnalyzed += 1;
      continue;
    }
    if (!usable(record)) {
      counts.notUsedAsReviews += 1;
      continue;
    }
    const sentiment = record.analysis.sentiment;
    if (sentiment === 'positive' || sentiment === 'negative' || sentiment === 'neutral' || sentiment === 'mixed') {
      counts[sentiment] += 1;
    }
  }
  return counts;
}

function collect(records: AnalyzedRecord[], field: keyof NonNullable<AnalyzedRecord['analysis']>): Insight[] {
  const buckets = new Map<string, { label: string; ids: Set<string>; evidence: Evidence[] }>();
  for (const record of records) {
    if (!usable(record) || !record.analysis) continue;
    const values = record.analysis[field];
    if (!Array.isArray(values)) continue;
    const seenInItem = new Set<string>();
    for (const value of values) {
      const key = phraseKey(value);
      if (!key || seenInItem.has(key)) continue;
      seenInItem.add(key);
      const bucket = buckets.get(key) ?? { label: value.trim(), ids: new Set<string>(), evidence: [] };
      bucket.ids.add(record.id);
      if (bucket.evidence.length < 3) {
        const excerpt = record.analysis.evidence[0] || record.text.replace(/\s+/g, ' ').trim().slice(0, 180);
        if (excerpt) bucket.evidence.push({ excerpt, permalink: record.permalink, kind: record.kind });
      }
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()]
    .map((bucket) => ({ label: bucket.label, count: bucket.ids.size, evidence: bucket.evidence }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const THEMES: { label: string; terms: string[] }[] = [
  { label: 'Battery life', terms: ['battery', 'charge', 'charging'] },
  { label: 'Pricing', terms: ['price', 'pricing', 'expensive', 'cost', 'subscription'] },
  { label: 'Customer support', terms: ['support', 'customer service', 'refund'] },
  { label: 'Sleep accuracy', terms: ['sleep', 'rem', 'accuracy'] },
  { label: 'Bugs', terms: ['bug', 'crash', 'broken', 'glitch'] },
  { label: 'Usability', terms: ['usability', 'confusing', 'easy to use', 'interface', 'app'] },
  { label: 'Feature requests', terms: ['wish', 'feature request', 'would be nice', 'please add'] }
];

export type Cluster = { label: string; mentionCount: number; permalinks: string[]; excerpts: string[] };

export function clusterRecords(records: AnalyzedRecord[]): Cluster[] {
  return THEMES.map((theme) => {
    const hits = records.filter((record) => {
      const hay = `${record.title ?? ''} ${record.text}`.toLowerCase();
      return theme.terms.some((term) => hay.includes(term));
    });
    const permalinks = [...new Set(hits.map((record) => record.permalink))].slice(0, 5);
    const excerpts = hits
      .map((record) => record.text.replace(/\s+/g, ' ').trim().slice(0, 180))
      .filter(Boolean)
      .slice(0, 3);
    return { label: theme.label, mentionCount: hits.length, permalinks, excerpts };
  })
    .filter((cluster) => cluster.mentionCount > 0)
    .sort((a, b) => b.mentionCount - a.mentionCount);
}

export function buildInsights(records: AnalyzedRecord[]) {
  return {
    sentiment: sentimentCounts(records),
    pros: collect(records, 'pros'),
    cons: collect(records, 'cons'),
    painPoints: collect(records, 'painPoints'),
    featureRequests: collect(records, 'featureRequests'),
    benefits: collect(records, 'benefits'),
    dissatisfaction: collect(records, 'dissatisfaction'),
    recommendations: collect(records, 'recommendations'),
    products: collect(records, 'products'),
    competitors: collect(records, 'competitors'),
    clusters: clusterRecords(records)
  };
}

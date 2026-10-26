import { parseStringList } from '@/lib/json';
import type { AnalyzedRecord } from '@/lib/insights';

type AnalysisRow = {
  status: string;
  sentiment: string;
  contentKind: string;
  prosJson: string;
  consJson: string;
  painPointsJson: string;
  featureRequestsJson: string;
  benefitsJson: string;
  dissatisfactionJson: string;
  productsJson: string;
  competitorsJson: string;
  recommendationsJson: string;
  evidenceJson: string;
};

function mapAnalysis(row: AnalysisRow | null): AnalyzedRecord['analysis'] {
  if (!row) return null;
  return {
    status: row.status,
    sentiment: row.sentiment,
    contentKind: row.contentKind,
    pros: parseStringList(row.prosJson),
    cons: parseStringList(row.consJson),
    painPoints: parseStringList(row.painPointsJson),
    featureRequests: parseStringList(row.featureRequestsJson),
    benefits: parseStringList(row.benefitsJson),
    dissatisfaction: parseStringList(row.dissatisfactionJson),
    products: parseStringList(row.productsJson),
    competitors: parseStringList(row.competitorsJson),
    recommendations: parseStringList(row.recommendationsJson),
    evidence: parseStringList(row.evidenceJson)
  };
}

export function toRecord(input: {
  id: string;
  kind: 'post' | 'comment';
  permalink: string;
  text: string;
  subreddit: string;
  createdAt: Date | null;
  title?: string;
  analysis: AnalysisRow | null;
}): AnalyzedRecord {
  return {
    id: input.id,
    kind: input.kind,
    permalink: input.permalink,
    text: input.text,
    subreddit: input.subreddit,
    createdAt: input.createdAt ? input.createdAt.toISOString() : null,
    title: input.title,
    analysis: mapAnalysis(input.analysis)
  };
}

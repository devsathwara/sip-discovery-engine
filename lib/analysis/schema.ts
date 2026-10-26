import { z } from 'zod';

export const analysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
  confidence: z.number().min(0).max(1),
  pros: z.array(z.string()).max(8),
  cons: z.array(z.string()).max(8),
  painPoints: z.array(z.string()).max(8),
  featureRequests: z.array(z.string()).max(8),
  benefits: z.array(z.string()).max(8),
  dissatisfaction: z.array(z.string()).max(8),
  products: z.array(z.string()).max(8),
  competitors: z.array(z.string()).max(8),
  recommendations: z.array(z.string()).max(8),
  purchaseIntent: z.enum(['explicit', 'none', 'unknown']),
  contentKind: z.enum(['experience', 'question', 'speculation', 'joke', 'promo', 'other']),
  evidence: z.array(z.string()).max(4)
});

export type AnalysisPayload = z.infer<typeof analysisSchema>;

export function supportedExcerpt(source: string, excerpt: string): string | null {
  const clean = excerpt.replace(/\s+/g, ' ').trim();
  if (!clean || clean.split(' ').length > 25) return null;
  const compact = source.replace(/\s+/g, ' ');
  const index = compact.toLowerCase().indexOf(clean.toLowerCase());
  if (index < 0) return null;
  return compact.slice(index, index + clean.length);
}

export function acceptAnalysis(source: string, raw: unknown): AnalysisPayload | null {
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    evidence: parsed.data.evidence
      .map((excerpt) => supportedExcerpt(source, excerpt))
      .filter((excerpt): excerpt is string => Boolean(excerpt))
      .slice(0, 3)
  };
}

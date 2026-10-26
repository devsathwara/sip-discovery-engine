import { z } from 'zod';
import { CONFIDENCE, INCOME, INFLUENCERS, LEAVES, OUTCOMES, PRIMARY_GATES, TENURES, type PrimaryGate } from '@/lib/classify/taxonomy';

const gateEnum = z.enum(PRIMARY_GATES);
const leafEnum = z.enum([
  ...LEAVES.involuntary,
  ...LEAVES.voluntary,
  ...LEAVES.not_continuation,
  ...LEAVES.irrelevant
]);

export const classificationSchema = z
  .object({
    primary_gate: gateEnum,
    leaf: leafEnum,
    segment: z.object({
      app: z.string().min(1),
      tenure: z.enum(TENURES),
      income_stability: z.enum(INCOME),
      money_source: z.string().min(1),
      influencer: z.enum(INFLUENCERS)
    }),
    expectation_mismatch: z.union([z.boolean(), z.enum(['true', 'false', 'unknown'])]).transform((value) => {
      if (value === true) return 'true';
      if (value === false) return 'false';
      return value;
    }),
    workaround: z.string().min(1),
    outcome: z.enum(OUTCOMES),
    quote: z.string().min(1),
    confidence: z.enum(CONFIDENCE),
    reasoning: z.string().min(1)
  })
  .superRefine((value, ctx) => {
    const allowed = LEAVES[value.primary_gate as PrimaryGate] as readonly string[];
    if (!allowed.includes(value.leaf)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['leaf'], message: 'leaf does not match primary_gate' });
    }
    if (value.quote.trim().split(/\s+/).length > 25) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quote'], message: 'quote is over 25 words' });
    }
  });

export type ClassificationResult = z.infer<typeof classificationSchema>;

export function parseClassification(raw: unknown): ClassificationResult | null {
  const parsed = classificationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function quoteIsVerbatim(text: string, quote: string): boolean {
  const collapse = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const needle = collapse(quote);
  return Boolean(needle) && collapse(text).includes(needle);
}

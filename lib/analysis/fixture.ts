import { acceptAnalysis, type AnalysisPayload } from '@/lib/analysis/schema';

const POSITIVE = ['love', 'great', 'easy', 'comfortable', 'accurate'];
const NEGATIVE = ['hate', 'bug', 'dies', 'irritates', 'expensive', 'broken'];

export function analyzeFixture(text: string): AnalysisPayload {
  const lower = text.toLowerCase();
  const pos = POSITIVE.some((word) => lower.includes(word));
  const neg = NEGATIVE.some((word) => lower.includes(word));
  const question = text.includes('?');
  const sentiment = pos && neg ? 'mixed' : pos ? 'positive' : neg ? 'negative' : 'neutral';
  const contentKind = question && !pos && !neg ? 'question' : 'experience';
  const first = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 18).join(' ');
  const draft = {
    sentiment,
    confidence: contentKind === 'question' ? 0.35 : 0.62,
    pros: lower.includes('comfortable') ? ['comfortable'] : lower.includes('easy') ? ['easy app'] : [],
    cons: lower.includes('battery') || lower.includes('dies') ? ['battery dies before morning'] : lower.includes('irritates') ? ['strap irritates wrist'] : [],
    painPoints: lower.includes('dies') ? ['battery dies before morning'] : lower.includes('irritates') ? ['strap irritates wrist'] : [],
    featureRequests: lower.includes('longer charge') ? ['longer charge'] : [],
    benefits: lower.includes('easy') ? ['easy app'] : [],
    dissatisfaction: lower.includes('dies') ? ['battery dies before morning'] : [],
    products: lower.includes('demo band') ? ['demo band'] : [],
    competitors: [],
    recommendations: [],
    purchaseIntent: lower.includes('i bought') ? 'explicit' : 'unknown',
    contentKind,
    evidence: first ? [first] : []
  };
  const accepted = acceptAnalysis(text, draft);
  if (!accepted) {
    throw new Error('Fixture analyzer produced a payload the schema rejected');
  }
  return accepted;
}

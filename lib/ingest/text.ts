export type IngestSource = 'playstore' | 'youtube' | 'reddit';

export type IngestRow = {
  id: string;
  source: IngestSource;
  date: string;
  text: string;
  score?: number;
};

const NEAR_DUP = 0.82;
const LENGTH_RATIO = 0.55;

export function normalizeForDedupe(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanText(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed === '[deleted]' || trimmed === '[removed]') return null;
  if (!normalizeForDedupe(trimmed)) return null;
  return trimmed;
}

export function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

function words(normalized: string): string[] {
  return normalized ? normalized.split(' ') : [];
}

function trigrams(tokens: string[]): Set<string> {
  const set = new Set<string>();
  if (tokens.length < 3) {
    if (tokens.length) set.add(tokens.join(' '));
    return set;
  }
  for (let i = 0; i <= tokens.length - 3; i += 1) {
    set.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return set;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  let shared = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const item of small) if (large.has(item)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

export function isNearDuplicate(normalized: string, existing: string): boolean {
  if (!normalized || !existing) return false;
  if (normalized === existing) return true;
  const left = words(normalized);
  const right = words(existing);
  const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (ratio < LENGTH_RATIO) return false;
  return jaccard(trigrams(left), trigrams(right)) >= NEAR_DUP;
}

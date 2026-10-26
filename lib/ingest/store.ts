import { prisma } from '@/lib/db';
import { cleanText, isNearDuplicate, normalizeForDedupe, type IngestRow, type IngestSource } from '@/lib/ingest/text';

export type SourceCounts = Record<IngestSource, number>;

export type SavedBatch = {
  inserted: number;
  duplicates: number;
  dropped: number;
  examples: IngestRow[];
  rows: IngestRow[];
};

const SOURCES: IngestSource[] = ['playstore', 'youtube', 'reddit'];

export async function sourceCounts(): Promise<SourceCounts> {
  const grouped = await prisma.ingestRecord.groupBy({
    by: ['source'],
    _count: { _all: true }
  });
  const counts: SourceCounts = { playstore: 0, youtube: 0, reddit: 0 };
  for (const row of grouped) {
    if (row.source === 'playstore' || row.source === 'youtube' || row.source === 'reddit') {
      counts[row.source] = row._count._all;
    }
  }
  return counts;
}

export async function saveRows(rows: IngestRow[]): Promise<SavedBatch> {
  const existing = await prisma.ingestRecord.findMany({ select: { id: true, text: true } });
  const ids = new Set(existing.map((row) => row.id));
  const normalized = existing.map((row) => normalizeForDedupe(row.text)).filter(Boolean);
  const accepted: IngestRow[] = [];
  let duplicates = 0;
  let dropped = 0;

  for (const row of rows) {
    const text = cleanText(row.text);
    if (!text || !row.date) {
      dropped += 1;
      continue;
    }
    if (ids.has(row.id)) {
      duplicates += 1;
      continue;
    }
    const key = normalizeForDedupe(text);
    if (normalized.some((prior) => isNearDuplicate(key, prior))) {
      duplicates += 1;
      continue;
    }
    const saved: IngestRow = { id: row.id, source: row.source, date: row.date, text, score: row.score };
    accepted.push(saved);
    ids.add(saved.id);
    normalized.push(key);
  }

  if (accepted.length) {
    await prisma.ingestRecord.createMany({
      data: accepted.map((row) => ({
        id: row.id,
        source: row.source,
        date: row.date,
        text: row.text,
        score: row.score ?? null
      }))
    });
  }

  return { inserted: accepted.length, duplicates, dropped, examples: accepted.slice(0, 3), rows: accepted };
}

export function emptyCounts(): SourceCounts {
  return { playstore: 0, youtube: 0, reddit: 0 };
}

export const INGEST_SOURCES = SOURCES;

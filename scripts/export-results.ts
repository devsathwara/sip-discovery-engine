import { writeFileSync } from 'node:fs';
import { prisma } from '../lib/db';
import { quoteIsVerbatim } from '../lib/classify/schema';

const GATE_ORDER = ['irrelevant', 'not_continuation', 'voluntary', 'involuntary'] as const;
const CORRECTIONS = ['reddit:t1_pemmfk5', 'reddit:t1_kzc6ji4', 'reddit:t3_1gq8ici'];

type Stored = {
  primary_gate?: string;
  leaf?: string;
  quote?: string;
  confidence?: string;
};

function collapse(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function words(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function shortText(value: string): string {
  const text = collapse(value);
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

async function main() {
  const records = await prisma.ingestRecord.findMany({
    select: {
      id: true,
      source: true,
      text: true,
      classification: { select: { status: true, resultJson: true } }
    }
  });
  const volumes: Record<string, number> = { playstore: 0, youtube: 0, reddit: 0 };
  for (const row of records) volumes[row.source] = (volumes[row.source] ?? 0) + 1;

  const quality = { classified: 0, preFiltered: 0, nonVerbatimQuotes: 0, lowConfidence: 0, schemaErrors: 0 };
  const gateCounts: Record<string, number> = {};
  const leafRows = new Map<string, Array<{ source: string; text: string; quote: string }>>();
  let voluntary = 0;
  let involuntary = 0;

  for (const row of records) {
    const status = row.classification?.status;
    if (status === 'pre_filtered_generic') quality.preFiltered += 1;
    if (status === 'error') quality.schemaErrors += 1;
    if (status !== 'classified' && status !== 'needs_review') continue;
    quality.classified += 1;
    const stored = JSON.parse(row.classification?.resultJson || '{}') as Stored;
    const gate = stored.primary_gate || 'unknown';
    gateCounts[gate] = (gateCounts[gate] ?? 0) + 1;
    if (stored.confidence === 'low') quality.lowConfidence += 1;
    const quote = stored.quote || '';
    if (!quoteIsVerbatim(row.text, quote)) quality.nonVerbatimQuotes += 1;
    if (gate !== 'voluntary' && gate !== 'involuntary') continue;
    if (gate === 'voluntary') voluntary += 1;
    if (gate === 'involuntary') involuntary += 1;
    const leaf = stored.leaf || 'unknown';
    const bucket = leafRows.get(leaf) ?? [];
    bucket.push({ source: row.source, text: row.text, quote });
    leafRows.set(leaf, bucket);
  }

  const leaves = [...leafRows.entries()]
    .map(([leaf, rows]) => ({ leaf, count: rows.length, rows }))
    .sort((a, b) => b.count - a.count || a.leaf.localeCompare(b.leaf));

  const ranked = leaves.map((leaf, index) => {
    const quotes = index < 8 ? pickQuotes(leaf.rows) : [];
    return { leaf: leaf.leaf, count: leaf.count, quotes };
  });

  const corrections = [];
  for (const id of CORRECTIONS) {
    const row = records.find((item) => item.id === id);
    const stored = JSON.parse(row?.classification?.resultJson || '{}') as Stored;
    corrections.push({
      id,
      source: row?.source ?? 'unknown',
      leaf: stored.leaf ?? 'unknown',
      text: shortText(stored.quote && row && quoteIsVerbatim(row.text, stored.quote) ? stored.quote : row?.text || '')
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    volumes: {
      playstore: volumes.playstore ?? 0,
      youtube: volumes.youtube ?? 0,
      reddit: volumes.reddit ?? 0,
      total: records.length
    },
    gates: GATE_ORDER.map((gate) => ({
      gate,
      count: gateCounts[gate] ?? 0,
      pct: pct(gateCounts[gate] ?? 0, quality.classified)
    })),
    onTopic: {
      total: voluntary + involuntary,
      voluntary,
      involuntary,
      ratio: `${voluntary}:${involuntary}`,
      leaves: ranked
    },
    golden: {
      rows: 25,
      overall: 17,
      gate: 18,
      leaf: 17,
      corrections
    },
    quality
  };

  writeFileSync('data/results.json', `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        total: payload.volumes.total,
        gates: payload.gates,
        onTopic: payload.onTopic.total,
        ratio: payload.onTopic.ratio,
        quality
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

function pickQuotes(rows: Array<{ source: string; text: string; quote: string }>): Array<{ source: string; quote: string }> {
  const usable = rows
    .map((row) => ({ source: row.source, quote: collapse(row.quote), ok: quoteIsVerbatim(row.text, row.quote) }))
    .filter((row) => row.ok && words(row.quote) >= 6 && words(row.quote) <= 25)
    .sort((a, b) => Number(mentionsSip(b.quote)) - Number(mentionsSip(a.quote)) || words(b.quote) - words(a.quote));
  const picked: Array<{ source: string; quote: string }> = [];
  const seen = new Set<string>();
  for (const row of usable) {
    if (picked.length >= 3) break;
    if (seen.has(row.quote)) continue;
    if (picked.some((item) => item.source === row.source) && picked.length < 2) continue;
    picked.push({ source: row.source, quote: row.quote });
    seen.add(row.quote);
  }
  for (const row of usable) {
    if (picked.length >= 3) break;
    if (seen.has(row.quote)) continue;
    picked.push({ source: row.source, quote: row.quote });
    seen.add(row.quote);
  }
  return picked;
}

function mentionsSip(quote: string): boolean {
  return /sip|stop|pause|cancel|return|paisa|invest|fund|mandate|nuksan/i.test(quote);
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Export failed');
  await prisma.$disconnect();
  process.exit(1);
});

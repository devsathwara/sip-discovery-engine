import { mkdirSync, writeFileSync } from 'node:fs';
import { prisma } from '../lib/db';
import { isHindiOrHinglish, isPrefilteredGeneric } from '../lib/classify/prefilter';
import { classifyItem } from '../lib/classify/run';
import { hasContinuationSignal } from '../lib/classify/signals';

const SEED = 20261026;

type Row = { id: string; source: string; date: string; text: string };

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(rows: T[], seed: number): T[] {
  const copy = [...rows];
  const rand = mulberry32(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rand() * (index + 1));
    const item = copy[index];
    copy[index] = copy[swap];
    copy[swap] = item;
  }
  return copy;
}

function looksHindi(text: string): boolean {
  return isHindiOrHinglish(text) || /band ho|nahi aya|nahi aaya|nahi badh|chhod diya|nuksan|peise|mene |maine |gaya hai|न|प|सिप/i.test(text);
}

function take(rows: Row[], count: number, seed: number, hindiFirst: boolean): Row[] {
  const ordered = shuffle(rows, seed);
  const ranked = hindiFirst ? [...ordered.filter((row) => looksHindi(row.text)), ...ordered.filter((row) => !looksHindi(row.text))] : ordered;
  return ranked.slice(0, count);
}

function bySource(rows: Row[], source: string, min: number, max: number): Row[] {
  return rows.filter((row) => row.source === source && row.text.length >= min && row.text.length <= max);
}

async function main() {
  const records = await prisma.ingestRecord.findMany({ select: { id: true, source: true, date: true, text: true } });
  const eligible = records.filter((row) => !isPrefilteredGeneric(row.text));
  const signal = eligible.filter((row) => hasContinuationSignal(row.text));
  const quiet = eligible.filter((row) => !hasContinuationSignal(row.text));
  const signalPools = [
    take(bySource(signal, 'playstore', 40, 900), 6, SEED + 1, true),
    take(bySource(signal, 'youtube', 20, 500), 14, SEED + 2, true),
    take(bySource(signal, 'reddit', 40, 700), 12, SEED + 3, false)
  ];
  const signalWant = [3, 7, 6];
  const quietPools = (['playstore', 'youtube', 'reddit'] as const).map((source, index) =>
    take(bySource(quiet, source, 40, 500), 8, SEED + 10 + index, false)
  );
  const saved = new Map<string, { primary_gate: string; leaf: string }>();
  const used = new Set<string>();

  async function accept(row: Row) {
    const call = await classifyItem(row);
    if (!call.result) return false;
    saved.set(row.id, { primary_gate: call.result.primary_gate, leaf: call.result.leaf });
    await prisma.sipClassification.upsert({
      where: { recordId: row.id },
      create: {
        recordId: row.id,
        status: call.result.confidence === 'low' ? 'needs_review' : 'classified',
        resultJson: JSON.stringify(call.result),
        model: call.model,
        promptTokens: call.usage.promptTokens,
        cachedTokens: call.usage.cachedTokens,
        completionTokens: call.usage.completionTokens
      },
      update: {
        status: call.result.confidence === 'low' ? 'needs_review' : 'classified',
        resultJson: JSON.stringify(call.result),
        model: call.model,
        promptTokens: call.usage.promptTokens,
        cachedTokens: call.usage.cachedTokens,
        completionTokens: call.usage.completionTokens
      }
    });
    used.add(row.id);
    return true;
  }

  async function fill(pool: Row[], count: number): Promise<Row[]> {
    const chosen: Row[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, pool.length) }, async () => {
      while (chosen.length < count && cursor < pool.length) {
        const row = pool[cursor];
        cursor += 1;
        if (used.has(row.id)) continue;
        if (await accept(row)) chosen.push(row);
      }
    });
    await Promise.all(workers);
    if (chosen.length < count) throw new Error(`Only kept ${chosen.length} of ${count}`);
    return chosen.slice(0, count);
  }

  const signalPicked = (await Promise.all(signalPools.map((pool, index) => fill(pool, signalWant[index])))).flat();
  const quietPick = (await Promise.all(quietPools.map((pool) => fill(pool, 3)))).flat();
  const rows = [...signalPicked, ...quietPick];
  if (rows.length !== 25) throw new Error(`Expected 25 rows, got ${rows.length}`);
  if (rows.filter((row) => looksHindi(row.text)).length < 6) throw new Error('Hindi/Hinglish quota was not met');

  const labels = rows.map((row) => {
    const label = saved.get(row.id);
    if (!label) throw new Error(`Missing hidden label for ${row.id}`);
    return { id: row.id, primary_gate: label.primary_gate, leaf: label.leaf };
  });
  mkdirSync('data', { recursive: true });
  writeFileSync(
    'data/golden-engine-labels.json',
    JSON.stringify({ savedAt: '2026-10-25', note: 'Hidden until hand labels are submitted.', rows: labels }, null, 2)
  );
  const esc = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = ['id,source,text,my_primary_gate,my_leaf'];
  for (const row of rows) csv.push([esc(row.id), esc(row.source), esc(row.text), '', ''].join(','));
  writeFileSync('data/golden-set-to-label.csv', `${csv.join('\n')}\n`);
  const counts = rows.reduce<Record<string, number>>((sum, row) => {
    sum[row.source] = (sum[row.source] ?? 0) + 1;
    return sum;
  }, {});
  process.stdout.write(
    `${JSON.stringify({
      rows: rows.length,
      signal: signalPicked.length,
      quiet: quietPick.length,
      sources: counts,
      hindi: rows.filter((row) => looksHindi(row.text)).length
    })}\n`
  );
  writeFileSync('/tmp/golden-blind.json', JSON.stringify(rows.map((row) => ({ id: row.id, source: row.source, text: row.text }))));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Golden set failed'}\n`);
  process.exitCode = 1;
});

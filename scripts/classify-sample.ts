import { prisma } from '../lib/db';
import { isHindiOrHinglish, isPrefilteredGeneric } from '../lib/classify/prefilter';
import { classifyItem, costUsd, type TokenUsage } from '../lib/classify/run';
import { quoteIsVerbatim, type ClassificationResult } from '../lib/classify/schema';
import { stratifiedSample, type SampleRow } from '../lib/classify/sample';

const SAMPLE_SIZE = 100;
const SEED = 20261025;

function add(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    completionTokens: left.completionTokens + right.completionTokens
  };
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function main() {
  const records = await prisma.ingestRecord.findMany({
    select: { id: true, source: true, date: true, text: true, classification: { select: { status: true } } }
  });
  const newFlags = records.filter((row) => isPrefilteredGeneric(row.text) && !row.classification);
  for (let offset = 0; offset < newFlags.length; offset += 200) {
    await prisma.sipClassification.createMany({
      data: newFlags.slice(offset, offset + 200).map((row) => ({ recordId: row.id, status: 'pre_filtered_generic' }))
    });
  }

  const filteredCounts: Record<string, number> = {};
  for (const row of records) {
    if (isPrefilteredGeneric(row.text)) filteredCounts[row.source] = (filteredCounts[row.source] ?? 0) + 1;
  }

  const already = await prisma.sipClassification.count({ where: { status: { in: ['classified', 'needs_review'] } } });
  const eligible = records.filter((row) => !isPrefilteredGeneric(row.text) && !row.classification);
  const need = Math.max(0, SAMPLE_SIZE - already);
  let sample = stratifiedSample(eligible, need, SEED);
  if (need > 0 && sample.length && !sample.some((row) => isHindiOrHinglish(row.text))) {
    const hindi = eligible.find((row) => isHindiOrHinglish(row.text) && !sample.some((picked) => picked.id === row.id));
    if (hindi) sample = [hindi, ...sample.slice(1)];
  }

  let done = 0;
  await mapPool(sample, 4, async (row) => {
    const call = await classifyItem(row);
    const status = call.result ? (call.result.confidence === 'low' ? 'needs_review' : 'classified') : 'error';
    await prisma.sipClassification.create({
      data: {
        recordId: row.id,
        status,
        resultJson: call.result ? JSON.stringify(call.result) : null,
        model: call.model,
        promptTokens: call.usage.promptTokens,
        cachedTokens: call.usage.cachedTokens,
        completionTokens: call.usage.completionTokens
      }
    });
    done += 1;
    if (!call.result) process.stderr.write(`classify error ${row.id}: ${call.error}\n`);
    if (done % 10 === 0 || done === sample.length) process.stderr.write(`classified ${done}/${sample.length}\n`);
  });

  const classified = await prisma.sipClassification.findMany({
    where: { status: { in: ['classified', 'needs_review', 'error'] } },
    include: { record: { select: { source: true, text: true } } }
  });
  const usage = classified.reduce<TokenUsage>(
    (sum, row) => add(sum, { promptTokens: row.promptTokens, cachedTokens: row.cachedTokens, completionTokens: row.completionTokens }),
    { promptTokens: 0, cachedTokens: 0, completionTokens: 0 }
  );
  const model = classified.find((row) => row.model)?.model || process.env.LLM_MODEL || 'grok-4.20-0309-non-reasoning';
  const cost = costUsd(usage, model);
  const gates: Record<string, number> = {};
  const leaves: Record<string, number> = {};
  let low = 0;
  let irrelevant = 0;
  let quoteMiss = 0;
  let errors = 0;
  const parsed: { text: string; leaf: string; quote: string; hindi: boolean }[] = [];
  for (const row of classified) {
    if (!row.resultJson) {
      errors += 1;
      continue;
    }
    const result = JSON.parse(row.resultJson) as ClassificationResult;
    gates[result.primary_gate] = (gates[result.primary_gate] ?? 0) + 1;
    leaves[result.leaf] = (leaves[result.leaf] ?? 0) + 1;
    if (result.confidence === 'low') low += 1;
    if (result.primary_gate === 'irrelevant' || result.leaf === 'irrelevant') irrelevant += 1;
    if (!quoteIsVerbatim(row.record.text, result.quote)) quoteMiss += 1;
    parsed.push({ text: row.record.text, leaf: result.leaf, quote: result.quote, hindi: isHindiOrHinglish(row.record.text) });
  }
  const hindi = parsed.find((row) => row.hindi);
  const examples = [...(hindi ? [hindi] : []), ...parsed.filter((row) => row !== hindi)].slice(0, 5).map((row) => ({
    leaf: row.leaf,
    quote: row.quote,
    text: row.text.length > 420 ? `${row.text.slice(0, 420)}…` : row.text
  }));
  const eligibleBySource: Record<string, number> = {};
  for (const row of records) {
    if (!isPrefilteredGeneric(row.text)) eligibleBySource[row.source] = (eligibleBySource[row.source] ?? 0) + 1;
  }
  const eligibleTotal = Object.values(eligibleBySource).reduce((sum, count) => sum + count, 0);
  const sampleBySource: Record<string, number> = {};
  for (const row of sample) sampleBySource[row.source] = (sampleBySource[row.source] ?? 0) + 1;

  process.stdout.write(
    `${JSON.stringify(
      {
        prefiltered: filteredCounts,
        eligible: eligibleBySource,
        sampleThisRun: sampleBySource,
        classified: classified.length,
        errors,
        tokens: usage,
        model,
        costUsd: cost,
        fullRunEstimateUsd: cost === null ? null : Number(((cost / Math.max(1, classified.length - errors)) * eligibleTotal).toFixed(2)),
        primary_gate: gates,
        leaf: leaves,
        confidenceLow: low,
        irrelevant,
        quoteNotVerbatim: quoteMiss,
        examples
      },
      null,
      2
    )}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Classification sample failed'}\n`);
  process.exitCode = 1;
});

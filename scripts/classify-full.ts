import { writeFileSync } from 'node:fs';
import { prisma } from '../lib/db';
import { isPrefilteredGeneric } from '../lib/classify/prefilter';
import { classifyItem, costUsd, type TokenUsage } from '../lib/classify/run';
import { quoteIsVerbatim, type ClassificationResult } from '../lib/classify/schema';

const CONCURRENCY = 4;
const PROGRESS_PATH = 'data/classify-full-progress.json';

function add(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    completionTokens: left.completionTokens + right.completionTokens
  };
}

let writeTail: Promise<unknown> = Promise.resolve();

function writeSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeTail.then(fn, fn);
  writeTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
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
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 8000');
  const records = await prisma.ingestRecord.findMany({
    select: { id: true, source: true, date: true, text: true, classification: { select: { status: true } } }
  });
  const newFlags = records.filter((row) => isPrefilteredGeneric(row.text) && !row.classification);
  for (let offset = 0; offset < newFlags.length; offset += 200) {
    await prisma.sipClassification.createMany({
      data: newFlags.slice(offset, offset + 200).map((row) => ({ recordId: row.id, status: 'pre_filtered_generic' }))
    });
  }

  const queue = records.filter((row) => {
    if (isPrefilteredGeneric(row.text)) return false;
    const status = row.classification?.status;
    return !status || status === 'error';
  });
  const skipped = records.filter((row) => row.classification?.status === 'classified' || row.classification?.status === 'needs_review').length;
  process.stderr.write(`queue ${queue.length} skipped ${skipped} new_prefilter ${newFlags.length}\n`);

  const usage: TokenUsage = { promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
  let done = 0;
  let errors = 0;
  let needsReview = 0;
  const started = Date.now();

  function snapshot() {
    writeFileSync(
      PROGRESS_PATH,
      JSON.stringify({ done, total: queue.length, errors, needsReview, updatedAt: new Date().toISOString() })
    );
  }
  snapshot();

  await mapPool(queue, CONCURRENCY, async (row) => {
    const call = await classifyItem(row);
    const status = call.result ? (call.result.confidence === 'low' ? 'needs_review' : 'classified') : 'error';
    await writeSerialized(() =>
      prisma.sipClassification.upsert({
        where: { recordId: row.id },
        create: {
          recordId: row.id,
          status,
          resultJson: call.result ? JSON.stringify(call.result) : null,
          model: call.model,
          promptTokens: call.usage.promptTokens,
          cachedTokens: call.usage.cachedTokens,
          completionTokens: call.usage.completionTokens
        },
        update: {
          status,
          resultJson: call.result ? JSON.stringify(call.result) : null,
          model: call.model,
          promptTokens: call.usage.promptTokens,
          cachedTokens: call.usage.cachedTokens,
          completionTokens: call.usage.completionTokens
        }
      })
    );
    usage.promptTokens += call.usage.promptTokens;
    usage.cachedTokens += call.usage.cachedTokens;
    usage.completionTokens += call.usage.completionTokens;
    done += 1;
    if (status === 'error') {
      errors += 1;
      process.stderr.write(`classify error ${row.id}: ${call.error}\n`);
    }
    if (status === 'needs_review') needsReview += 1;
    if (done % 25 === 0 || done === queue.length) {
      const elapsed = (Date.now() - started) / 1000;
      process.stderr.write(`classified ${done}/${queue.length} errors ${errors} elapsed ${Math.round(elapsed)}s\n`);
      snapshot();
    }
  });

  const classified = await prisma.sipClassification.findMany({
    where: { status: { in: ['classified', 'needs_review', 'error'] } },
    include: { record: { select: { source: true, text: true } } }
  });
  const gates: Record<string, number> = {};
  const leaves: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let low = 0;
  let irrelevant = 0;
  let quoteMiss = 0;
  let corpusErrors = 0;
  for (const row of classified) {
    bySource[row.record.source] = (bySource[row.record.source] ?? 0) + 1;
    if (!row.resultJson) {
      corpusErrors += 1;
      continue;
    }
    const result = JSON.parse(row.resultJson) as ClassificationResult;
    gates[result.primary_gate] = (gates[result.primary_gate] ?? 0) + 1;
    leaves[result.leaf] = (leaves[result.leaf] ?? 0) + 1;
    if (result.confidence === 'low') low += 1;
    if (result.primary_gate === 'irrelevant') irrelevant += 1;
    if (!quoteIsVerbatim(row.record.text, result.quote)) quoteMiss += 1;
  }
  const model = classified.find((row) => row.model)?.model || process.env.LLM_MODEL || 'grok-4.20-0309-non-reasoning';
  snapshot();
  process.stdout.write(
    `${JSON.stringify(
      {
        done: true,
        thisRun: { attempted: queue.length, errors, needsReview, skippedAlreadyLabeled: skipped, tokens: usage, costUsd: costUsd(usage, model), seconds: Math.round((Date.now() - started) / 1000) },
        corpus: { labeled: classified.length - corpusErrors, errors: corpusErrors, bySource, primary_gate: gates, leaf: leaves, confidenceLow: low, irrelevant, quoteNotVerbatim: quoteMiss },
        model
      },
      null,
      2
    )}\n`
  );
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Full classification failed'}\n`);
  await prisma.$disconnect();
  process.exitCode = 1;
});

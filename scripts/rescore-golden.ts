import { readFileSync, writeFileSync } from 'node:fs';
import { prisma } from '../lib/db';
import { classifyItem, costUsd, type TokenUsage } from '../lib/classify/run';

const HAND: Array<[string, string]> = [
  ['irrelevant', 'irrelevant'],
  ['irrelevant', 'irrelevant'],
  ['irrelevant', 'irrelevant'],
  ['not_continuation', 'not_continuation'],
  ['irrelevant', 'irrelevant'],
  ['voluntary', 'other_voluntary'],
  ['voluntary', 'other_voluntary'],
  ['not_continuation', 'not_continuation'],
  ['not_continuation', 'not_continuation'],
  ['not_continuation', 'not_continuation'],
  ['voluntary', 'reallocated_goal_changed'],
  ['voluntary', 'reallocated_goal_changed'],
  ['voluntary', 'other_voluntary'],
  ['not_continuation', 'not_continuation'],
  ['voluntary', 'money_tight'],
  ['not_continuation', 'not_continuation'],
  ['irrelevant', 'irrelevant'],
  ['irrelevant', 'irrelevant'],
  ['irrelevant', 'irrelevant'],
  ['irrelevant', 'irrelevant'],
  ['not_continuation', 'not_continuation'],
  ['irrelevant', 'irrelevant'],
  ['voluntary', 'reallocated_goal_changed'],
  ['irrelevant', 'irrelevant'],
  ['irrelevant', 'irrelevant']
];

function add(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    completionTokens: left.completionTokens + right.completionTokens
  };
}

async function main() {
  const prior = JSON.parse(readFileSync('data/golden-engine-labels.json', 'utf8')) as {
    rows: Array<{ id: string }>;
  };
  const ids = prior.rows.map((row) => row.id);
  if (ids.length !== 25 || HAND.length !== 25) throw new Error('Golden set is not 25 rows');
  if (!ids[0]?.startsWith('playstore:b3641ebb')) throw new Error('Golden row order changed');
  const records = await prisma.ingestRecord.findMany({ where: { id: { in: ids } } });
  const byId = new Map(records.map((row) => [row.id, row]));
  const calls: Awaited<ReturnType<typeof classifyItem>>[] = new Array(ids.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= ids.length) return;
      const row = byId.get(ids[index]);
      if (!row) throw new Error(`Missing ingest row ${ids[index]}`);
      const call = await classifyItem({ source: row.source, date: row.date, text: row.text });
      if (!call.result) throw new Error(`${ids[index]}: ${call.error ?? 'no result'}`);
      calls[index] = call;
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
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));

  const rows = ids.map((id, index) => ({
    id,
    primary_gate: calls[index].result!.primary_gate,
    leaf: calls[index].result!.leaf
  }));
  writeFileSync(
    'data/golden-engine-labels.json',
    JSON.stringify({ savedAt: '2026-10-25', note: 'Rescored after own-SIP and aftermath gate refinement.', rows }, null, 2) + '\n'
  );

  let both = 0;
  let gate = 0;
  let leaf = 0;
  const disagreements = [];
  for (let index = 0; index < ids.length; index += 1) {
    const mine = HAND[index];
    const engine = rows[index];
    const gateMatch = mine[0] === engine.primary_gate;
    const leafMatch = mine[1] === engine.leaf;
    if (gateMatch) gate += 1;
    if (leafMatch) leaf += 1;
    if (gateMatch && leafMatch) both += 1;
    else {
      const text = byId.get(ids[index])?.text ?? '';
      disagreements.push({
        row: index + 1,
        id: ids[index],
        text: text.slice(0, 100),
        mine: `${mine[0]} / ${mine[1]}`,
        engine: `${engine.primary_gate} / ${engine.leaf}`,
        reasoning: calls[index].result!.reasoning
      });
    }
  }
  const usage = calls.reduce((sum, call) => add(sum, call.usage), {
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0
  });
  console.log(
    JSON.stringify(
      {
        both,
        gate,
        leaf,
        model: calls[0].model,
        usage,
        costUsd: costUsd(usage, calls[0].model),
        disagreements
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});

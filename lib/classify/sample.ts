export type SampleRow = { id: string; source: string; text: string };

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
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

export function stratifiedSample<T extends SampleRow>(rows: T[], count: number, seed: number): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const list = groups.get(row.source) ?? [];
    list.push(row);
    groups.set(row.source, list);
  }
  const sources = [...groups.keys()].sort();
  if (!sources.length || count <= 0) return [];
  const total = rows.length;
  const quotas = new Map<string, number>();
  let assigned = 0;
  for (const source of sources) {
    const quota = Math.min(groups.get(source)!.length, Math.round((count * groups.get(source)!.length) / total));
    quotas.set(source, quota);
    assigned += quota;
  }
  while (assigned > count) {
    const source = sources.reduce((left, right) => ((quotas.get(left) ?? 0) >= (quotas.get(right) ?? 0) ? left : right));
    if ((quotas.get(source) ?? 0) === 0) break;
    quotas.set(source, (quotas.get(source) ?? 0) - 1);
    assigned -= 1;
  }
  while (assigned < count) {
    const source = sources
      .filter((name) => (quotas.get(name) ?? 0) < (groups.get(name)?.length ?? 0))
      .sort((left, right) => (groups.get(right)!.length - quotas.get(right)!) - (groups.get(left)!.length - quotas.get(left)!))[0];
    if (!source) break;
    quotas.set(source, (quotas.get(source) ?? 0) + 1);
    assigned += 1;
  }
  const picked: T[] = [];
  sources.forEach((source, index) => {
    picked.push(...shuffle(groups.get(source)!, seed + index + 1).slice(0, quotas.get(source) ?? 0));
  });
  return picked;
}

import { sourceCounts } from '../lib/ingest/store';
import { pullPlayStore } from '../lib/ingest/playstore';
import { pullReddit } from '../lib/ingest/reddit';
import { pullYouTube } from '../lib/ingest/youtube';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function print(result: unknown) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const command = process.argv[2] || 'counts';
  if (command === 'counts') {
    print(await sourceCounts());
    return;
  }
  if (command === 'playstore') {
    const limit = Number(flag('--limit') || 100);
    print(await pullPlayStore(limit));
    return;
  }
  if (command === 'youtube') {
    const explicit = flag('--videos');
    const maxCalls = Number(flag('--max-calls') || 80);
    print(await pullYouTube(explicit ? [explicit] : [], maxCalls));
    return;
  }
  if (command === 'reddit') {
    print(await pullReddit({ full: process.argv.includes('--full') }));
    return;
  }
  throw new Error(`Unknown ingest source "${command}". Use counts, playstore, youtube, or reddit.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Ingest failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

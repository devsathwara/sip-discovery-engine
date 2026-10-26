import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { pullPlayStore } from '@/lib/ingest/playstore';
import { pullReddit } from '@/lib/ingest/reddit';
import { pullYouTube } from '@/lib/ingest/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ source: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { source } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (source === 'playstore') {
    const limit = Number(body.limit || 100);
    if (!Number.isFinite(limit) || limit < 1) {
      return NextResponse.json({ error: 'limit must be a positive number' }, { status: 400 });
    }
    const result = await pullPlayStore(Math.min(limit, 200));
    const status = result.stopped && result.fetched === 0 ? 502 : 200;
    return NextResponse.json(result, { status });
  }
  if (source === 'youtube') {
    const rawIds = body.videoIds;
    const videoIds = Array.isArray(rawIds)
      ? rawIds.map(String)
      : typeof rawIds === 'string' && rawIds.trim()
        ? [rawIds]
        : [];
    const maxCalls = Number(body.maxCalls || 40);
    if (!Number.isFinite(maxCalls) || maxCalls < 1) {
      return NextResponse.json({ error: 'maxCalls must be a positive number' }, { status: 400 });
    }
    const result = await pullYouTube(videoIds, maxCalls);
    const status = result.stopped && result.fetched === 0 ? 400 : 200;
    return NextResponse.json(result, { status });
  }
  if (source === 'reddit') {
    const result = await pullReddit({ full: body.full === true });
    const status = result.stopped && result.fetched === 0 ? 502 : 200;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ error: `Unknown ingest source "${source}". Use playstore, youtube, or reddit.` }, { status: 404 });
}

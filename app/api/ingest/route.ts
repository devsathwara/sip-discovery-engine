import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { sourceCounts } from '@/lib/ingest/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const counts = await sourceCounts();
  return NextResponse.json({ counts, total: counts.playstore + counts.youtube + counts.reddit });
}

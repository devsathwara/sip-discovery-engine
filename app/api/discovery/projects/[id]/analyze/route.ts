import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { advanceProject } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  const result = await advanceProject(id);
  return NextResponse.json(result);
}

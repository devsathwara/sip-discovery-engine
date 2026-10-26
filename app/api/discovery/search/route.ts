import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { parseSearchForm } from '@/lib/input';
import { createProject } from '@/lib/pipeline';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Expected JSON' }, { status: 400 });
  }
  const parsed = parseSearchForm(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const project = await createProject(parsed.data);
  const collect = project.jobs.find((job) => job.type === 'collect');
  return NextResponse.json({ projectId: project.id, jobId: collect?.id ?? null });
}

import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { projectView } from '@/lib/pipeline';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  const view = await projectView(id);
  if (!view) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json({
    posts: view.project.posts.length,
    comments: view.project.comments.length,
    ...view.insights,
    note: 'Counts are items inside this collected sample, not the Reddit population.'
  });
}

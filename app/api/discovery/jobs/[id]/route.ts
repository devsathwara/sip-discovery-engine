import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  const job = await prisma.collectionJob.findUnique({
    where: { id },
    include: { project: { include: { jobs: true, queries: { orderBy: { position: 'asc' } }, posts: true, comments: true } } }
  });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    label: job.label,
    error: job.error,
    projectId: job.projectId,
    posts: job.project.posts.length,
    comments: job.project.comments.length,
    searches: job.project.queries.map((query) => ({
      query: query.text,
      subreddit: query.subreddit,
      type: query.resultType,
      status: query.status,
      returnedCount: query.returnedCount,
      error: query.error
    })),
    jobs: job.project.jobs.map((item) => ({ id: item.id, type: item.type, status: item.status, label: item.label, error: item.error }))
  });
}

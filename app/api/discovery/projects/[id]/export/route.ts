import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { prisma } from '@/lib/db';
import { toCsv } from '@/lib/export';
import { COLLECTION_LIMITS } from '@/lib/limits';
import { parseStringList } from '@/lib/json';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get('format') || 'json';
  const project = await prisma.researchProject.findUnique({
    where: { id },
    include: {
      queries: true,
      posts: { include: { analysis: true } },
      comments: { include: { analysis: true } },
      clusters: true,
      report: true
    }
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  if (format === 'md') {
    return new NextResponse(project.report?.markdown || 'Report is not ready.', {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="research-sample.md"' }
    });
  }

  const rows = [
    ...project.posts.map((post) => ({
      kind: 'post',
      id: post.redditId,
      subreddit: post.subreddit,
      title: post.title,
      text: post.body,
      permalink: post.permalink,
      createdAt: post.createdAt?.toISOString() ?? '',
      score: post.score ?? '',
      sentiment: post.analysis?.status === 'validated' ? post.analysis.sentiment : '',
      analysisStatus: post.analysis?.status ?? 'not_analyzed',
      origin: post.origin,
      note: post.score == null ? 'score unavailable from source' : ''
    })),
    ...project.comments.map((comment) => ({
      kind: 'comment',
      id: comment.redditId,
      subreddit: comment.subreddit,
      title: '',
      text: comment.body,
      permalink: comment.permalink,
      createdAt: comment.createdAt?.toISOString() ?? '',
      score: comment.score ?? '',
      sentiment: comment.analysis?.status === 'validated' ? comment.analysis.sentiment : '',
      analysisStatus: comment.analysis?.status ?? 'not_analyzed',
      origin: comment.origin,
      note: 'parent reply link unavailable from source'
    }))
  ];

  if (format === 'csv') {
    return new NextResponse(toCsv(rows), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="research-sample.csv"' }
    });
  }

  return NextResponse.json({
    limitations: COLLECTION_LIMITS,
    topic: project.topic,
    provider: project.provider,
    searches: project.queries.map((query) => ({
      query: query.text,
      subreddit: query.subreddit,
      type: query.resultType,
      status: query.status,
      returnedCount: query.returnedCount,
      error: query.error
    })),
    posts: project.posts,
    comments: project.comments,
    clusters: project.clusters.map((cluster) => ({
      label: cluster.label,
      mentionCount: cluster.mentionCount,
      permalinks: parseStringList(cluster.permalinksJson),
      excerpts: parseStringList(cluster.excerptsJson)
    })),
    report: project.report?.markdown ?? null,
    rows
  });
}

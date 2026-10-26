import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { prisma } from '@/lib/db';
import { paginate } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') || 1);
  const pageSize = Number(url.searchParams.get('pageSize') || 10);
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const posts = await prisma.redditPost.findMany({
    where: { projectId: id },
    include: { analysis: true },
    orderBy: { relevance: 'desc' }
  });
  const filtered = posts.filter((post) => !q || `${post.title} ${post.body}`.toLowerCase().includes(q));
  const paged = paginate(filtered, page, pageSize);
  return NextResponse.json({
    ...paged,
    items: paged.items.map((post) => ({
      id: post.id,
      redditId: post.redditId,
      title: post.title,
      subreddit: post.subreddit,
      permalink: post.permalink,
      relevance: post.relevance,
      score: post.score,
      numComments: post.numComments,
      createdAt: post.createdAt,
      sentiment: post.analysis?.status === 'validated' ? post.analysis.sentiment : null,
      origin: post.origin
    }))
  });
}

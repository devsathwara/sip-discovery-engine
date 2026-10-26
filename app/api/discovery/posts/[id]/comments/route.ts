import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  const post = await prisma.redditPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  const comments = await prisma.redditComment.findMany({
    where: { projectId: post.projectId, OR: [{ postId: post.id }, { postRedditId: post.redditId }] },
    include: { analysis: true },
    orderBy: { relevance: 'desc' }
  });
  return NextResponse.json({
    thread: 'unavailable',
    threadNote: 'This source returns keyword-matching comments. It does not provide the thread, parent ids, or reply depth.',
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      permalink: comment.permalink,
      parentRedditId: comment.parentRedditId,
      depth: comment.depth,
      score: comment.score,
      createdAt: comment.createdAt,
      sentiment: comment.analysis?.status === 'validated' ? comment.analysis.sentiment : null,
      origin: comment.origin
    }))
  });
}

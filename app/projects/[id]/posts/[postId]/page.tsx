import { notFound } from 'next/navigation';
import { SourceLink } from '@/components/SourceLink';
import { prisma } from '@/lib/db';
import { parseStringList } from '@/lib/json';

export const dynamic = 'force-dynamic';

export default async function PostPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string; postId: string }>;
  searchParams: Promise<{ sentiment?: string }>;
}) {
  const { id, postId } = await params;
  const query = await searchParams;
  const post = await prisma.redditPost.findFirst({
    where: { id: postId, projectId: id },
    include: { analysis: true }
  });
  if (!post) notFound();
  const comments = await prisma.redditComment.findMany({
    where: { projectId: id, OR: [{ postId: post.id }, { postRedditId: post.redditId }] },
    include: { analysis: true },
    orderBy: { relevance: 'desc' }
  });
  const visible = comments.filter((comment) => !query.sentiment || comment.analysis?.sentiment === query.sentiment);

  return (
    <main>
      <p><a href={`/projects/${id}`}>Back to sample</a></p>
      <h1>{post.title || 'Untitled post'}</h1>
      <p className="meta">
        r/{post.subreddit} · {post.createdAt ? post.createdAt.toISOString() : 'Time unavailable'} · score {post.score ?? 'unavailable'} · parent thread not collected
      </p>
      <p>{post.removed ? 'This post was marked deleted or removed.' : post.body || 'No body text was returned.'}</p>
      {post.analysis?.status === 'validated' ? (
        <p>
          <span className={`pill ${post.analysis.contentKind === 'experience' || post.analysis.contentKind === 'other' ? post.analysis.sentiment : ''}`}>
            {post.analysis.contentKind === 'experience' || post.analysis.contentKind === 'other' ? post.analysis.sentiment : post.analysis.contentKind}
          </span>{' '}
          Pros: {parseStringList(post.analysis.prosJson).join(', ') || 'none'} · Cons: {parseStringList(post.analysis.consJson).join(', ') || 'none'}
        </p>
      ) : (
        <p className="meta">Analysis status: {post.analysis?.status || 'not analyzed'}</p>
      )}
      <SourceLink href={post.permalink} origin={post.origin} />
      <section className="panel">
        <h2>Matching comments</h2>
        <p className="banner">These are comment-search hits for the keyword, not the reply tree. Parent, depth, and a complete thread are unavailable from this source.</p>
        <form className="filters" method="get">
          <label>
            Sentiment
            <select name="sentiment" defaultValue={query.sentiment || ''}>
              <option value="">Any</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <button className="quiet" type="submit">Filter</button>
        </form>
        {visible.length === 0 ? <p>No matching comments in this sample.</p> : null}
        {visible.map((comment) => (
          <article className="post" key={comment.id}>
            <p>{comment.removed ? 'Deleted or removed comment.' : comment.body}</p>
            <p className="meta">
              {comment.createdAt ? comment.createdAt.toISOString() : 'Time unavailable'} · score {comment.score ?? 'unavailable'} · parent not provided · depth not provided
            </p>
            <span className={`pill ${comment.analysis?.status === 'validated' && (comment.analysis.contentKind === 'experience' || comment.analysis.contentKind === 'other') ? comment.analysis.sentiment : ''}`}>
              {comment.analysis?.status === 'validated'
                ? comment.analysis.contentKind === 'experience' || comment.analysis.contentKind === 'other'
                  ? comment.analysis.sentiment
                  : comment.analysis.contentKind
                : comment.analysis?.status || 'not analyzed'}
            </span>
            <p className="meta">Pros: {parseStringList(comment.analysis?.prosJson).join(', ') || 'none'} · Cons: {parseStringList(comment.analysis?.consJson).join(', ') || 'none'}</p>
            <SourceLink href={comment.permalink} origin={comment.origin} />
          </article>
        ))}
      </section>
    </main>
  );
}

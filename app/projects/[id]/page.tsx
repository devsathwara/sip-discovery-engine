import { notFound } from 'next/navigation';
import { deleteResearch, refreshReport } from '@/app/actions';
import { JobPoller } from '@/components/JobPoller';
import { SourceLink } from '@/components/SourceLink';
import { parseStringList } from '@/lib/json';
import { paginate } from '@/lib/pagination';
import { projectView } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

function when(value: Date | null) {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Time unavailable';
}

function reviewLabel(analysis: { status: string; sentiment: string; contentKind: string } | null) {
  if (!analysis || analysis.status !== 'validated') return analysis?.status || 'not analyzed';
  if (analysis.contentKind !== 'experience' && analysis.contentKind !== 'other') return analysis.contentKind;
  return analysis.sentiment;
}

export default async function ProjectPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; sentiment?: string; subreddit?: string; page?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const view = await projectView(id);
  if (!view) notFound();
  const { project, insights } = view;
  const collect = project.jobs.find((job) => job.type === 'collect');
  const analyze = project.jobs.find((job) => job.type === 'analyze');
  const active = [collect?.status, analyze?.status].some((status) => status === 'queued' || status === 'running');
  const sentiment = insights.sentiment;
  const totalSentiment = sentiment.positive + sentiment.negative + sentiment.neutral + sentiment.mixed;
  const width = (count: number) => (totalSentiment ? `${(count / totalSentiment) * 100}%` : '0%');
  const q = (query.q || '').toLowerCase();
  const subreddits = [...new Set([...project.posts.map((post) => post.subreddit), ...project.comments.map((comment) => comment.subreddit)])];
  const matchesSentiment = (sentiment: string | undefined) => !query.sentiment || sentiment === query.sentiment;
  const filtered = project.posts.filter((post) => {
    if (q && !`${post.title} ${post.body}`.toLowerCase().includes(q)) return false;
    if (query.subreddit && post.subreddit !== query.subreddit) return false;
    if (!matchesSentiment(post.analysis?.sentiment)) return false;
    return true;
  });
  const comments = project.comments.filter((comment) => {
    if (q && !comment.body.toLowerCase().includes(q)) return false;
    if (query.subreddit && comment.subreddit !== query.subreddit) return false;
    if (!matchesSentiment(comment.analysis?.sentiment)) return false;
    return true;
  });
  const page = paginate(filtered, Number(query.page || 1), 8);

  return (
    <main>
      <h1>{project.topic}</h1>
      <p className="lede">
        {project.provider === 'fixture'
          ? 'These rows are a labeled demo. They were not collected from Reddit.'
          : 'Counts below are this sample only. They are not a share of all Reddit discussion.'}
      </p>
      {project.minScoreRequested != null ? (
        <p className="banner">You asked for a minimum score of {project.minScoreRequested}. This source does not provide scores, so that filter was not applied.</p>
      ) : null}
      <JobPoller projectId={project.id} active={active} />
      {collect?.error ? <p className="error">{collect.error}</p> : null}
      {analyze?.error ? <p className="error">{analyze.error}</p> : null}

      <section className="grid stats">
        <div className="stat"><b>{project.posts.length}</b><span>Unique posts kept</span></div>
        <div className="stat"><b>{project.comments.length}</b><span>Unique matching comments</span></div>
        <div className="stat"><b>{project.queries.length}</b><span>Searches in this run</span></div>
        <div className="stat"><b>{insights.clusters.length}</b><span>Theme matches</span></div>
      </section>

      <section className="panel">
        <h2>Sentiment in analyzed reviews</h2>
        <div className="bar" aria-hidden="true">
          <i className="pos" style={{ width: width(sentiment.positive) }} />
          <i className="neg" style={{ width: width(sentiment.negative) }} />
          <i className="neu" style={{ width: width(sentiment.neutral) }} />
          <i className="mix" style={{ width: width(sentiment.mixed) }} />
        </div>
        <p className="meta">
          Positive {sentiment.positive} · Negative {sentiment.negative} · Neutral {sentiment.neutral} · Mixed {sentiment.mixed}. Questions, jokes, speculation, and ads are kept out of this split ({sentiment.notUsedAsReviews}). Not analyzed: {sentiment.notAnalyzed}.
        </p>
      </section>

      <section className="panel">
        <h2>Searches</h2>
        <table>
          <thead>
            <tr><th>Query</th><th>Subreddit</th><th>Type</th><th>Returned</th><th>Status</th></tr>
          </thead>
          <tbody>
            {project.queries.map((item) => (
              <tr key={item.id}>
                <td>{item.text}</td>
                <td>r/{item.subreddit}</td>
                <td>{item.resultType === 'link' ? 'posts' : 'comment search'}</td>
                <td>{item.returnedCount == null ? '—' : item.returnedCount}</td>
                <td>{item.status}{item.error ? `: ${item.error}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">A dash means that search has not finished. Zero means the source returned no rows. An error means the search did not complete.</p>
      </section>

      <section className="grid cards">
        <Insight title="What people praise" items={insights.pros} />
        <Insight title="What people dislike" items={insights.cons} />
        <Insight title="Pain points" items={insights.painPoints} />
        <Insight title="Feature requests" items={insights.featureRequests} />
        <Insight title="Benefits" items={insights.benefits} />
        <Insight title="Reasons for dissatisfaction" items={insights.dissatisfaction} />
      </section>

      <section className="panel">
        <h2>Named products</h2>
        {insights.products.length + insights.competitors.length < 2 ? (
          <p className="meta">Fewer than two product names were extracted, so this sample is not a comparison.</p>
        ) : (
          <ul>
            {[...insights.products, ...insights.competitors].map((item) => (
              <li key={item.label}>{item.label} — {item.count} items</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Posts</h2>
        <form className="filters" method="get">
          <label>Search<input name="q" defaultValue={query.q || ''} /></label>
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
          <label>
            Subreddit
            <select name="subreddit" defaultValue={query.subreddit || ''}>
              <option value="">Any</option>
              {subreddits.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <button className="quiet" type="submit">Filter</button>
        </form>
        {page.items.map((post) => {
          const matched = project.comments.filter((comment) => comment.postId === post.id || comment.postRedditId === post.redditId).length;
          return (
            <article className="post" key={post.id}>
              <h3><a href={`/projects/${project.id}/posts/${post.id}`}>{post.title || 'Untitled post'}</a></h3>
              <p className="meta">r/{post.subreddit} · {when(post.createdAt)} · relevance {post.relevance.toFixed(2)} · score {post.score ?? 'unavailable'} · Reddit comment count unavailable · matching comments in this sample: {matched}</p>
              <p>{post.body.slice(0, 280) || (post.removed ? 'Removed or deleted on Reddit.' : 'No body text.')}</p>
              <span className={`pill ${post.analysis?.status === 'validated' && reviewLabel(post.analysis) === post.analysis.sentiment ? post.analysis.sentiment : ''}`}>{reviewLabel(post.analysis)}</span>
              <p className="meta">Pros: {parseStringList(post.analysis?.prosJson).join(', ') || 'none extracted'} · Cons: {parseStringList(post.analysis?.consJson).join(', ') || 'none extracted'}</p>
              <SourceLink href={post.permalink} origin={post.origin} />
            </article>
          );
        })}
        <p className="pager">
          <span>{page.total} {page.total === 1 ? 'post' : 'posts'} · page {page.page} of {page.pageCount}</span>
          {page.page > 1 ? <a href={`?page=${page.page - 1}&q=${query.q || ''}&sentiment=${query.sentiment || ''}&subreddit=${query.subreddit || ''}`}>Previous</a> : null}
          {page.page < page.pageCount ? <a href={`?page=${page.page + 1}&q=${query.q || ''}&sentiment=${query.sentiment || ''}&subreddit=${query.subreddit || ''}`}>Next</a> : null}
        </p>
      </section>

      <section className="panel">
        <h2>Matching comments</h2>
        <p className="banner">These are keyword matches from comment search. They are not the reply tree under a post. Parent and depth were not provided.</p>
        {comments.length === 0 ? <p>No matching comments in this sample.</p> : null}
        {comments.map((comment) => (
          <article className="post" key={comment.id}>
            <p>{comment.body.slice(0, 280) || (comment.removed ? 'Removed or deleted on Reddit.' : 'No comment text.')}</p>
            <p className="meta">r/{comment.subreddit} · {when(comment.createdAt)} · score {comment.score ?? 'unavailable'} · parent not provided</p>
            <span className={`pill ${comment.analysis?.status === 'validated' && reviewLabel(comment.analysis) === comment.analysis.sentiment ? comment.analysis.sentiment : ''}`}>{reviewLabel(comment.analysis)}</span>
            <p className="meta">Pros: {parseStringList(comment.analysis?.prosJson).join(', ') || 'none extracted'} · Cons: {parseStringList(comment.analysis?.consJson).join(', ') || 'none extracted'}</p>
            <SourceLink href={comment.permalink} origin={comment.origin} />
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Themes</h2>
        <p className="meta">A post or comment is counted once per theme when its text contains one of that theme’s words. One item can sit in several themes.</p>
        {insights.clusters.length === 0 ? <p>No theme words matched this sample.</p> : null}
        {insights.clusters.map((cluster) => (
          <article key={cluster.label}>
            <h3>{cluster.label} · {cluster.mentionCount}</h3>
            {cluster.excerpts.map((excerpt) => <p className="quote" key={excerpt}>{excerpt}</p>)}
            {cluster.permalinks.map((href) => (
              <p key={href}><SourceLink href={href} origin={project.provider === 'fixture' ? 'fixture' : 'reddit'} /></p>
            ))}
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Report</h2>
        <p>
          <a className="button" href={`/api/discovery/projects/${project.id}/export?format=md`}>Markdown</a>{' '}
          <a className="button quiet" href={`/api/discovery/projects/${project.id}/export?format=csv`}>CSV</a>{' '}
          <a className="button quiet" href={`/api/discovery/projects/${project.id}/export?format=json`}>JSON</a>
        </p>
        <form action={refreshReport.bind(null, project.id)}>
          <button className="quiet" type="submit">Rebuild report from stored evidence</button>
        </form>
        {project.report ? <pre>{project.report.markdown}</pre> : <p className="meta">The report is written when analysis finishes, or when you rebuild it.</p>}
      </section>

      <form action={deleteResearch}>
        <input type="hidden" name="id" value={project.id} />
        <button className="quiet" type="submit">Delete this stored sample</button>
      </form>
    </main>
  );
}

function Insight({ title, items }: { title: string; items: { label: string; count: number; evidence: { excerpt: string; permalink: string }[] }[] }) {
  return (
    <article className="card">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="meta">None in this sample.</p> : null}
      {items.slice(0, 4).map((item) => (
        <div key={item.label}>
          <strong>{item.label}</strong> <span className="meta">{item.count} item{item.count === 1 ? '' : 's'}</span>
          {item.evidence[0] ? <p className="quote">{item.evidence[0].excerpt}</p> : null}
          {item.evidence[0] ? <a href={item.evidence[0].permalink.startsWith('http') ? item.evidence[0].permalink : undefined}>{item.evidence[0].permalink.startsWith('http') ? 'Source' : 'Demo excerpt'}</a> : null}
        </div>
      ))}
    </article>
  );
}

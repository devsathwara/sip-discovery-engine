import { prisma } from '@/lib/db';
import { startResearch } from '@/app/actions';
import { COLLECTION_LIMITS, MAX_SEARCHES, PRICE_NOTE } from '@/lib/limits';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const fixture = process.env.REDDIT_PROVIDER === 'fixture';
  const projects = await prisma.researchProject.findMany({ orderBy: { createdAt: 'desc' }, take: 8 });

  return (
    <main>
      <h1>Read a bounded slice of Reddit.</h1>
      <p className="lede">
        Enter a topic, name the subreddits to search, and collect matching posts and comments. Each search is capped at about 25 items.
        The result is a sample you can open and check.
      </p>
      {params.error ? <p className="error">{params.error}</p> : null}
      {fixture ? (
        <p className="banner">Demo mode is on. Results are labeled fixtures, not Reddit posts.</p>
      ) : (
        <p className="banner">{PRICE_NOTE} A Reddit API key is not used. An Apify token is.</p>
      )}
      <form className="research panel" action={startResearch}>
        <label>
          Topic
          <input name="topic" required minLength={3} placeholder="Best fitness bands for sleep tracking" />
        </label>
        <div className="row">
          <label>
            Keywords, comma separated
            <input name="keywords" placeholder="sleep score, battery, strap" />
          </label>
          <label>
            Subreddits, comma separated
            <input name="subreddits" required placeholder="fitbit, Garmin" />
          </label>
        </div>
        <div className="row">
          <label>
            Time window
            <select name="timeWindow" defaultValue="month">
              <option value="hour">Past hour</option>
              <option value="day">Past day</option>
              <option value="week">Past week</option>
              <option value="month">Past month</option>
              <option value="year">Past year</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label>
            Sort
            <select name="sort" defaultValue="relevance">
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="discussed">Most discussed</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            Maximum posts to keep
            <input name="maxPosts" type="number" min={1} max={100} defaultValue={25} />
          </label>
          <label>
            Maximum comments to keep
            <input name="maxComments" type="number" min={0} max={100} defaultValue={25} />
          </label>
        </div>
        <label>
          Minimum score
          <input name="minScore" type="number" min={0} placeholder="Unavailable from this source" disabled />
        </label>
        <p className="meta">
          Language filtering is not available. A subreddit is required. This run uses at most {MAX_SEARCHES} searches. Comment search does not download a full thread.
        </p>
        <button type="submit">{fixture ? 'Run labeled demo' : 'Collect sample'}</button>
      </form>
      <section className="panel">
        <h2>What this source will not return</h2>
        <ul className="limits">
          {COLLECTION_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Recent samples</h2>
        {projects.length === 0 ? <p className="meta">No samples yet.</p> : null}
        <div className="grid">
          {projects.map((project) => (
            <a key={project.id} className="card" href={`/projects/${project.id}`}>
              <h3>{project.topic}</h3>
              <span className="meta">
                {project.provider === 'fixture' ? 'Labeled demo' : 'Apify search'} · {project.timeWindow}
              </span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

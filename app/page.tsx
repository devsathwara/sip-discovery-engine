import { ClassifyBox } from '@/components/ClassifyBox';
import results from '@/data/results.json';

export const dynamic = 'force-static';

const SOURCE_LABEL: Record<string, string> = {
  playstore: 'Play Store',
  youtube: 'YouTube',
  reddit: 'Reddit'
};

const GATE_CLASS: Record<string, string> = {
  irrelevant: 'neu',
  not_continuation: 'mix',
  voluntary: 'pos',
  involuntary: 'neg'
};

export default function HomePage() {
  const maxLeaf = results.onTopic.leaves[0]?.count ?? 1;
  return (
    <main>
      <h1>What public comments say about stopping a SIP</h1>
      <p className="lede">
        Labels from {results.volumes.total.toLocaleString('en-IN')} public Play Store reviews, YouTube comments, and Reddit posts.
        On-topic means the writer’s own SIP was stopped, paused, reduced, skipped, or failed.
      </p>

      <section className="grid stats">
        <div className="stat">
          <b>{results.volumes.total.toLocaleString('en-IN')}</b>
          <span>public rows</span>
        </div>
        <div className="stat">
          <b>{results.quality.classified.toLocaleString('en-IN')}</b>
          <span>classified</span>
        </div>
        <div className="stat">
          <b>{results.onTopic.total}</b>
          <span>on-topic events</span>
        </div>
        <div className="stat">
          <b>{results.onTopic.ratio}</b>
          <span>voluntary : involuntary</span>
        </div>
      </section>

      <section className="panel">
        <h2>Where the rows came from</h2>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Rows</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Play Store</td>
              <td>{results.volumes.playstore.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td>YouTube</td>
              <td>{results.volumes.youtube.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td>Reddit</td>
              <td>{results.volumes.reddit.toLocaleString('en-IN')}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Gate split</h2>
        <p className="meta">Share of the {results.quality.classified.toLocaleString('en-IN')} classified rows.</p>
        <div className="bar gate-bar" aria-hidden="true">
          {results.gates.map((gate) => (
            <i key={gate.gate} className={GATE_CLASS[gate.gate] ?? 'neu'} style={{ width: `${gate.pct}%` }} />
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>Gate</th>
              <th>Rows</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {results.gates.map((gate) => (
              <tr key={gate.gate}>
                <td>{gate.gate}</td>
                <td>{gate.count.toLocaleString('en-IN')}</td>
                <td>{gate.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Why the {results.onTopic.total} on-topic events happened</h2>
        <p className="meta">
          {results.onTopic.voluntary} voluntary and {results.onTopic.involuntary} involuntary. Quotes are verbatim spans of the source text.
        </p>
        <div className="leaf-list">
          {results.onTopic.leaves.map((leaf) => (
            <article key={leaf.leaf} className="leaf">
              <div>
                <div className="leaf-name">
                  <b>{leaf.leaf}</b>
                  <span>{leaf.count}</span>
                </div>
                <div className="track" aria-hidden="true">
                  <span style={{ width: `${Math.max(4, (leaf.count / maxLeaf) * 100)}%` }} />
                </div>
              </div>
              {leaf.quotes.length > 0 ? (
                <div>
                  {leaf.quotes.map((quote) => (
                    <figure key={quote.quote} className="quote">
                      <blockquote>{quote.quote}</blockquote>
                      <figcaption className="meta">{SOURCE_LABEL[quote.source] ?? quote.source}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Golden-set check</h2>
        <div className="grid stats">
          <div className="stat">
            <b>
              {results.golden.overall}/{results.golden.rows}
            </b>
            <span>overall agreement</span>
          </div>
          <div className="stat">
            <b>
              {results.golden.gate}/{results.golden.rows}
            </b>
            <span>gate agreement</span>
          </div>
          <div className="stat">
            <b>
              {results.golden.leaf}/{results.golden.rows}
            </b>
            <span>leaf agreement</span>
          </div>
        </div>
        <h3>Three rows the recovery pass moved out of not_continuation</h3>
        <ul className="corrections">
          {results.golden.corrections.map((row) => (
            <li key={row.id}>
              <span className="pill">{row.leaf}</span> {row.text}
              <span className="meta"> {SOURCE_LABEL[row.source] ?? row.source}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Data quality and limits</h2>
        <table>
          <tbody>
            <tr>
              <td>Classified</td>
              <td>{results.quality.classified.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td>Pre-filtered generic praise, not sent to the model</td>
              <td>{results.quality.preFiltered}</td>
            </tr>
            <tr>
              <td>Stored quotes that are not a verbatim span</td>
              <td>{results.quality.nonVerbatimQuotes}</td>
            </tr>
            <tr>
              <td>Low confidence</td>
              <td>{results.quality.lowConfidence}</td>
            </tr>
            <tr>
              <td>Schema errors, no label</td>
              <td>{results.quality.schemaErrors}</td>
            </tr>
          </tbody>
        </table>
        <p className="meta">
          The quote list skips the {results.quality.nonVerbatimQuotes} non-verbatim quotes. Low-confidence labels stay in the counts and are marked for review.
          This page reads a static export. It does not open a database.
        </p>
      </section>

      <section className="panel">
        <h2>Classify a comment</h2>
        <p className="meta">The same taxonomy and prompt as the research run. Nothing is stored. Comments over 4,000 characters are refused.</p>
        <ClassifyBox />
      </section>
    </main>
  );
}

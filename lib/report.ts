import type { Insight } from '@/lib/insights';
import { COLLECTION_LIMITS } from '@/lib/limits';

type ReportInput = {
  topic: string;
  postCount: number;
  commentCount: number;
  searchCount: number;
  emptySearches: number;
  failedSearches: number;
  sentiment: { positive: number; negative: number; neutral: number; mixed: number; notUsedAsReviews: number; notAnalyzed: number };
  pros: Insight[];
  cons: Insight[];
  painPoints: Insight[];
  featureRequests: Insight[];
  competitors: Insight[];
  products: Insight[];
  provider: string;
};

function lines(title: string, items: Insight[]): string {
  if (!items.length) return `## ${title}\n\nNone found in this collected sample.\n`;
  const body = items.slice(0, 8).map((item) => {
    const evidence = item.evidence
      .slice(0, 2)
      .map((entry) => `> ${entry.excerpt}\n> Source: ${entry.permalink}`)
      .join('\n\n');
    return `- ${item.label} — ${item.count} item${item.count === 1 ? '' : 's'} in this sample\n\n${evidence}`;
  });
  return `## ${title}\n\n${body.join('\n\n')}\n`;
}

export function renderReport(input: ReportInput): string {
  const compared = [...input.products, ...input.competitors].filter((item) => item.count > 0);
  const topPain = input.painPoints[0];
  const topPro = input.pros[0];
  const conclusion = [topPro, topPain].filter(Boolean).length
    ? [
        topPro ? `The most repeated positive point in this sample is "${topPro.label}" (${topPro.count} items).` : '',
        topPain ? `The most repeated complaint in this sample is "${topPain.label}" (${topPain.count} items).` : ''
      ]
        .filter(Boolean)
        .join(' ')
    : 'No analyzed first-hand comments were available, so this sample does not support a conclusion.';

  return `# Research sample: ${input.topic}

## 1. Executive summary

This report describes ${input.postCount} unique ${input.postCount === 1 ? 'post' : 'posts'} and ${input.commentCount} unique ${input.commentCount === 1 ? 'comment' : 'comments'} collected for "${input.topic}". Counts are mention counts inside this sample. They are not shares of all Reddit users.

## 2. Dataset scope and collection limitations

- Provider: ${input.provider}
- Searches run: ${input.searchCount}. Empty searches: ${input.emptySearches}. Searches that failed: ${input.failedSearches}.
${COLLECTION_LIMITS.map((limit) => `- ${limit}`).join('\n')}

## 3. Positive and negative sentiment

Sentiment below counts analyzed items that read as experience or other discussion. Questions, jokes, speculation, and promotional items are excluded (${input.sentiment.notUsedAsReviews}). Items not analyzed: ${input.sentiment.notAnalyzed}.

- Positive: ${input.sentiment.positive}
- Negative: ${input.sentiment.negative}
- Neutral: ${input.sentiment.neutral}
- Mixed: ${input.sentiment.mixed}

## 4. Pros and cons

${lines('Pros', input.pros)}
${lines('Cons', input.cons)}

## 5. Recurring user complaints

${lines('Complaints', input.painPoints)}

## 6. Feature requests

${lines('Feature requests', input.featureRequests)}

## 7. Competitor comparisons

${compared.length < 2 ? 'Fewer than two named products were extracted, so this sample does not support a comparison.\n' : lines('Named products and alternatives', compared)}

## 8. Supporting quotes and source links

Quotes in the sections above are excerpts stored from the collected text. Open the source link before treating a quote as a finding.

## 9. Conclusions and recommendations

${conclusion}

A useful next step inside this tool is another bounded search with a different subreddit, sort, or time window. That adds another sample. It still would not represent every Reddit discussion.
`;
}

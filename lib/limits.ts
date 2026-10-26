export const ACTOR_ID = 'logiover/reddit-search-scraper';
export const ACTOR_API = 'logiover~reddit-search-scraper';
export const MAX_PER_SEARCH = 25;
export const MAX_SEARCHES = 8;
export const PRICE_NOTE = 'Apify lists this actor from $2.10 per 1,000 returned results. Empty searches do not add rows. Confirm the live price and your Apify credit before a large run.';

export const COLLECTION_LIMITS = [
  'This sample is not every Reddit discussion. Coverage is whatever the public subreddit search feed returned for the searches that ran.',
  'Keyword search needs a subreddit. Logged-out all-of-Reddit keyword search is not available from this source. A keyword with no subreddit is not run, because the actor would browse r/all instead of searching.',
  `Each search returns at most about ${MAX_PER_SEARCH} items and cannot be paged. More coverage means more searches (other keywords, subreddits, sorts, or time windows), capped at ${MAX_SEARCHES} per run.`,
  'Scores, upvote ratios, and comment counts are not in this feed. The dashboard shows them as unavailable. A minimum-score filter is not applied.',
  'Comment search returns comments that match the keyword. It does not download the thread under a post, and it does not include parent or reply links.',
  PRICE_NOTE
];

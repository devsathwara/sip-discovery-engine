# SIP discovery engine

A Next.js research tool that collects a **bounded sample** of public Reddit posts and comments for a topic. It does not use a Reddit API key, OAuth app, or PRAW.

The placeholder Vite app that used to live in this folder was replaced by this Next.js app. `gp-discovery-engine` is a different project and is not part of this one.

## Provider

Collection uses the Apify actor [`logiover/reddit-search-scraper`](https://apify.com/logiover/reddit-search-scraper) (actor id `logiover/reddit-search-scraper`). The call is server-side:

`POST https://api.apify.com/v2/acts/logiover~reddit-search-scraper/run-sync-get-dataset-items`

Input follows the actor schema: a `searches` array of `{ query, subreddit, sort, time, type }` plus `maxResults`. The token is `APIFY_API_TOKEN`. It is never sent to the browser.

Documented limits, checked against the actor page and the [repository README](https://github.com/logiover/reddit-search-scraper):

- A subreddit is required for keyword search. Logged-out search of all of Reddit is not available. An empty subreddit list is not used, because the actor would browse `r/all` instead of searching.
- About 25 items per search, with no pagination. This app runs at most 8 searches so a click cannot fan out without a bound.
- `score`, `upvoteRatio`, and `numComments` are always null. The UI says unavailable. It does not show zero, and it does not apply a minimum-score filter.
- `type: "comment"` is a comment **search**, not the thread under a post. Parent ids and depth are not in the payload. Matching comments are listed on the sample page even when the parent post was not collected. The post page says the thread was not retrieved.
- Apify lists the actor from **$2.10 per 1,000 returned results**. You need an Apify account. The free tier can be used to try it. Check your credit before a large run. This app does not promise unlimited free collection.

[Reddrix](https://github.com/Coding-Doctor-Omar/reddrix) is an MIT-licensed Python scraper that claims full threads without a Reddit key. Its own topics include Camoufox and anti-detection. This app does not use it. The requirement here is not to bypass access controls.

## Analysis

`LLM_PROVIDER=grok` calls `https://api.x.ai/v1/chat/completions` with `XAI_API_KEY` or `LLM_API_KEY`. The default model is `grok-4.20-0309-non-reasoning` ($1.25 input and $2.50 output per 1M tokens under 200k, with no reasoning tokens). Set `LLM_MODEL` to override it. Output is JSON, checked with Zod. Excerpts that are not verbatim substrings of the source are dropped.

`LLM_PROVIDER=huggingface` calls `https://router.huggingface.co/v1/chat/completions` with `LLM_API_KEY` and `LLM_MODEL`.

`LLM_PROVIDER=fixture` uses a local word list and labels the result as a demo. If no key is set, collection can still finish and analysis is marked not configured. Missing analysis is not filled in.

Questions, jokes, speculation, and promotional items are stored, then left out of the pros, cons, and sentiment split.

## Setup

```bash
cp .env.example .env
npm install
npx prisma db push
npm run dev
```

Open http://localhost:3000.

Set `APIFY_API_TOKEN` for a real sample. Set `REDDIT_PROVIDER=fixture` and `LLM_PROVIDER=fixture` to click through the dashboard with labeled demo rows.

SQLite is stored at `prisma/dev.db`. That file is local. A Vercel deploy will not keep it. Delete a sample from its page, or `DELETE /api/discovery/projects/:id`, to remove the stored posts, comments, and report.

Optional `DISCOVERY_API_KEY` protects `/api/discovery/*` and `/api/ingest`. The pages call server actions, so the key is not bundled into the browser.

## Ingestion

Three sources write the same record shape, `{ id, source, date, text }`. Play Store rows also keep `score`. Near-duplicate text is dropped and the first copy is kept. Each source is a separate command. `npm run ingest -- counts` prints the stored count for each source.

```bash
npm run ingest -- playstore --limit 3000
npm run ingest -- youtube --max-calls 80
npm run ingest -- reddit
npm run ingest -- reddit --full
```

`playstore` reads Groww (`com.nextbillion.groww`) newest-first, English, India, up to 3000 reviews. The default command pulls 100. `youtube` searches five SIP queries with `regionCode=IN` and `relevanceLanguage` `en` and `hi`, keeps the top 5 videos per query by view count, then reads `commentThreads` (`snippet,replies`). It uses `YOUTUBE_API_KEY`. Pass `--videos` only to skip the search. A quota error or the call cap stops the run and keeps rows already saved. `reddit` uses the Apify actor `harshmaur/reddit-scraper` (free plan: $0.002 per stored post or comment, plus a $0.02 start). It searches IndiaInvestments, mutualfunds, personalfinanceindia, IndianStreetBets, and FIRE_Ind for "stopped SIP", "pause SIP", "reduce SIP", "SIP returns", "SIP worth it", "cancel SIP", and "SIP not growing". Each run stores posts (`t3_`) and comments (`t1_`), including a short comment tree on each post. Without `--full` it samples r/IndiaInvestments. `--full` runs every subreddit and stops a community at a $0.90 charge cap. The token is `APIFY_TOKEN` or `APIFY_API_TOKEN`. The discovery collector is still `logiover/reddit-search-scraper`.

`GET /api/ingest` returns the counts. `POST /api/ingest/playstore`, `POST /api/ingest/youtube`, and `POST /api/ingest/reddit` run one source. The Play Store HTTP route accepts at most 200 reviews; larger pulls use the command.

## Tests

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use fixtures. They do not call Apify or Reddit.

## Routes

- `POST /api/discovery/search`
- `GET /api/discovery/jobs/:id`
- `GET /api/discovery/projects/:id/posts`
- `GET /api/discovery/posts/:id/comments`
- `GET /api/discovery/projects/:id/insights`
- `POST /api/discovery/projects/:id/analyze` advances one collect or analysis step
- `GET /api/discovery/projects/:id/report`
- `GET /api/discovery/projects/:id/export?format=json|csv|md`
- `DELETE /api/discovery/projects/:id`

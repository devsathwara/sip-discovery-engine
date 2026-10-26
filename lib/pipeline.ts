import { prisma } from '@/lib/db';
import { analysisConfigured, analyzeText } from '@/lib/analysis/llm';
import { buildInsights } from '@/lib/insights';
import { parseStringList } from '@/lib/json';
import { renderReport } from '@/lib/report';
import { toRecord } from '@/lib/records';
import { fixtureProvider } from '@/lib/reddit/fixture';
import { apifyProvider } from '@/lib/reddit/apify';
import { relevanceScore, shouldWait } from '@/lib/reddit/normalize';
import { buildSearchPlan, type TimeWindow, type UiSort } from '@/lib/reddit/plan';
import { ProviderError, type RedditDiscoveryProvider } from '@/lib/reddit/provider';

const locks = new Map<string, Promise<unknown>>();

type CreateInput = {
  topic: string;
  keywords: string[];
  subreddits: string[];
  timeWindow: TimeWindow;
  sort: UiSort;
  maxPosts: number;
  maxComments: number;
  minScore?: number;
};

function providerFor(name: string, override?: RedditDiscoveryProvider): RedditDiscoveryProvider {
  if (override) return override;
  return name === 'fixture' ? fixtureProvider : apifyProvider;
}

function lists(payload: {
  pros: string[];
  cons: string[];
  painPoints: string[];
  featureRequests: string[];
  benefits: string[];
  dissatisfaction: string[];
  products: string[];
  competitors: string[];
  recommendations: string[];
  evidence: string[];
}) {
  return {
    prosJson: JSON.stringify(payload.pros),
    consJson: JSON.stringify(payload.cons),
    painPointsJson: JSON.stringify(payload.painPoints),
    featureRequestsJson: JSON.stringify(payload.featureRequests),
    benefitsJson: JSON.stringify(payload.benefits),
    dissatisfactionJson: JSON.stringify(payload.dissatisfaction),
    productsJson: JSON.stringify(payload.products),
    competitorsJson: JSON.stringify(payload.competitors),
    recommendationsJson: JSON.stringify(payload.recommendations),
    evidenceJson: JSON.stringify(payload.evidence)
  };
}

const emptyLists = lists({
  pros: [],
  cons: [],
  painPoints: [],
  featureRequests: [],
  benefits: [],
  dissatisfaction: [],
  products: [],
  competitors: [],
  recommendations: [],
  evidence: []
});

export async function createProject(input: CreateInput) {
  const plan = buildSearchPlan(input);
  if (!plan.searches.length) {
    throw new Error('Add at least one valid subreddit. Keyword search cannot run across all of Reddit with this source.');
  }
  const provider = process.env.REDDIT_PROVIDER === 'fixture' ? 'fixture' : 'apify';
  return prisma.researchProject.create({
    data: {
      topic: input.topic,
      keywordsJson: JSON.stringify(input.keywords),
      subredditsJson: JSON.stringify(input.subreddits),
      timeWindow: input.timeWindow,
      sortOrder: input.sort,
      maxPosts: input.maxPosts,
      maxComments: input.maxComments,
      minScoreRequested: input.minScore ?? null,
      provider,
      queries: {
        create: plan.searches.map((search, index) => ({
          position: index,
          text: search.query,
          subreddit: search.subreddit,
          resultType: search.type,
          sort: search.sort,
          timeWindow: search.time,
          status: 'pending'
        }))
      },
      jobs: {
        create: [
          { type: 'collect', status: 'queued', label: `0 of ${plan.searches.length} searches` },
          { type: 'analyze', status: 'queued', label: 'Waiting for collection' }
        ]
      }
    },
    include: { jobs: true }
  });
}

async function saveItems(projectId: string, items: Awaited<ReturnType<RedditDiscoveryProvider['search']>>['items'], needles: string[], caps: { posts: number; comments: number }) {
  let stored = 0;
  let heldBack = 0;
  for (const item of items) {
    const relevance = relevanceScore(`${item.title} ${item.body}`, needles);
    if (item.resultType === 'link') {
      const count = await prisma.redditPost.count({ where: { projectId } });
      if (count >= caps.posts) {
        heldBack += 1;
        continue;
      }
      const existing = await prisma.redditPost.findUnique({
        where: { projectId_redditId: { projectId, redditId: item.redditId } }
      });
      if (existing) continue;
      const post = await prisma.redditPost.create({
        data: {
          projectId,
          redditId: item.redditId,
          fullname: item.fullname,
          title: item.title,
          body: item.body,
          subreddit: item.subreddit,
          author: item.author,
          score: item.score,
          upvoteRatio: item.upvoteRatio,
          numComments: item.numComments,
          createdAt: item.createdAt ? new Date(item.createdAt) : null,
          permalink: item.permalink,
          url: item.url,
          matchedQuery: item.matchedQuery,
          relevance,
          removed: item.removed,
          origin: item.origin
        }
      });
      if (item.removed) {
        await prisma.analysisResult.create({
          data: {
            projectId,
            targetType: 'post',
            postId: post.id,
            ...emptyLists,
            sentiment: 'neutral',
            confidence: 0,
            purchaseIntent: 'unknown',
            contentKind: 'other',
            permalink: post.permalink,
            status: 'skipped',
            model: 'none',
            provider: 'none'
          }
        });
      }
      await prisma.redditComment.updateMany({
        where: { projectId, postRedditId: item.redditId, postId: null },
        data: { postId: post.id }
      });
      stored += 1;
    } else {
      const count = await prisma.redditComment.count({ where: { projectId } });
      if (count >= caps.comments) {
        heldBack += 1;
        continue;
      }
      const existing = await prisma.redditComment.findUnique({
        where: { projectId_redditId: { projectId, redditId: item.redditId } }
      });
      if (existing) continue;
      const post = item.postRedditId
        ? await prisma.redditPost.findUnique({ where: { projectId_redditId: { projectId, redditId: item.postRedditId } } })
        : null;
      const comment = await prisma.redditComment.create({
        data: {
          projectId,
          postId: post?.id ?? null,
          redditId: item.redditId,
          postRedditId: item.postRedditId,
          parentRedditId: null,
          body: item.body,
          subreddit: item.subreddit,
          author: item.author,
          score: item.score,
          createdAt: item.createdAt ? new Date(item.createdAt) : null,
          permalink: item.permalink,
          depth: null,
          relevance,
          removed: item.removed,
          matchedQuery: item.matchedQuery,
          origin: item.origin
        }
      });
      if (item.removed) {
        await prisma.analysisResult.create({
          data: {
            projectId,
            targetType: 'comment',
            commentId: comment.id,
            ...emptyLists,
            sentiment: 'neutral',
            confidence: 0,
            purchaseIntent: 'unknown',
            contentKind: 'other',
            permalink: comment.permalink,
            status: 'skipped',
            model: 'none',
            provider: 'none'
          }
        });
      }
      stored += 1;
    }
  }
  return { stored, heldBack };
}

async function loadRecords(projectId: string) {
  const posts = await prisma.redditPost.findMany({ where: { projectId }, include: { analysis: true } });
  const comments = await prisma.redditComment.findMany({ where: { projectId }, include: { analysis: true } });
  return [
    ...posts.map((post) =>
      toRecord({
        id: post.id,
        kind: 'post',
        permalink: post.permalink,
        text: `${post.title}\n${post.body}`,
        title: post.title,
        subreddit: post.subreddit,
        createdAt: post.createdAt,
        analysis: post.analysis
      })
    ),
    ...comments.map((comment) =>
      toRecord({
        id: comment.id,
        kind: 'comment',
        permalink: comment.permalink,
        text: comment.body,
        subreddit: comment.subreddit,
        createdAt: comment.createdAt,
        analysis: comment.analysis
      })
    )
  ];
}

async function writeReport(projectId: string) {
  const project = await prisma.researchProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { queries: true, posts: true, comments: true }
  });
  const records = await loadRecords(projectId);
  const insights = buildInsights(records);
  const markdown = renderReport({
    topic: project.topic,
    postCount: project.posts.length,
    commentCount: project.comments.length,
    searchCount: project.queries.filter((query) => query.status !== 'pending').length,
    emptySearches: project.queries.filter((query) => query.status === 'empty').length,
    failedSearches: project.queries.filter((query) => query.status === 'error').length,
    sentiment: insights.sentiment,
    pros: insights.pros,
    cons: insights.cons,
    painPoints: insights.painPoints,
    featureRequests: insights.featureRequests,
    competitors: insights.competitors,
    products: insights.products,
    provider: project.provider
  });
  await prisma.topicCluster.deleteMany({ where: { projectId } });
  if (insights.clusters.length) {
    await prisma.topicCluster.createMany({
      data: insights.clusters.map((cluster) => ({
        projectId,
        label: cluster.label,
        mentionCount: cluster.mentionCount,
        permalinksJson: JSON.stringify(cluster.permalinks),
        excerptsJson: JSON.stringify(cluster.excerpts)
      }))
    });
  }
  await prisma.researchReport.upsert({
    where: { projectId },
    create: { projectId, markdown, model: 'deterministic-sample-report' },
    update: { markdown, model: 'deterministic-sample-report', createdAt: new Date() }
  });
}

async function finishCollection(projectId: string, queries: { status: string }[]) {
  const failed = queries.filter((query) => query.status === 'error').length;
  const done = queries.filter((query) => query.status === 'done' || query.status === 'empty').length;
  const status = done === 0 && failed > 0 ? 'failed' : failed > 0 ? 'partial' : 'completed';
  await prisma.collectionJob.update({
    where: { projectId_type: { projectId, type: 'collect' } },
    data: {
      status,
      label: status === 'failed' ? 'Collection failed' : `Collection ${status}`,
      error: status === 'failed' ? 'Every search failed. Nothing was collected.' : null,
      retryAt: null
    }
  });
  return status;
}

async function analyzeOne(projectId: string): Promise<string> {
  const post = await prisma.redditPost.findFirst({
    where: { projectId, analysis: null },
    orderBy: { relevance: 'desc' }
  });
  const comment = post
    ? null
    : await prisma.redditComment.findFirst({ where: { projectId, analysis: null }, orderBy: { relevance: 'desc' } });
  const item = post ?? comment;
  if (!item) {
    await prisma.collectionJob.update({
      where: { projectId_type: { projectId, type: 'analyze' } },
      data: { status: 'completed', label: 'Analysis complete', error: null }
    });
    await writeReport(projectId);
    return 'Analysis complete';
  }
  if (!analysisConfigured()) {
    await prisma.collectionJob.update({
      where: { projectId_type: { projectId, type: 'analyze' } },
      data: {
        status: 'failed',
        error: 'Analysis did not run. Set XAI_API_KEY, or set LLM_PROVIDER=fixture for the labeled demo analyzer. Collected text is unchanged.',
        label: 'Analysis not configured'
      }
    });
    await writeReport(projectId);
    return 'Analysis not configured';
  }
  const text = 'title' in item && item.title ? `${item.title}\n${item.body}` : item.body;
  const targetType = post ? 'post' : 'comment';
  try {
    const result = await analyzeText(text);
    await prisma.analysisResult.create({
      data: {
        projectId,
        targetType,
        postId: post ? item.id : null,
        commentId: comment ? item.id : null,
        sentiment: result.payload.sentiment,
        confidence: result.payload.confidence,
        ...lists(result.payload),
        purchaseIntent: result.payload.purchaseIntent,
        contentKind: result.payload.contentKind,
        permalink: item.permalink,
        status: 'validated',
        model: result.model,
        provider: result.provider
      }
    });
    return `Analyzed one ${targetType}`;
  } catch (error) {
    await prisma.analysisResult.create({
      data: {
        projectId,
        targetType,
        postId: post ? item.id : null,
        commentId: comment ? item.id : null,
        ...emptyLists,
        sentiment: 'neutral',
        confidence: 0,
        purchaseIntent: 'unknown',
        contentKind: 'other',
        permalink: item.permalink,
        status: 'needs_review',
        model: error instanceof Error ? error.message.slice(0, 180) : 'failed',
        provider: process.env.LLM_PROVIDER || 'grok'
      }
    });
    return 'Saved an item for review because analysis failed';
  }
}

async function step(projectId: string, override?: RedditDiscoveryProvider) {
  const project = await prisma.researchProject.findUnique({
    where: { id: projectId },
    include: { jobs: true, queries: { orderBy: { position: 'asc' } } }
  });
  if (!project) return { status: 'missing', label: 'Project not found', collectStatus: 'missing', analyzeStatus: 'missing' };
  const collect = project.jobs.find((job) => job.type === 'collect');
  const analyze = project.jobs.find((job) => job.type === 'analyze');
  if (!collect || !analyze) return { status: 'failed', label: 'Jobs missing', collectStatus: 'failed', analyzeStatus: 'failed' };

  if (collect.status === 'queued' || collect.status === 'running') {
    if (shouldWait(collect.retryAt, new Date())) {
      return { status: 'running', label: collect.label ?? 'Waiting to retry', collectStatus: collect.status, analyzeStatus: analyze.status };
    }
    const next = project.queries.find((query) => query.status === 'pending');
    if (!next) {
      const collectStatus = await finishCollection(projectId, project.queries);
      return { status: collectStatus === 'failed' ? 'failed' : 'running', label: 'Collection finished', collectStatus, analyzeStatus: 'queued' };
    }
    await prisma.collectionJob.update({
      where: { id: collect.id },
      data: { status: 'running', label: `Search ${next.position + 1}: r/${next.subreddit} · ${next.text}` }
    });
    const provider = providerFor(project.provider, override);
    try {
      const result = await provider.search({
        query: next.text,
        subreddit: next.subreddit,
        sort: next.sort as 'relevance' | 'new' | 'comments' | 'hot' | 'top',
        time: next.timeWindow as TimeWindow,
        type: next.resultType as 'link' | 'comment',
        maxResults: next.resultType === 'link' ? project.maxPosts : project.maxComments
      });
      const saved = await saveItems(projectId, result.items, [project.topic, ...parseStringList(project.keywordsJson), next.text], {
        posts: project.maxPosts,
        comments: project.maxComments
      });
      await prisma.researchQuery.update({
        where: { id: next.id },
        data: {
          status: result.returnedCount === 0 ? 'empty' : 'done',
          returnedCount: result.returnedCount,
          droppedCount: result.droppedCount + saved.heldBack,
          error: null
        }
      });
      const doneCount = project.queries.filter((query) => query.status === 'done' || query.status === 'empty' || query.status === 'error').length + 1;
      return {
        status: 'running',
        label: `Stored ${saved.stored} from r/${next.subreddit}. Search ${doneCount} of ${project.queries.length}.`,
        collectStatus: 'running',
        analyzeStatus: analyze.status
      };
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : 'outage';
      const attempts = next.attempts + 1;
      if (kind !== 'config' && attempts < 3 && (kind === 'rate_limit' || kind === 'outage')) {
        const retryAt = new Date(Date.now() + attempts * 5000);
        await prisma.researchQuery.update({ where: { id: next.id }, data: { attempts } });
        await prisma.collectionJob.update({
          where: { id: collect.id },
          data: { status: 'running', retryAt, label: `Retrying after a ${kind.replace('_', ' ')}`, error: error instanceof Error ? error.message : 'Search failed' }
        });
        return { status: 'running', label: 'Waiting to retry a search', collectStatus: 'running', analyzeStatus: analyze.status };
      }
      await prisma.researchQuery.update({
        where: { id: next.id },
        data: { status: 'error', attempts, error: error instanceof Error ? error.message : 'Search failed', returnedCount: null }
      });
      if (kind === 'config') {
        await prisma.collectionJob.update({
          where: { id: collect.id },
          data: { status: 'failed', error: error instanceof Error ? error.message : 'Provider is not configured', label: 'Collection blocked' }
        });
        return { status: 'failed', label: 'Collection blocked', collectStatus: 'failed', analyzeStatus: analyze.status };
      }
      return { status: 'running', label: 'A search failed. Continuing with the next one.', collectStatus: 'running', analyzeStatus: analyze.status };
    }
  }

  if (analyze.status === 'queued' || analyze.status === 'running') {
    await prisma.collectionJob.update({ where: { id: analyze.id }, data: { status: 'running' } });
    const label = await analyzeOne(projectId);
    const updated = await prisma.collectionJob.findUniqueOrThrow({ where: { id: analyze.id } });
    const overall = updated.status === 'failed' ? 'partial' : updated.status === 'completed' ? 'completed' : 'running';
    return { status: overall, label, collectStatus: collect.status, analyzeStatus: updated.status };
  }

  return { status: collect.status === 'failed' ? 'failed' : 'completed', label: 'Ready', collectStatus: collect.status, analyzeStatus: analyze.status };
}

export function advanceProject(projectId: string, override?: RedditDiscoveryProvider) {
  const previous = locks.get(projectId) ?? Promise.resolve();
  const run = previous.then(() => step(projectId, override));
  locks.set(projectId, run.then(() => undefined, () => undefined));
  return run;
}

export async function rebuildReport(projectId: string) {
  await writeReport(projectId);
}

export async function projectView(projectId: string) {
  const project = await prisma.researchProject.findUnique({
    where: { id: projectId },
    include: {
      queries: { orderBy: { position: 'asc' } },
      jobs: true,
      posts: { include: { analysis: true, comments: true }, orderBy: { relevance: 'desc' } },
      comments: { include: { analysis: true }, orderBy: { relevance: 'desc' } },
      clusters: { orderBy: { mentionCount: 'desc' } },
      report: true
    }
  });
  if (!project) return null;
  const records = [
    ...project.posts.map((post) =>
      toRecord({
        id: post.id,
        kind: 'post' as const,
        permalink: post.permalink,
        text: `${post.title}\n${post.body}`,
        title: post.title,
        subreddit: post.subreddit,
        createdAt: post.createdAt,
        analysis: post.analysis
      })
    ),
    ...project.comments.map((comment) =>
      toRecord({
        id: comment.id,
        kind: 'comment' as const,
        permalink: comment.permalink,
        text: comment.body,
        subreddit: comment.subreddit,
        createdAt: comment.createdAt,
        analysis: comment.analysis
      })
    )
  ];
  return { project, insights: buildInsights(records), records };
}

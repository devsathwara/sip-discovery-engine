import { afterAll, expect, test } from 'vitest';
import { prisma } from '@/lib/db';
import { advanceProject, createProject } from '@/lib/pipeline';

afterAll(async () => {
  await prisma.$disconnect();
});

test('stores a fixture sample once and can resume analysis without collecting again', async () => {
  process.env.REDDIT_PROVIDER = 'fixture';
  process.env.LLM_PROVIDER = 'fixture';
  const project = await createProject({
    topic: 'fixture sleep band',
    keywords: [],
    subreddits: ['demo'],
    timeWindow: 'month',
    sort: 'relevance',
    maxPosts: 10,
    maxComments: 10
  });

  let guard = 0;
  let status = 'running';
  while (status === 'running' || status === 'queued') {
    const step = await advanceProject(project.id);
    status = step.status;
    guard += 1;
    if (guard > 30) throw new Error(`job did not finish: ${step.label}`);
  }

  const posts = await prisma.redditPost.findMany({ where: { projectId: project.id } });
  const comments = await prisma.redditComment.findMany({ where: { projectId: project.id } });
  expect(posts.length).toBeGreaterThan(0);
  expect(new Set(posts.map((post) => post.redditId)).size).toBe(posts.length);
  expect(posts.every((post) => post.score == null)).toBe(true);
  expect(comments.every((comment) => comment.parentRedditId == null && comment.depth == null)).toBe(true);
  expect(posts.every((post) => post.origin === 'fixture' && post.permalink.startsWith('fixture:'))).toBe(true);

  const before = posts.length;
  await advanceProject(project.id);
  const after = await prisma.redditPost.count({ where: { projectId: project.id } });
  expect(after).toBe(before);

  const report = await prisma.researchReport.findUnique({ where: { projectId: project.id } });
  expect(report?.markdown).toContain('fixture sleep band');
  await prisma.researchProject.delete({ where: { id: project.id } });
});

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { parseSearchForm } from '@/lib/input';
import { advanceProject, createProject, rebuildReport } from '@/lib/pipeline';

export async function startResearch(formData: FormData) {
  const parsed = parseSearchForm(formData);
  if ('data' in parsed) {
    const project = await createProject(parsed.data);
    redirect(`/projects/${project.id}`);
  }
  redirect(`/?error=${encodeURIComponent(parsed.error)}`);
}

export async function advanceResearch(projectId: string) {
  return advanceProject(projectId);
}

export async function refreshReport(projectId: string) {
  await rebuildReport(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteResearch(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (id) await prisma.researchProject.delete({ where: { id } }).catch(() => undefined);
  redirect('/');
}

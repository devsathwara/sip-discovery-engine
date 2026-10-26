import { NextResponse } from 'next/server';
import { guard } from '@/lib/api';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  const report = await prisma.researchReport.findUnique({ where: { projectId: id } });
  if (!report) return NextResponse.json({ error: 'Report is not ready' }, { status: 404 });
  return NextResponse.json({ markdown: report.markdown, model: report.model, createdAt: report.createdAt });
}

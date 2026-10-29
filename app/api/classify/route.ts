import { classifyItem } from '@/lib/classify/run';
import { MAX_CLASSIFY_BODY_BYTES, MAX_COMMENT_CHARS } from '@/lib/classify/limits';
import { createRateLimiter } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const classifyLimiter = createRateLimiter(8, 60_000);

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'local';
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_CLASSIFY_BODY_BYTES) {
    return Response.json({ error: `Keep the comment under ${MAX_COMMENT_CHARS} characters.` }, { status: 413 });
  }
  if (!classifyLimiter(clientKey(request))) {
    return Response.json({ error: 'Too many comments. Wait a minute and try again.' }, { status: 429 });
  }
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return Response.json({ error: 'Send a JSON body with a text field.' }, { status: 400 });
  }
  if (raw.length > MAX_CLASSIFY_BODY_BYTES) {
    return Response.json({ error: `Keep the comment under ${MAX_COMMENT_CHARS} characters.` }, { status: 413 });
  }
  let body: { text?: unknown };
  try {
    body = JSON.parse(raw) as { text?: unknown };
  } catch {
    return Response.json({ error: 'Send a JSON body with a text field.' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return Response.json({ error: 'Paste a comment first.' }, { status: 400 });
  if (text.length > MAX_COMMENT_CHARS) {
    return Response.json({ error: `Keep the comment under ${MAX_COMMENT_CHARS} characters.` }, { status: 400 });
  }

  const call = await classifyItem({ source: 'live', date: new Date().toISOString().slice(0, 10), text });
  if (!call.result) {
    const missing = call.error?.includes('XAI_API_KEY');
    return Response.json(
      { error: missing ? 'Classification is not configured.' : 'The classifier could not label that comment. Try a shorter one.' },
      { status: missing ? 503 : 502 }
    );
  }

  const { primary_gate, leaf, confidence, reasoning, quote } = call.result;
  const notes: string[] = [];
  if (primary_gate === 'irrelevant') notes.push('Not about SIP continuation.');
  if (primary_gate === 'not_continuation') notes.push('About SIPs, but not this person’s own stop, pause, or failure.');
  if (confidence === 'low') notes.push('Low confidence. This label is a guess.');

  return Response.json({ primary_gate, leaf, confidence, reasoning, quote, note: notes.join(' ') });
}

import { NextResponse } from 'next/server';
import { apiLimiter, isAuthorized } from '@/lib/auth';

export function guard(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!apiLimiter(ip)) {
    return NextResponse.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
  }
  const apiKey = process.env.DISCOVERY_API_KEY;
  const site = request.headers.get('sec-fetch-site');
  const fromApp = site === 'same-origin' || site === 'same-site';
  if (apiKey && !fromApp && !isAuthorized(request.headers.get('authorization'), apiKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

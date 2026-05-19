import { NextResponse } from 'next/server';
import { getApiUsage } from '@/lib/news-cache';

// GET /api/events/usage — текущий месячный расход Marketaux + cap.
export async function GET() {
  const cap = Number(process.env.MARKETAUX_MONTHLY_CAP || 8000);
  const enabled = !!process.env.MARKETAUX_KEY;
  let used = 0;
  try { used = await getApiUsage('marketaux'); } catch {}
  return NextResponse.json({ used, cap, enabled, remaining: Math.max(0, cap - used) });
}

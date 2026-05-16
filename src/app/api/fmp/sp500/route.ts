import { NextResponse } from 'next/server';
import { fmpSp500Current } from '@/lib/fmp';

export async function GET() {
  try {
    const data = await fmpSp500Current();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

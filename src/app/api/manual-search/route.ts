import { NextRequest, NextResponse } from 'next/server';
import { searchITunes } from '@/lib/itunes';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q');
  if (!query) {
    return NextResponse.json({ error: '请提供搜索词' }, { status: 400 });
  }

  try {
    const candidates = await searchITunes(query, 8);
    return NextResponse.json({ candidates });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

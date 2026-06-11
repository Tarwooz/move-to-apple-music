import { NextRequest, NextResponse } from 'next/server';
import { loadCache, saveCache, cacheKey } from '@/lib/cache';
import { TrackMatch } from '@/lib/types';

export async function POST(req: NextRequest) {
  const { matches }: { matches: TrackMatch[] } = await req.json();

  if (!matches?.length) {
    return NextResponse.json({ error: '没有可保存的数据' }, { status: 400 });
  }

  try {
    const cache = loadCache();
    for (const m of matches) {
      cache.set(cacheKey(m.source.title, m.source.artist), m);
    }
    saveCache(cache);
    return NextResponse.json({ saved: matches.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

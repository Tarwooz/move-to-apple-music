import { NextRequest, NextResponse } from 'next/server';
import { mergePlaylistsInto } from '@/lib/applescript';

export async function POST(req: NextRequest) {
  const { sources, target } = await req.json();
  if (!sources?.length || !target?.trim()) {
    return NextResponse.json({ error: '参数错误：sources 和 target 不能为空' }, { status: 400 });
  }
  try {
    const count = await mergePlaylistsInto(sources as string[], target.trim());
    return NextResponse.json({ count });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createPlaylistWithTracks } from '@/lib/applescript';
import { AppleMusicTrack } from '@/lib/types';

export async function POST(req: NextRequest) {
  const { name, tracks }: { name: string; tracks: AppleMusicTrack[] } = await req.json();

  if (!name) {
    return NextResponse.json({ error: '请提供歌单名称' }, { status: 400 });
  }
  if (!tracks?.length) {
    return NextResponse.json({ error: '没有可添加的歌曲' }, { status: 400 });
  }

  try {
    await createPlaylistWithTracks(name, tracks);
    return NextResponse.json({ success: true, count: tracks.length });
  } catch (e: any) {
    return NextResponse.json(
      { error: `创建歌单失败: ${e.message}` },
      { status: 500 }
    );
  }
}

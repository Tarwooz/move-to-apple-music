import { NextRequest, NextResponse } from 'next/server';
import {
  parseNeteaseId,
  parseQQMusicId,
  fetchNeteasePlaylist,
  fetchQQPlaylist,
} from '@/lib/netease';

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url) {
    return NextResponse.json({ error: '请提供歌单链接' }, { status: 400 });
  }

  try {
    // Detect platform
    if (url.includes('music.163.com') || url.includes('163')) {
      const id = parseNeteaseId(url);
      if (!id) return NextResponse.json({ error: '无法解析网易云歌单 ID' }, { status: 400 });
      const playlist = await fetchNeteasePlaylist(id);
      return NextResponse.json({ playlist, source: 'netease' });
    }

    if (url.includes('y.qq.com') || url.includes('qq')) {
      const id = parseQQMusicId(url);
      if (!id) return NextResponse.json({ error: '无法解析 QQ 音乐歌单 ID' }, { status: 400 });
      const playlist = await fetchQQPlaylist(id);
      return NextResponse.json({ playlist, source: 'qq' });
    }

    return NextResponse.json(
      { error: '暂不支持该平台，请使用网易云或 QQ 音乐链接' },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

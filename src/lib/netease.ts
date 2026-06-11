import { SourceTrack, Playlist } from './types';

export function parseNeteaseId(input: string): string | null {
  // https://music.163.com/playlist?id=123456
  // https://music.163.com/#/playlist?id=123456
  // id=123456
  const m =
    input.match(/playlist[?/#]*.*?id[=:](\d+)/i) ||
    input.match(/id[=:](\d+)/) ||
    input.match(/^\d+$/);
  return m ? m[1] : null;
}

export function parseQQMusicId(input: string): string | null {
  // https://y.qq.com/n/ryqq/playlist/123456
  const m = input.match(/playlist[/](\d+)/) || input.match(/id[=:](\d+)/);
  return m ? m[1] : null;
}

export async function fetchNeteasePlaylist(id: string): Promise<Playlist> {
  // Use the NeteaseCloud API - try v3 playlist track all endpoint
  const res = await fetch(
    `https://music.163.com/api/v6/playlist/detail?id=${id}&n=500&s=8`,
    {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Cookie: 'os=pc;',
      },
      next: { revalidate: 60 },
    }
  );

  if (!res.ok) throw new Error(`网易云 API 请求失败: ${res.status}`);
  const data = await res.json();

  if (data.code !== 200 || !data.playlist) {
    throw new Error(data.msg ?? '获取歌单失败，请检查歌单是否公开');
  }

  const pl = data.playlist;
  const tracks: SourceTrack[] = (pl.tracks ?? []).map((t: any) => ({
    title: t.name,
    artist: (t.ar ?? []).map((a: any) => a.name).join(' / '),
    album: t.al?.name,
    duration: Math.round((t.dt ?? 0) / 1000),
  }));

  return {
    name: pl.name,
    description: pl.description ?? '',
    coverUrl: pl.coverImgUrl,
    tracks,
  };
}

export async function fetchQQPlaylist(id: string): Promise<Playlist> {
  const res = await fetch(
    `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${id}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`,
    {
      headers: {
        Referer: 'https://y.qq.com/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      next: { revalidate: 60 },
    }
  );

  if (!res.ok) throw new Error(`QQ音乐 API 请求失败: ${res.status}`);
  const data = await res.json();

  const cdList = data.cdlist?.[0];
  if (!cdList) throw new Error('获取歌单失败，请检查歌单是否公开');

  const tracks: SourceTrack[] = (cdList.songlist ?? []).map((s: any) => ({
    title: s.songname,
    artist: (s.singer ?? []).map((a: any) => a.name).join(' / '),
    album: s.albumname,
    duration: s.interval,
  }));

  return {
    name: cdList.dissname,
    description: cdList.desc ?? '',
    coverUrl: cdList.logo,
    tracks,
  };
}

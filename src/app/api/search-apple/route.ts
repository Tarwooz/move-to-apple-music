import { NextRequest, NextResponse } from 'next/server';
import { searchITunes, buildQuery, scoreMatch, verifyMatch } from '@/lib/itunes';
import { SourceTrack, TrackMatch, MatchStatus } from '@/lib/types';
import { randomUUID } from 'crypto';

const MATCH_THRESHOLD = 0.7;
const UNCERTAIN_THRESHOLD = 0.4;

async function searchTrack(track: SourceTrack): Promise<TrackMatch> {
  const query = buildQuery(track);
  const candidates = await searchITunes(query, 5);

  let status: MatchStatus = 'failed';
  let selectedCandidate = null;

  if (candidates.length > 0) {
    const scored = candidates
      .map((c) => ({ candidate: c, score: scoreMatch(track, c) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score >= MATCH_THRESHOLD && verifyMatch(track, best.candidate)) {
      status = 'matched';
      selectedCandidate = best.candidate;
    } else if (best.score >= UNCERTAIN_THRESHOLD) {
      status = 'uncertain';
      selectedCandidate = best.candidate;
    }
  }

  return { id: randomUUID(), source: track, status, candidates, selectedCandidate };
}

export async function POST(req: NextRequest) {
  const { tracks }: { tracks: SourceTrack[] } = await req.json();

  if (!tracks?.length) {
    return NextResponse.json({ error: '歌曲列表为空' }, { status: 400 });
  }

  try {
    const results = await Promise.all(tracks.map(searchTrack));
    return NextResponse.json({ matches: results });
  } catch (e: any) {
    return NextResponse.json({ error: `搜索失败: ${e.message}` }, { status: 500 });
  }
}

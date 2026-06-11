import { NextRequest, NextResponse } from 'next/server';
import { searchITunes, buildQuery, scoreMatch, verifyMatch } from '@/lib/itunes';
import { SourceTrack, TrackMatch, MatchStatus } from '@/lib/types';
import { loadCache, saveCache, loadSkippedSet, cacheKey } from '@/lib/cache';
import { randomUUID } from 'crypto';

const MATCH_THRESHOLD = 0.7;
const UNCERTAIN_THRESHOLD = 0.4;
const CONCURRENCY = 5;

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
    } else if (best.score >= UNCERTAIN_THRESHOLD || best.score >= MATCH_THRESHOLD) {
      status = 'uncertain';
      selectedCandidate = best.candidate;
    }
  }

  return { id: randomUUID(), source: track, status, candidates, selectedCandidate };
}

export async function POST(req: NextRequest) {
  const { tracks, forceRefresh }: { tracks: SourceTrack[]; forceRefresh?: boolean } = await req.json();

  if (!tracks?.length) {
    return NextResponse.json({ error: '歌曲列表为空' }, { status: 400 });
  }

  try {
    const cache = loadCache();
    const skipped = loadSkippedSet();
    const results: TrackMatch[] = [];
    const toFetch: { index: number; track: SourceTrack }[] = [];

    // Split: cache hits vs need fetching
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const key = cacheKey(track.title, track.artist);

      // Skipped set takes highest priority
      if (skipped.has(key)) {
        results[i] = { id: randomUUID(), source: track, status: 'skipped', candidates: [], selectedCandidate: null };
        continue;
      }

      const cached = cache.get(key);
      if (!forceRefresh && cached) {
        // Re-validate cached matches — downgrade if verifyMatch fails
        let status = cached.status;
        if (
          status !== 'skipped' &&
          status === 'matched' &&
          cached.selectedCandidate &&
          !verifyMatch(track, cached.selectedCandidate)
        ) {
          status = 'uncertain';
        }
        results[i] = { ...cached, status, id: randomUUID() };
      } else {
        toFetch.push({ index: i, track });
        results[i] = null as any; // placeholder
      }
    }

    // Fetch uncached tracks with rate-limit-friendly pacing
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, 5000 + Math.random() * 3000));
      const slice = toFetch.slice(i, i + CONCURRENCY);
      const batch = await Promise.all(slice.map(({ track }) => searchTrack(track)));

      for (let j = 0; j < slice.length; j++) {
        const { index, track } = slice[j];
        const match = batch[j];
        results[index] = match;
        // Write to cache regardless of status so we don't re-query failed ones either
        cache.set(cacheKey(track.title, track.artist), match);
      }
    }

    // Persist updated cache if we fetched anything new
    if (toFetch.length > 0) saveCache(cache);

    return NextResponse.json({
      matches: results,
      cacheHits: tracks.length - toFetch.length,
      fetched: toFetch.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `搜索失败: ${e.message}` }, { status: 500 });
  }
}

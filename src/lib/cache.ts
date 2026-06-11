import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { TrackMatch, SourceTrack } from './types';

const CACHE_PATH = resolve(process.cwd(), 'matched.json');
const SKIPPED_PATH = resolve(process.cwd(), 'skipped.json');

function cacheKey(title: string, artist: string): string {
  return `${title.trim().toLowerCase()}|||${artist.trim().toLowerCase()}`;
}

export function loadCache(): Map<string, TrackMatch> {
  try {
    const raw = readFileSync(CACHE_PATH, 'utf-8');
    const { matches } = JSON.parse(raw) as { matches: TrackMatch[] };
    const map = new Map<string, TrackMatch>();
    for (const m of matches) {
      map.set(cacheKey(m.source.title, m.source.artist), m);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function saveCache(cache: Map<string, TrackMatch>): void {
  const matches = Array.from(cache.values());
  writeFileSync(CACHE_PATH, JSON.stringify({ matches }, null, 4), 'utf-8');
}

export function loadSkippedSet(): Set<string> {
  try {
    const raw = readFileSync(SKIPPED_PATH, 'utf-8');
    const { skipped } = JSON.parse(raw) as { skipped: SourceTrack[] };
    const set = new Set<string>();
    for (const t of skipped) {
      set.add(cacheKey(t.title, t.artist));
    }
    return set;
  } catch {
    return new Set();
  }
}

export { cacheKey };

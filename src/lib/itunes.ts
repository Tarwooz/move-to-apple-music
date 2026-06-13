import { AppleMusicTrack, SourceTrack, TrackMatch, MatchStatus } from './types';

const ITUNES_API = 'https://itunes.apple.com/search';
const MATCH_THRESHOLD = 0.7;
const UNCERTAIN_THRESHOLD = 0.4;

export async function searchITunes(
  query: string,
  limit = 5
): Promise<AppleMusicTrack[]> {
  const params = new URLSearchParams({
    term: query,
    media: 'music',
    entity: 'song',
    limit: String(limit),
    country: 'CN',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${ITUNES_API}?${params}`, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function buildQuery(track: SourceTrack): string {
  const stripBrackets = (s: string) => s.replace(/[\(（][^)）]*[\)）]/g, '').trim();
  return `${stripBrackets(track.title)} ${track.artist}`;
}

export function verifyMatch(source: SourceTrack, candidate: AppleMusicTrack): boolean {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/[\(（][^)）]*[\)）]/g, '')
      .replace(/[^\w一-鿿]/g, '')
      .trim();

  const srcTitle = norm(source.title);
  const srcArtist = norm(source.artist);
  const candTitle = norm(candidate.trackName);
  const candArtist = norm(candidate.artistName);

  const titleOk = srcTitle.includes(candTitle) || candTitle.includes(srcTitle);
  const srcArtistParts = source.artist.split(/[/／,、&]/).map((p) => norm(p.trim()));
  const artistOk =
    srcArtist.includes(candArtist) ||
    candArtist.includes(srcArtist) ||
    srcArtistParts.some((p) => p && (p.includes(candArtist) || candArtist.includes(p)));

  return titleOk && artistOk;
}

export function scoreMatch(source: SourceTrack, candidate: AppleMusicTrack): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, '').trim();

  const srcTitle = normalize(source.title);
  const srcArtist = normalize(source.artist);
  const candTitle = normalize(candidate.trackName);
  const candArtist = normalize(candidate.artistName);

  let score = 0;

  if (candTitle.includes(srcTitle) || srcTitle.includes(candTitle)) score += 0.5;
  else {
    const titleWords = srcTitle.split(' ');
    const matched = titleWords.filter((w) => candTitle.includes(w)).length;
    score += (matched / titleWords.length) * 0.5;
  }

  if (candArtist.includes(srcArtist) || srcArtist.includes(candArtist)) score += 0.5;
  else {
    const artistWords = srcArtist.split(' ');
    const matched = artistWords.filter((w) => candArtist.includes(w)).length;
    score += (matched / Math.max(artistWords.length, 1)) * 0.4;
  }

  return Math.min(score, 1);
}

export async function searchTrack(track: SourceTrack): Promise<TrackMatch> {
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

  const id = crypto.randomUUID();

  return { id, source: track, status, candidates, selectedCandidate };
}

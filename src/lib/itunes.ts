import { AppleMusicTrack, SourceTrack } from './types';

const ITUNES_API = 'https://itunes.apple.com/search';

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
    const res = await fetch(`${ITUNES_API}?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
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
  return `${track.artist} ${stripBrackets(track.title)}`;
}

// Strict check: title and artist must both have significant overlap (after stripping brackets)
export function verifyMatch(source: SourceTrack, candidate: AppleMusicTrack): boolean {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/[\(（][^)）]*[\)）]/g, '') // strip brackets
      .replace(/[^\w一-鿿]/g, '')  // keep alphanumeric + CJK
      .trim();

  const srcTitle = norm(source.title);
  const srcArtist = norm(source.artist);
  const candTitle = norm(candidate.trackName);
  const candArtist = norm(candidate.artistName);

  const titleOk = srcTitle.includes(candTitle) || candTitle.includes(srcTitle);
  // Artist may be "A / B" (featuring), check each part
  const srcArtistParts = source.artist.split(/[/／,、&]/).map((p) => norm(p.trim()));
  const artistOk =
    srcArtist.includes(candArtist) ||
    candArtist.includes(srcArtist) ||
    srcArtistParts.some((p) => p && (p.includes(candArtist) || candArtist.includes(p)));

  return titleOk && artistOk;
}

// Score how well an iTunes result matches source track (0-1)
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

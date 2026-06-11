export interface SourceTrack {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // seconds
}

export type MatchStatus = 'matched' | 'uncertain' | 'failed' | 'manual' | 'skipped';

export interface AppleMusicTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  trackTimeMillis: number;
  previewUrl?: string;
  artworkUrl100?: string;
}

export interface TrackMatch {
  id: string;
  source: SourceTrack;
  status: MatchStatus;
  candidates: AppleMusicTrack[];
  selectedCandidate: AppleMusicTrack | null;
  aiSuggestion?: string; // AI suggested search query
  note?: string;
}

export interface Playlist {
  name: string;
  description?: string;
  tracks: SourceTrack[];
  coverUrl?: string;
}

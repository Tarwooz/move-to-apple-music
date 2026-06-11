import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { SourceTrack } from '@/lib/types';

const SKIPPED_PATH = resolve(process.cwd(), 'skipped.json');

function loadSkipped(): SourceTrack[] {
  try {
    const raw = readFileSync(SKIPPED_PATH, 'utf-8');
    return JSON.parse(raw).skipped ?? [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const { tracks }: { tracks: SourceTrack[] } = await req.json();

  if (!tracks?.length) {
    return NextResponse.json({ error: '没有跳过的歌曲' }, { status: 400 });
  }

  try {
    const existing = loadSkipped();
    // Deduplicate by title+artist
    const seen = new Set(existing.map((t) => `${t.title}|||${t.artist}`));
    const newTracks = tracks.filter((t) => !seen.has(`${t.title}|||${t.artist}`));
    const merged = [...existing, ...newTracks];
    writeFileSync(SKIPPED_PATH, JSON.stringify({ skipped: merged }, null, 4), 'utf-8');
    return NextResponse.json({ saved: newTracks.length, total: merged.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

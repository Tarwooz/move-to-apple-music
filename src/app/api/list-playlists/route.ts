import { NextResponse } from 'next/server';
import { listUserPlaylists } from '@/lib/applescript';

export async function GET() {
  try {
    const playlists = await listUserPlaylists();
    return NextResponse.json({ playlists });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

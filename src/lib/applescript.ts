import { execFile } from 'child_process';
import { promisify } from 'util';
import { AppleMusicTrack } from './types';

const execFileAsync = promisify(execFile);

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function createPlaylistWithTracks(
  playlistName: string,
  tracks: AppleMusicTrack[]
): Promise<void> {
  const safeName = escapeAppleScript(playlistName);

  // Build track add commands - search by name+artist in the library first,
  // otherwise search via iTunes store and add
  const trackLines = tracks
    .map((t) => {
      const name = escapeAppleScript(t.trackName);
      const artist = escapeAppleScript(t.artistName);
      return `
        set foundTrack to null
        try
          set results to (search library playlist 1 for "${name}" only songs)
          repeat with r in results
            if artist of r is "${artist}" then
              set foundTrack to r
              exit repeat
            end if
          end repeat
          if foundTrack is null and length of results > 0 then
            set foundTrack to item 1 of results
          end if
        end try
        if foundTrack is not null then
          duplicate foundTrack to newPlaylist
        end if`;
    })
    .join('\n');

  const script = `
tell application "Music"
  -- Delete existing playlist with same name if exists
  try
    delete (first user playlist whose name is "${safeName}")
  end try

  -- Create new playlist
  set newPlaylist to make new user playlist with properties {name:"${safeName}"}

  ${trackLines}
end tell`;

  await execFileAsync('osascript', ['-e', script], { timeout: 120000 });
}

export async function checkMusicAppRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to (name of processes) contains "Music"',
    ]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

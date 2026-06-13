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

export async function listUserPlaylists(): Promise<{ name: string; trackCount: number }[]> {
  const script = `
tell application "Music"
  set output to ""
  repeat with pl in (every user playlist)
    set output to output & (name of pl) & "|||" & (count of tracks of pl) & "\n"
  end repeat
  return output
end tell`;
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 30000 });
  return stdout
    .trim()
    .split('\n')
    .filter((l) => l.includes('|||'))
    .map((l) => {
      const [name, countStr] = l.split('|||');
      return { name: name.trim(), trackCount: parseInt(countStr.trim(), 10) || 0 };
    });
}

export async function mergePlaylistsInto(sourceNames: string[], targetName: string): Promise<number> {
  const safeName = escapeAppleScript(targetName);
  const blocks = sourceNames
    .map((src) => {
      const s = escapeAppleScript(src);
      return `
  try
    repeat with t in (every track of (first user playlist whose name is "${s}"))
      duplicate t to newPL
      set merged to merged + 1
    end repeat
  end try`;
    })
    .join('\n');

  const script = `
tell application "Music"
  try
    delete (first user playlist whose name is "${safeName}")
  end try
  set newPL to make new user playlist with properties {name:"${safeName}"}
  set merged to 0
  ${blocks}
  return merged
end tell`;

  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 180000 });
  return parseInt(stdout.trim(), 10) || 0;
}

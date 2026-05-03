import type { EntryRow } from './types';

export async function recentArtistsForUser(
  db: D1Database,
  spotifyId: string,
  limit = 3
): Promise<string[]> {
  const result = await db
    .prepare(
      'SELECT artists_used FROM entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .bind(spotifyId, limit)
    .all<{ artists_used: string }>();

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of result.results ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.artists_used);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const name of parsed) {
      if (typeof name === 'string' && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

export interface InsertEntryInput {
  id: string;
  userId: string;
  userDisplay: string;
  inputType: 'photo' | 'text';
  inputText: string | null;
  coffeeSummary: string;
  vibeSummary: string;
  playlistName: string;
  playlistDesc: string;
  playlistId: string;
  artistsUsed: string[];
}

export async function insertEntry(db: D1Database, e: InsertEntryInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entries (id, user_id, user_display, input_type, input_text,
        coffee_summary, vibe_summary, playlist_name, playlist_desc, playlist_id, artists_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      e.id,
      e.userId,
      e.userDisplay,
      e.inputType,
      e.inputText,
      e.coffeeSummary,
      e.vibeSummary,
      e.playlistName,
      e.playlistDesc,
      e.playlistId,
      JSON.stringify(e.artistsUsed)
    )
    .run();
}

export async function getFeed(db: D1Database, limit = 50): Promise<EntryRow[]> {
  const result = await db
    .prepare(
      `SELECT id, user_id, user_display, created_at, input_type, input_text,
        coffee_summary, vibe_summary, playlist_name, playlist_desc, playlist_id, artists_used
       FROM entries ORDER BY created_at DESC LIMIT ?`
    )
    .bind(limit)
    .all<EntryRow>();
  return result.results ?? [];
}

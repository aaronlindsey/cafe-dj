import type { ResolvedTrack } from './types';

export interface CurateInput {
  direct: (ResolvedTrack | null)[];
  fromArtists: ResolvedTrack[];
  cap: number;
}

export function curate({ direct, fromArtists, cap }: CurateInput): ResolvedTrack[] {
  const seen = new Set<string>();
  let lastArtist: string | null = null;
  const result: ResolvedTrack[] = [];

  function tryAdd(item: ResolvedTrack | null) {
    if (!item) return;
    if (result.length >= cap) return;
    if (seen.has(item.uri)) return;
    if (item.artistId === lastArtist) return;
    seen.add(item.uri);
    lastArtist = item.artistId;
    result.push(item);
  }

  for (const item of direct) tryAdd(item);
  for (const item of shuffle(fromArtists)) {
    if (result.length >= cap) break;
    tryAdd(item);
  }

  if (result.length < cap) {
    lastArtist = null;
    for (const item of fromArtists) {
      if (result.length >= cap) break;
      if (!seen.has(item.uri)) {
        seen.add(item.uri);
        result.push(item);
      }
    }
  }

  return result.slice(0, cap);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function uniqueArtistNames(tracks: ResolvedTrack[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tracks) {
    if (!seen.has(t.artistName)) {
      seen.add(t.artistName);
      out.push(t.artistName);
    }
  }
  return out;
}

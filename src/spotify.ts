import type { ResolvedTrack, SuggestedTrack } from './types';

const API = 'https://api.spotify.com/v1';

async function spotifyRequest(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  return res;
}

export async function spotifyGet<T>(path: string, token: string): Promise<T> {
  const res = await spotifyRequest(path, token);
  if (!res.ok) {
    throw new Error(`Spotify GET ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function spotifyPost<T>(
  path: string,
  token: string,
  body: unknown
): Promise<T> {
  const res = await spotifyRequest(path, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Spotify POST ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: { id: string; name: string }[];
}

export async function getMe(token: string): Promise<{ id: string; display_name: string | null }> {
  return spotifyGet<{ id: string; display_name: string | null }>('/me', token);
}

export async function searchTrack(
  t: SuggestedTrack,
  token: string
): Promise<ResolvedTrack | null> {
  const cleanTitle = t.title.replace(/"/g, '').trim();
  const cleanArtist = t.artist.replace(/"/g, '').trim();
  if (!cleanTitle || !cleanArtist) return null;
  const q = `track:"${cleanTitle}" artist:"${cleanArtist}"`;
  const url = `/search?q=${encodeURIComponent(q)}&type=track&limit=1`;
  try {
    const res = await spotifyGet<{
      tracks?: { items?: SpotifyTrack[] };
    }>(url, token);
    const item = res.tracks?.items?.[0];
    if (!item) return null;
    return {
      uri: item.uri,
      artistId: item.artists[0].id,
      artistName: item.artists[0].name,
    };
  } catch {
    return null;
  }
}

export async function searchArtistTopTracks(
  name: string,
  token: string,
  n: number
): Promise<ResolvedTrack[]> {
  const cleanName = name.replace(/"/g, '').trim();
  if (!cleanName) return [];
  try {
    const found = await spotifyGet<{ artists?: { items?: SpotifyArtist[] } }>(
      `/search?q=${encodeURIComponent(`artist:"${cleanName}"`)}&type=artist&limit=1`,
      token
    );
    const a = found.artists?.items?.[0];
    if (!a) return [];
    const top = await spotifyGet<{ tracks: SpotifyTrack[] }>(
      `/artists/${a.id}/top-tracks?market=US`,
      token
    );
    return top.tracks.slice(0, n).map((t) => ({
      uri: t.uri,
      artistId: a.id,
      artistName: a.name,
    }));
  } catch {
    return [];
  }
}

export async function createPlaylist(
  token: string,
  name: string,
  description: string,
  isPublic: boolean
): Promise<{ id: string }> {
  return spotifyPost<{ id: string }>('/me/playlists', token, {
    name,
    description,
    public: isPublic,
  });
}

export async function addTracksToPlaylist(
  playlistId: string,
  token: string,
  uris: string[]
): Promise<void> {
  if (uris.length === 0) return;
  await spotifyPost(`/playlists/${playlistId}/items`, token, { uris });
}

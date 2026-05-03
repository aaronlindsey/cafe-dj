export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  GEMINI_API_KEY: string;
  SESSION_SECRET: string;
}

export interface Session {
  spotifyId: string;
}

export interface UserRow {
  spotify_id: string;
  display_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface EntryRow {
  id: string;
  user_id: string;
  user_display: string;
  created_at: number;
  input_type: 'photo' | 'text';
  input_text: string | null;
  coffee_summary: string;
  vibe_summary: string;
  playlist_name: string;
  playlist_desc: string;
  playlist_id: string;
  artists_used: string;
}

export interface SuggestedTrack {
  title: string;
  artist: string;
}

export interface PlaylistPlan {
  coffeeSummary: string;
  vibeSummary: string;
  playlistName: string;
  playlistDescription: string;
  suggestedArtists: string[];
  suggestedTracks: SuggestedTrack[];
}

export interface ResolvedTrack {
  uri: string;
  artistId: string;
  artistName: string;
}

export type Variables = {
  session: Session;
};

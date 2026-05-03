CREATE TABLE IF NOT EXISTS users (
  spotify_id      TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS entries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(spotify_id),
  user_display    TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  input_type      TEXT NOT NULL,
  input_text      TEXT,
  coffee_summary  TEXT NOT NULL,
  vibe_summary    TEXT NOT NULL,
  playlist_name   TEXT NOT NULL,
  playlist_desc   TEXT NOT NULL,
  playlist_id     TEXT NOT NULL,
  artists_used    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_user_id    ON entries (user_id);

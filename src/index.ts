import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  callback,
  getValidToken,
  login,
  logout,
  requireSession,
} from './auth';
import {
  addTracksToPlaylist,
  createPlaylist,
  getMe,
  getTopArtists,
  searchArtistTopTracks,
  searchTrack,
} from './spotify';
import { buildContextBlock, callGemini, SYSTEM_PROMPT } from './gemini';
import { curate, uniqueArtistNames } from './curate';
import { getFeed, insertEntry, recentArtistsForUser } from './db';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/auth/login', login);
app.get('/auth/callback', callback);
app.post('/auth/logout', logout);
app.get('/auth/logout', logout);

app.get('/api/me', requireSession, async (c) => {
  const { spotifyId } = c.get('session');
  const user = await c.env.DB.prepare(
    'SELECT spotify_id, display_name FROM users WHERE spotify_id = ?'
  )
    .bind(spotifyId)
    .first<{ spotify_id: string; display_name: string }>();
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ spotifyId: user.spotify_id, displayName: user.display_name });
});

app.get('/api/feed', async (c) => {
  const rows = await getFeed(c.env.DB, 50);
  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userDisplay: r.user_display,
      createdAt: r.created_at,
      inputType: r.input_type,
      inputText: r.input_text,
      coffeeSummary: r.coffee_summary,
      vibeSummary: r.vibe_summary,
      playlistName: r.playlist_name,
      playlistDesc: r.playlist_desc,
      playlistId: r.playlist_id,
    })),
  });
});

interface GenerateBody {
  inputType: 'photo' | 'text';
  text?: string;
  image?: string;
  imageMime?: string;
}

app.post('/api/generate', requireSession, async (c) => {
  const { spotifyId } = c.get('session');
  let body: GenerateBody;
  try {
    body = await c.req.json<GenerateBody>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  if (body.inputType === 'photo' && !body.image) {
    return c.json({ error: 'photo input requires image' }, 400);
  }
  if (body.inputType === 'text' && !(body.text && body.text.trim())) {
    return c.json({ error: 'text input requires text' }, 400);
  }

  try {
    const token = await getValidToken(c.env, spotifyId);

    const [topArtists, recentExclusions] = await Promise.all([
      getTopArtists(token),
      recentArtistsForUser(c.env.DB, spotifyId, 3),
    ]);

    const userParts =
      body.inputType === 'photo'
        ? [
            {
              inlineData: {
                mimeType: body.imageMime || 'image/jpeg',
                data: body.image!,
              },
            },
            {
              text: buildContextBlock({
                topArtists: topArtists.map((a) => a.name),
                recentExclusions,
              }),
            },
          ]
        : [
            { text: `Free-form description of the coffee: ${body.text}` },
            {
              text: buildContextBlock({
                topArtists: topArtists.map((a) => a.name),
                recentExclusions,
              }),
            },
          ];

    const plan = await callGemini(c.env, userParts, SYSTEM_PROMPT);

    const [trackResolutions, artistTrackBundles] = await Promise.all([
      Promise.all(plan.suggestedTracks.map((t) => searchTrack(t, token))),
      Promise.all(
        plan.suggestedArtists.map((a) => searchArtistTopTracks(a, token, 3))
      ),
    ]);

    const finalTracks = curate({
      direct: trackResolutions,
      fromArtists: artistTrackBundles.flat(),
      cap: 12,
    });

    if (finalTracks.length === 0) {
      return c.json(
        { error: 'no_tracks_resolved', message: 'No tracks resolved on Spotify. Try again.' },
        502
      );
    }

    const me = await getMe(token);
    const playlist = await createPlaylist(
      token,
      plan.playlistName,
      plan.playlistDescription,
      true
    );
    await addTracksToPlaylist(playlist.id, token, finalTracks.map((t) => t.uri));

    const id = nanoid();
    const artistsUsed = uniqueArtistNames(finalTracks);

    await insertEntry(c.env.DB, {
      id,
      userId: spotifyId,
      userDisplay: me.display_name ?? me.id,
      inputType: body.inputType,
      inputText: body.inputType === 'text' ? body.text ?? null : null,
      coffeeSummary: plan.coffeeSummary,
      vibeSummary: plan.vibeSummary,
      playlistName: plan.playlistName,
      playlistDesc: plan.playlistDescription,
      playlistId: playlist.id,
      artistsUsed,
    });

    return c.json({
      entryId: id,
      playlistId: playlist.id,
      coffeeSummary: plan.coffeeSummary,
      vibeSummary: plan.vibeSummary,
      playlistName: plan.playlistName,
      playlistDescription: plan.playlistDescription,
      trackCount: finalTracks.length,
    });
  } catch (err) {
    console.error('generate error:', err);
    const message = err instanceof Error ? err.message : 'unknown error';
    return c.json({ error: 'generation_failed', message }, 500);
  }
});

app.onError((err, c) => {
  console.error('unhandled:', err);
  return c.json({ error: 'server_error', message: err.message }, 500);
});

export default app;

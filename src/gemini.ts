import type { Env, PlaylistPlan } from './types';

export const SYSTEM_PROMPT = `You are a coffee-and-music sommelier with a slightly unhinged sense of humor.
Given coffee details and the listener's recent music taste, you produce a
short Spotify playlist plan (10-12 tracks) that fits the coffee's vibe and
is slightly tailored to the listener's taste.

How to translate coffee → music:
- Bright/floral/citrus notes → airy, melodic, higher tempo
- Dark/syrupy/smoky/heavy notes → moody, slow, heavier textures
- Fruity/funky/unusual notes → playful, psychedelic, off-kilter
- Light roast → more sparse and acoustic-leaning
- Dark roast → more dense, bass-forward, atmospheric

How to use the listener's taste:
- The playlist should be MOSTLY based on the coffee vibe, with only *slight*
  modifications according to the listener's taste.
- In a playlist of 10-12 tracks, 2–4 should be personalized from the listener's
  profile. Choose tracks from the listener's profile which match vibe of the
  rest of the playlist. Mix these in randomly—don't put them all at the beginning.
- You will be given the listeners top genres and top artists.
- Avoid recently-suggested artists (you'll be told which).

How to NAME the playlist:
- Names should ALWAYS begin with coffee emoji (☕️).
- The listener loves PUNS, dad humor, and weird/random humor.
- Examples of the energy we want: "☕️ Tuesday Morning Yirgacheffe Crisis",
  "☕️ Espresso Yourself", "☕️ Brewmaster Flash", "☕️ Bean There, Drank That",
  "☕️ A Roast With The Most", "☕️ The Grindset Mindset". Lean into it.
- Description should be one weird sentence (10-20 words).

Output rules:
- 10-12 track suggestions, named track + named artist, both real.
- 6-10 artist suggestions in case track names hallucinate.
- If you're not sure a song actually exists, leave it out.
- coffeeSummary: 1 short factual sentence describing the coffee. It should begin
  with the name of the roaster and coffee (if provided). For example: "Dapper &
  Wise Stag Espresso Blend: A robust dark roast coffee with notes of molasses,
  graham cracker, and bourbon."
- vibeSummary: 1 evocative sentence describing the pairing's mood.`;

export const PLAYLIST_SCHEMA = {
  type: 'object',
  properties: {
    coffeeSummary: { type: 'string' },
    vibeSummary: { type: 'string' },
    playlistName: { type: 'string' },
    playlistDescription: { type: 'string' },
    suggestedArtists: {
      type: 'array',
      items: { type: 'string' },
      minItems: 6,
      maxItems: 10,
    },
    suggestedTracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          artist: { type: 'string' },
        },
        required: ['title', 'artist'],
      },
      minItems: 10,
      maxItems: 12,
    },
  },
  required: [
    'coffeeSummary',
    'vibeSummary',
    'playlistName',
    'playlistDescription',
    'suggestedArtists',
    'suggestedTracks',
  ],
};

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

const MODEL = 'gemini-3-flash-preview';

export async function callGemini(
  env: Env,
  userParts: Part[],
  systemPrompt: string
): Promise<PlaylistPlan> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: userParts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: PLAYLIST_SCHEMA,
        temperature: 0.9,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini call failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return JSON.parse(text) as PlaylistPlan;
}

export interface ContextBlockInput {
  topGenres: string[];
  topArtists: string[];
  topTracks: { title: string; artist: string }[];
  recentExclusions: string[];
}

export function buildContextBlock(input: ContextBlockInput): string {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const month = now.getMonth();
  const season =
    month <= 1 || month === 11
      ? 'winter'
      : month <= 4
      ? 'spring'
      : month <= 7
      ? 'summer'
      : 'fall';

  const tracksLine = input.topTracks
    .slice(0, 6)
    .map((t) => `${t.title} — ${t.artist}`)
    .join('; ');

  return `LISTENER PROFILE:
- Top genres (most → least): ${input.topGenres.join(', ') || '(unknown)'}
- Top artists: ${input.topArtists.join(', ') || '(unknown)'}
- Recent listening leans toward: ${tracksLine || '(unknown)'}

CONTEXT:
- Local time: ${day} ${time}
- Season: ${season}

RECENTLY-SUGGESTED ARTISTS TO AVOID (the listener has had these in playlists already; pick fresh ones):
${input.recentExclusions.length ? input.recentExclusions.join(', ') : '(none yet)'}`;
}

export function aggregateGenres(
  artists: { genres?: string[] }[],
  limit = 10
): string[] {
  const counts = new Map<string, number>();
  for (const a of artists) {
    for (const g of a.genres ?? []) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([g]) => g);
}

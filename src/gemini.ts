import type { Env, PlaylistPlan } from './types';

export const SYSTEM_PROMPT = `You are a coffee-and-music sommelier with a slightly unhinged sense of humor.
Given coffee details and details about the listener, you produce a
short Spotify playlist plan (10-12 tracks) that fits the coffee's vibe.

How to translate coffee → music:
- Bright/floral/citrus notes → airy, melodic, higher tempo
- Dark/syrupy/smoky/heavy notes → moody, slow, heavier textures
- Fruity/funky/unusual notes → playful, psychedelic, off-kilter
- Light roast → more sparse and acoustic-leaning
- Dark roast → more dense, bass-forward, atmospheric
- Hawaiian/Kona → relaxed, island vibes

How to choose tracks:
- Lean heavier on the instrumental tracks and lighter on the vocals.
- Ideally incorporate multiple genres.

How to use the listener's taste:
- The playlist should be MOSTLY based on the coffee vibe, with only *slight*
  modifications according to the listener's taste.
- In a playlist of 10-12 tracks, AT MOST 1-4 should be personalized from the
  listener's profile.
- Tracks from the listener's profile MUST fit the vibe of the rest of the
  playlist.
- It's perfectly OK to not add any personalized tracks if they don't match the
  vibe.
- If added, personalized tracks should be mixed throughout the playlist.
- You will be given the listeners top artists.
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
  topArtists: string[];
  recentExclusions: string[];
}

export function buildContextBlock(input: ContextBlockInput): string {
  return `LISTENER PROFILE:
- Top artists: ${input.topArtists.join(', ') || '(unknown)'}

RECENTLY-SUGGESTED ARTISTS TO AVOID (the listener has had these in playlists already; pick fresh ones):
${input.recentExclusions.length ? input.recentExclusions.join(', ') : '(none yet)'}`;
}

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Session, UserRow, Variables } from './types';

const SCOPES = 'user-top-read playlist-modify-public playlist-modify-private';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

function redirectUri(c: AppContext): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}/auth/callback`;
}

export async function login(c: AppContext) {
  const state = crypto.randomUUID();
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: c.req.url.startsWith('https://'),
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(c),
    scope: SCOPES,
    state,
    show_dialog: 'false',
  });
  return c.redirect(`https://accounts.spotify.com/authorize?${params}`);
}

export async function callback(c: AppContext) {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const stateCookie = getCookie(c, 'oauth_state');
  if (!code || !state || state !== stateCookie) {
    return c.text('Invalid OAuth state', 400);
  }

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + btoa(`${c.env.SPOTIFY_CLIENT_ID}:${c.env.SPOTIFY_CLIENT_SECRET}`),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(c),
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return c.text(`Token exchange failed: ${text}`, 502);
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  };
  console.log('spotify granted scopes:', tokens.scope);

  const meRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) {
    const text = await meRes.text();
    return c.text(`Profile lookup failed: ${text}`, 502);
  }
  const me = (await meRes.json()) as { id: string; display_name: string | null };

  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
  await c.env.DB.prepare(
    `INSERT INTO users (spotify_id, display_name, access_token, refresh_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(spotify_id) DO UPDATE SET
       display_name = excluded.display_name,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = unixepoch()`
  )
    .bind(
      me.id,
      me.display_name ?? me.id,
      tokens.access_token,
      tokens.refresh_token,
      expiresAt
    )
    .run();

  const session = await signSession({ spotifyId: me.id }, c.env.SESSION_SECRET);
  setCookie(c, 'session', session, {
    httpOnly: true,
    secure: c.req.url.startsWith('https://'),
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  deleteCookie(c, 'oauth_state', { path: '/' });
  return c.redirect('/');
}

export function logout(c: AppContext) {
  deleteCookie(c, 'session', { path: '/' });
  return c.redirect('/');
}

export const requireSession: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> =
  async (c, next) => {
    const cookie = getCookie(c, 'session');
    if (!cookie) return c.json({ error: 'unauthorized' }, 401);
    const session = await verifySession(cookie, c.env.SESSION_SECRET);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    c.set('session', session);
    await next();
  };

export async function getValidToken(env: Env, spotifyId: string): Promise<string> {
  const user = await env.DB.prepare('SELECT * FROM users WHERE spotify_id = ?')
    .bind(spotifyId)
    .first<UserRow>();
  if (!user) throw new Error('user not found');
  if (user.expires_at - Math.floor(Date.now() / 1000) > 60) return user.access_token;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' + btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: user.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const t = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  const expiresAt = Math.floor(Date.now() / 1000) + t.expires_in;
  const newRefresh = t.refresh_token ?? user.refresh_token;
  await env.DB.prepare(
    'UPDATE users SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = unixepoch() WHERE spotify_id = ?'
  )
    .bind(t.access_token, newRefresh, expiresAt, spotifyId)
    .run();
  return t.access_token;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signSession(payload: Session, secret: string): Promise<string> {
  const body = btoa(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifySession(
  raw: string,
  secret: string
): Promise<Session | null> {
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    return JSON.parse(atob(body)) as Session;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

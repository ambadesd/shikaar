/**
 * Shikaar — Reddit source adapter
 *
 * PRD §6.2  This runs server-side ONLY. The browser never talks to Reddit.
 * PRD §6.3  Path 1 (public .json) and Path 2 (OAuth app-only) live behind one
 *           swappable module. Set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET and
 *           this file silently upgrades to Path 2. No frontend change.
 * PRD §6.4  Every result is normalised to the source-agnostic internal schema.
 * PRD FR-5  Text posts are dropped here, server-side. They never reach the client.
 */

const DEFAULT_UA =
  'web:shikaar:1.0.0 (image discovery; set SHIKAAR_USER_AGENT to your own contact)';
const UA = process.env.SHIKAAR_USER_AGENT || DEFAULT_UA;

export const SORTS = ['relevance', 'new', 'top', 'hot', 'comments'];
export const TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'];

const SUB_RE = /^[A-Za-z0-9_]{2,25}$/;        // PRD §7 Security: whitelist inbound params
const IMG_EXT = /\.(jpe?g|png|gif|webp)(\?|$)/i;
const MAX_SUBS = 12;
const REQ_TIMEOUT_MS = Number(process.env.SHIKAAR_TIMEOUT_MS || 9000);

/* ------------------------------------------------------------------ *
 * FR-12  Short-lived in-process cache. Reduces repeat load on Reddit
 *        and keeps us under rate limits during rapid re-searching.
 * ------------------------------------------------------------------ */
const TTL_MS = Number(process.env.SHIKAAR_CACHE_TTL_MS || 120_000);
const CACHE_MAX = 300;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  cache.delete(key); cache.set(key, hit);          // LRU touch
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + TTL_MS });
}

/* ------------------------------------------------------------------ *
 * PRD §6.3 Path 2 — application-only OAuth token, cached until expiry.
 * ------------------------------------------------------------------ */
let token = { value: null, expires: 0 };

async function getAppToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;                 // → Path 1
  if (token.value && Date.now() < token.expires) return token.value;

  const res = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`OAuth token request failed (${res.status})`);

  const json = await res.json();
  token = {
    value: json.access_token,
    expires: Date.now() + Math.max(60, (json.expires_in || 3600) - 60) * 1000,
  };
  return token.value;
}

export async function sourceMode() {
  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) return 'public';
  try { return (await getAppToken()) ? 'oauth' : 'public'; } catch { return 'public'; }
}

/* ------------------------------------------------------------------ */

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

const dec = (u = '') => String(u).replace(/&amp;/g, '&');

/**
 * Pull every image URL out of a post.
 * PRD §3.3 Non-goal: no computer vision. This is pure post-metadata inspection —
 * is it an image post, is it a gallery, how many frames does it carry.
 */
function extractImages(d) {
  // 1. Native multi-image gallery
  if (d.is_gallery && d.media_metadata) {
    const order =
      d.gallery_data?.items?.map((i) => i.media_id) || Object.keys(d.media_metadata);
    const out = [];
    for (const id of order) {
      const m = d.media_metadata[id];
      if (!m || m.status !== 'valid') continue;
      const src = m.s?.u || m.s?.gif || m.p?.[m.p.length - 1]?.u;
      if (src) out.push(dec(src));
    }
    if (out.length) return out;
  }

  // 2. Direct image link (i.redd.it, i.imgur.com, …)
  const direct = d.url_overridden_by_dest || d.url;
  if (direct && IMG_EXT.test(direct)) return [dec(direct)];

  // 3. Reddit-generated preview (crossposts, some third-party hosts)
  if (d.post_hint === 'image' || d.post_hint === 'rich:video') {
    const src = d.preview?.images?.[0]?.source?.u || d.preview?.images?.[0]?.source?.url;
    if (src) return [dec(src)];
  }

  return [];
}

/** Grid-sized thumbnail so a 40-frame sheet doesn't pull 40 full-res photos. */
function pickThumb(d, images) {
  const TARGET = 640;

  if (d.is_gallery && d.media_metadata) {
    const first = d.gallery_data?.items?.[0]?.media_id;
    const p = first && d.media_metadata[first]?.p;
    if (p?.length) {
      const best = p.find((r) => r.x >= TARGET) || p[p.length - 1];
      if (best?.u) return dec(best.u);
    }
  }

  const res = d.preview?.images?.[0]?.resolutions;
  if (res?.length) {
    const best = res.find((r) => r.x >= TARGET) || res[res.length - 1];
    if (best?.u) return dec(best.u);
  }

  return images[0];
}

/** Aspect ratio lets the grid reserve space before the image loads (no reflow jump). */
function pickRatio(d) {
  const s = d.preview?.images?.[0]?.source;
  if (s?.width && s?.height) return +(s.height / s.width).toFixed(4);
  if (d.is_gallery && d.media_metadata) {
    const first = d.gallery_data?.items?.[0]?.media_id;
    const m = first && d.media_metadata[first]?.s;
    if (m?.x && m?.y) return +(m.y / m.x).toFixed(4);
  }
  return 1.25;
}

/** PRD §6.4 — the one shape the frontend understands, whatever the source. */
function normalise(child) {
  const d = child?.data;
  if (!d) return null;
  if (d.is_self) return null;                       // FR-5: text post, drop it
  if (d.stickied || d.removed_by_category) return null;

  const images = extractImages(d);
  if (!images.length) return null;                  // FR-5: no photo, not a result

  return {
    id: d.name,                                     // t3_xxxxx — de-dup key (FR-4)
    title: d.title || '(untitled)',
    source: `reddit:${d.subreddit}`,
    subreddit: d.subreddit,
    author: d.author,
    thumb: pickThumb(d, images),
    images,
    count: images.length,                           // drives gallery badge + FR-6
    ratio: pickRatio(d),
    score: d.score ?? 0,
    comments: d.num_comments ?? 0,
    created: d.created_utc,
    flair: d.link_flair_text || null,
    nsfw: Boolean(d.over_18),
    link: `https://www.reddit.com${d.permalink}`,    // FR-9: always link out
  };
}

/* ------------------------------------------------------------------ */

async function searchOne(sub, { q, sort, t, limit }, bearer) {
  const authed = Boolean(bearer);
  const host = authed ? 'https://oauth.reddit.com' : 'https://www.reddit.com';

  const p = new URLSearchParams({ limit: String(limit), raw_json: '1' });
  let path;

  if (q) {
    path = `/r/${sub}/search`;
    p.set('q', q);
    p.set('restrict_sr', '1');
    p.set('sort', sort);
    p.set('t', t);
    p.set('type', 'link');
    p.set('include_over_18', 'on');
  } else {
    // No keyword → browse the community itself.
    const listing = sort === 'top' ? 'top' : sort === 'hot' ? 'hot' : 'new';
    path = `/r/${sub}/${listing}`;
    if (listing === 'top') p.set('t', t);
  }

  const url = `${host}${path}${authed ? '' : '.json'}?${p}`;
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (authed) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetchWithTimeout(url, { headers });

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        `${res.status} — Reddit is rate-limiting or blocking this server. ` +
          (authed ? 'Back off and retry.' : 'Add OAuth credentials (see README).')
      );
    }
    if (res.status === 404) throw new Error('404 — community not found or private');
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const children = json?.data?.children;
  if (!Array.isArray(children)) throw new Error('Unexpected response shape');

  return children.map(normalise).filter(Boolean);
}

/* ------------------------------------------------------------------ */

/**
 * FR-4  Query every selected community in parallel, merge, de-duplicate.
 * FR-11 One community failing must not break the result set — allSettled,
 *       and failures come back as a reportable `errors` array.
 */
export async function search(opts = {}) {
  const subs = [...new Set((opts.subs || []).map(String))]
    .filter((s) => SUB_RE.test(s))
    .slice(0, MAX_SUBS);

  const q = String(opts.q || '').slice(0, 250).trim();
  const sort = SORTS.includes(opts.sort) ? opts.sort : 'new';
  const t = TIMES.includes(opts.t) ? opts.t : 'month';
  const limit = Math.min(100, Math.max(5, Number(opts.limit) || 50));
  const galleriesOnly = Boolean(opts.galleries);
  const allowNsfw = Boolean(opts.nsfw);

  if (!subs.length) {
    return { results: [], errors: [], subs: [], cached: false, mode: 'public' };
  }

  const key = JSON.stringify({ subs, q, sort, t, limit, galleriesOnly, allowNsfw });
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  let bearer = null;
  let mode = 'public';
  try {
    bearer = await getAppToken();
    if (bearer) mode = 'oauth';
  } catch {
    bearer = null;                                  // Path 2 unavailable → Path 1
  }

  const settled = await Promise.allSettled(
    subs.map((s) => searchOne(s, { q, sort, t, limit }, bearer))
  );

  const errors = [];
  const seen = new Set();
  const buckets = [];

  settled.forEach((outcome, i) => {
    const sub = subs[i];
    if (outcome.status === 'rejected') {
      const msg = outcome.reason?.name === 'AbortError'
        ? 'timed out'
        : outcome.reason?.message || 'failed';
      errors.push({ sub, message: msg });
      return;
    }
    const bucket = [];
    for (const post of outcome.value) {
      if (seen.has(post.id)) continue;              // FR-4 de-dup
      if (galleriesOnly && post.count < 2) continue; // FR-6
      if (post.nsfw && !allowNsfw) continue;
      seen.add(post.id);
      bucket.push(post);
    }
    buckets.push(bucket);
  });

  let results;
  if (sort === 'top' || sort === 'hot') {
    results = buckets.flat().sort((a, b) => b.score - a.score);
  } else if (sort === 'new') {
    results = buckets.flat().sort((a, b) => b.created - a.created);
  } else {
    // Relevance: round-robin so no single busy community swamps the sheet.
    results = [];
    const depth = Math.max(0, ...buckets.map((b) => b.length));
    for (let i = 0; i < depth; i++) {
      for (const b of buckets) if (b[i]) results.push(b[i]);
    }
  }

  const payload = { results, errors, subs, mode, cached: false };
  cacheSet(key, payload);
  return payload;
}

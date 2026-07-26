/**
 * Shikaar — transport-agnostic API logic.
 * Both api/search.js (serverless) and server.js (local Node) call this, so the
 * two deploy targets can never drift apart.
 */
import { search, sourceMode } from './reddit.js';

const bool = (v) => v === '1' || v === 'true' || v === 'yes';

export async function handleSearch(params) {
  // Health check — the frontend pings this on load to decide live vs demo.
  if (params.get('ping')) {
    return {
      status: 200,
      body: { ok: true, service: 'shikaar', mode: await sourceMode() },
    };
  }

  // PRD §7 Security: validate/whitelist everything inbound. reddit.js
  // re-validates independently; this layer just shapes the input.
  const subs = (params.get('sub') || params.get('subs') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!subs.length) {
    return {
      status: 400,
      body: { ok: false, error: 'Pick at least one community. Pass ?sub=IndiaTech,indiasocial' },
    };
  }

  try {
    const data = await search({
      subs,
      q: params.get('q') || '',
      sort: params.get('sort') || 'new',
      t: params.get('t') || 'month',
      limit: params.get('limit'),
      galleries: bool(params.get('galleries')),
      nsfw: bool(params.get('nsfw')),
    });

    return { status: 200, body: { ok: true, ...data } };
  } catch (err) {
    return {
      status: 502,
      body: { ok: false, error: err?.message || 'Upstream source unavailable' },
    };
  }
}

/**
 * GET /api/search
 *
 * The whole reason Shikaar has a backend (PRD §2.3): this call happens
 * server-side, where cross-origin rules don't apply. Deployed as a serverless
 * function so V1 is zero-ops (PRD §6.2).
 *
 *   /api/search?sub=IndiaTech,indiasocial&q=%22finally%20bought%22&sort=new&t=month
 */
import { handleSearch } from '../lib/api.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }

  const params = new URL(req.url, `https://${req.headers.host || 'localhost'}`).searchParams;
  const { status, body } = await handleSearch(params);

  // FR-12: let the CDN absorb repeat searches too, not just the in-process cache.
  res.setHeader(
    'Cache-Control',
    status === 200 ? 'public, max-age=60, s-maxage=120, stale-while-revalidate=300' : 'no-store'
  );
  res.status(status).json(body);
}

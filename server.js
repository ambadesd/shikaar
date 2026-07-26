/**
 * Shikaar — local server.
 * Zero dependencies: serves public/ and answers /api/search using the exact
 * same logic as the deployed serverless function.
 *
 *   node server.js          → http://localhost:3000
 *   PORT=8080 node server.js
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSearch } from './lib/api.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/search') {
    const { status, body } = await handleSearch(url.searchParams);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    });
    return res.end(JSON.stringify(body));
  }

  // Static files, with directory traversal blocked.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, rel === '/' || rel === '\\' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback.
    try {
      const data = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
});

server.listen(PORT, () => {
  const auth = process.env.REDDIT_CLIENT_ID ? 'OAuth (Path 2)' : 'public JSON (Path 1)';
  console.log(`\n  Shikaar running → http://localhost:${PORT}`);
  console.log(`  Reddit access   → ${auth}\n`);
});

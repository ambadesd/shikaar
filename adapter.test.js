/**
 * PRD §8: "Source JSON shape can change over time → isolate parsing in one
 * adapter, add tests around it." This is that test. Run: node --test
 *
 * Reddit is never called; global fetch is replaced with a fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../lib/reddit.js';

const post = (over) => ({
  kind: 't3',
  data: {
    name: 't3_' + Math.random().toString(36).slice(2, 9),
    title: 'untitled',
    subreddit: 'IndiaTech',
    author: 'someone',
    permalink: '/r/IndiaTech/comments/abc/x/',
    score: 10,
    num_comments: 2,
    created_utc: 1_750_000_000,
    is_self: false,
    over_18: false,
    stickied: false,
    ...over,
  },
});

const FIXTURE = [
  // 1. text post — must never reach the client (FR-5)
  post({ name: 't3_text', title: 'Which phone should I buy?', is_self: true, selftext: 'help' }),

  // 2. plain link, no image — not a result
  post({ name: 't3_link', title: 'Article about phones', url: 'https://example.com/story' }),

  // 3. single direct image
  post({
    name: 't3_single', title: 'Finally bought it', post_hint: 'image',
    url: 'https://i.redd.it/abc123.jpg',
    url_overridden_by_dest: 'https://i.redd.it/abc123.jpg',
    preview: { images: [{ source: { url: 'https://preview.redd.it/abc123.jpg?s=1', width: 1200, height: 1600 },
      resolutions: [{ u: 'https://preview.redd.it/abc123.jpg?width=640&s=2', x: 640, y: 853 }] }] },
  }),

  // 4. three-photo gallery
  post({
    name: 't3_gallery', title: 'Papa gifted this', score: 4820, is_gallery: true,
    gallery_data: { items: [{ media_id: 'm1' }, { media_id: 'm2' }, { media_id: 'm3' }] },
    media_metadata: {
      m1: { status: 'valid', s: { u: 'https://i.redd.it/m1.jpg', x: 1000, y: 1250 },
            p: [{ u: 'https://i.redd.it/m1-640.jpg', x: 640, y: 800 }] },
      m2: { status: 'valid', s: { u: 'https://i.redd.it/m2.jpg' } },
      m3: { status: 'valid', s: { u: 'https://i.redd.it/m3.jpg' } },
    },
  }),

  // 5. NSFW image — filtered unless explicitly allowed
  post({ name: 't3_nsfw', title: 'nsfw', post_hint: 'image', over_18: true,
         url: 'https://i.redd.it/nsfw.jpg' }),

  // 6. stickied mod post carrying an image — still noise
  post({ name: 't3_sticky', title: 'Read the rules', post_hint: 'image', stickied: true,
         url: 'https://i.redd.it/rules.png' }),
];

function mockFetch(children = FIXTURE) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { children } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
}

test('drops text posts, link posts, stickies and NSFW; keeps photos', async () => {
  mockFetch();
  const { results } = await search({ subs: ['IndiaTech'], q: 'x', sort: 'new', t: 'month' });
  const ids = results.map((r) => r.id);

  assert.ok(!ids.includes('t3_text'), 'text post leaked (FR-5 violated)');
  assert.ok(!ids.includes('t3_link'), 'imageless link leaked');
  assert.ok(!ids.includes('t3_nsfw'), 'nsfw leaked');
  assert.ok(!ids.includes('t3_sticky'), 'sticky leaked');
  assert.deepEqual(ids.sort(), ['t3_gallery', 't3_single']);
});

test('normalises to the §6.4 internal schema', async () => {
  mockFetch();
  const { results } = await search({ subs: ['IndiaTech'], q: 'y', sort: 'top', t: 'all' });
  const g = results.find((r) => r.id === 't3_gallery');

  for (const field of ['id','title','source','thumb','images','count','score','created','link']) {
    assert.ok(field in g, `missing schema field: ${field}`);
  }
  assert.equal(g.source, 'reddit:IndiaTech');
  assert.equal(g.count, 3);
  assert.equal(g.images.length, 3);
  assert.equal(g.thumb, 'https://i.redd.it/m1-640.jpg', 'should prefer the grid-sized preview');
  assert.ok(g.link.startsWith('https://www.reddit.com/r/'));
});

test('galleries-only toggle drops single-photo posts (FR-6)', async () => {
  mockFetch();
  const { results } = await search({ subs: ['IndiaTech'], q: 'z', galleries: true });
  assert.deepEqual(results.map((r) => r.id), ['t3_gallery']);
  assert.ok(results.every((r) => r.count >= 2));
});

test('de-duplicates the same post across communities (FR-4)', async () => {
  mockFetch();
  const { results } = await search({
    subs: ['IndiaTech', 'indiasocial', 'india'], q: 'dedupe', sort: 'new',
  });
  assert.equal(new Set(results.map((r) => r.id)).size, results.length);
  assert.equal(results.length, 2, 'three identical responses should collapse to two posts');
});

test('one failing community does not sink the search (FR-11)', async () => {
  let n = 0;
  globalThis.fetch = async () => {
    if (n++ === 0) return new Response('blocked', { status: 403 });
    return new Response(JSON.stringify({ data: { children: FIXTURE } }), { status: 200 });
  };
  const { results, errors } = await search({ subs: ['IndiaTech', 'indiasocial'], q: 'partial' });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /403/);
  assert.ok(results.length > 0, 'surviving community must still return results');
});

test('rejects malformed community names before they reach the network', async () => {
  mockFetch();
  const { subs } = await search({ subs: ["bad'name", 'a', 'good_sub', '../etc'], q: 'q' });
  assert.deepEqual(subs, ['good_sub']);
});

test('sort=new orders by recency, sort=top by score', async () => {
  const older = post({ name: 't3_old', post_hint: 'image', url: 'https://i.redd.it/o.jpg',
                       created_utc: 1_700_000_000, score: 9000 });
  const newer = post({ name: 't3_new', post_hint: 'image', url: 'https://i.redd.it/n.jpg',
                       created_utc: 1_760_000_000, score: 5 });
  mockFetch([older, newer]);
  const byNew = await search({ subs: ['IndiaTech'], q: 'a', sort: 'new' });
  assert.equal(byNew.results[0].id, 't3_new');

  mockFetch([older, newer]);
  const byTop = await search({ subs: ['IndiaTech'], q: 'b', sort: 'top' });
  assert.equal(byTop.results[0].id, 't3_old');
});

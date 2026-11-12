// utils.ts uses a TS enum, which node --experimental-strip-types can't parse.
// Bundle it to plain JS with esbuild first, then test the bundle.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, ".utils-bundle.mjs");
execSync(
    `npx esbuild src/lib/utils.ts --bundle --format=esm --outfile=${out} --external:./schema --external:$app/environment`,
    { cwd: path.join(here, ".."), stdio: "pipe" },
);
const { updateThumbnailUrl, bestThumbnailUrl } = await import(`file://${out.replace(/\\/g, "/")}`);

test('updateThumbnailUrl upgrades googleusercontent render params to 1200px', () => {
    const url = 'https://lh3.googleusercontent.com/AbCdEf=w120-h120-l90-rj';
    assert.equal(updateThumbnailUrl(url), 'https://lh3.googleusercontent.com/AbCdEf=w1200-h1200-rj');
});

test('updateThumbnailUrl keeps the JPEG flag but drops webp/other flags', () => {
    const webp = 'https://lh3.googleusercontent.com/XyZ=w544-h544-l90-rw';
    assert.equal(updateThumbnailUrl(webp), 'https://lh3.googleusercontent.com/XyZ=w1200-h1200');
    const plain = 'https://lh5.googleusercontent.com/p/AF1QipN1=w203-h152-k-no';
    assert.equal(updateThumbnailUrl(plain), 'https://lh5.googleusercontent.com/p/AF1QipN1=w1200-h1200');
});

test('updateThumbnailUrl leaves URLs without render params alone', () => {
    const url = 'https://lh3.googleusercontent.com/RawId';
    assert.equal(updateThumbnailUrl(url), url);
    assert.equal(updateThumbnailUrl(undefined), '');
});

test('updateThumbnailUrl upgrades saavn covers to 500x500', () => {
    assert.equal(
        updateThumbnailUrl('https://c.saavncdn.com/914/Album-name-2024-08-08-08x08-50x50.jpg'),
        'https://c.saavncdn.com/914/Album-name-2024-08-08-08x08-500x500.jpg',
    );
    assert.equal(
        updateThumbnailUrl('https://c.saavncdn.com/284/Some-Song-150x150.jpg'),
        'https://c.saavncdn.com/284/Some-Song-500x500.jpg',
    );
});

test('updateThumbnailUrl passes other hosts through untouched', () => {
    const url = 'https://i.ytimg.com/vi/abc/hqdefault.jpg';
    assert.equal(updateThumbnailUrl(url), url);
});

test('bestThumbnailUrl picks the largest variant and upgrades it', () => {
    const thumbs = [
        { url: 'https://lh3.googleusercontent.com/A=w60-h60-l90-rj', width: 60, height: 60 },
        { url: 'https://lh3.googleusercontent.com/B=w544-h544-l90-rj', width: 544, height: 544 },
        { url: 'https://lh3.googleusercontent.com/C=w120-h120-l90-rj', width: 120, height: 120 },
    ];
    assert.equal(
        bestThumbnailUrl(thumbs),
        'https://lh3.googleusercontent.com/B=w1200-h1200-rj',
    );
});

test('bestThumbnailUrl handles missing sizes and empty lists', () => {
    assert.equal(bestThumbnailUrl([]), '');
    assert.equal(bestThumbnailUrl(undefined), '');
    const noSizes = [{ url: 'https://lh3.googleusercontent.com/A=w60-h60-l90-rj' }];
    assert.equal(bestThumbnailUrl(noSizes), 'https://lh3.googleusercontent.com/A=w1200-h1200-rj');
});

test('bestThumbnailUrl never returns the local cover protocol', () => {
    const thumbs = [{ url: 'zeta-cover://cover/abc' }, { url: 'https://lh3.googleusercontent.com/A=w60-h60-l90-rj' }];
    const out = bestThumbnailUrl(thumbs);
    assert.ok(!out.startsWith('zeta-cover:'));
    assert.equal(out, 'https://lh3.googleusercontent.com/A=w1200-h1200-rj');
});

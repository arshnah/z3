import test from 'node:test';
import assert from 'node:assert/strict';
import { ytSearchItems } from '../src/lib/youtube-search-results.ts';

const shelf = (title, contents) => ({ title, contents });

test('reads new YouTube Music titled sections', () => {
    const result = { contents: [shelf('Community playlists', [{ id: 'VLplaylist' }])] };
    assert.deepEqual(ytSearchItems(result, 'playlist', 'playlists'), [{ id: 'VLplaylist' }]);
});

test('supports the legacy YouTube Music result shape', () => {
    const result = { albums: { contents: [{ id: 'MPREb_album' }] } };
    assert.deepEqual(ytSearchItems(result, 'album', 'albums'), [{ id: 'MPREb_album' }]);
});

test('returns no matches when the requested section is absent', () => {
    const result = { contents: [shelf('Videos', [{ id: 'video-id' }])] };
    assert.deepEqual(ytSearchItems(result, 'album', 'albums'), []);
});

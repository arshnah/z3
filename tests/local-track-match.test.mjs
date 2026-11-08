import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLocalTrackMatch } from '../src/lib/local-track-match.ts';

function song(id, title, artists, album, duration, isDownloaded = true) {
    return {
        id,
        title,
        artists: artists.map((name) => ({ name, thumbnails: [] })),
        album: album ? { title: album, artists: [], thumbnails: [] } : null,
        duration,
        thumbnails: [],
        isDownloaded,
    };
}

test('matches a downloaded local track by normalized title and artist', () => {
    const searchResult = song('yt:search', 'Song Name', ['The Artist'], 'The Album', 180, false);
    const local = song('local:file.m4a', ' SONG   NAME ', ['the artist'], 'The Album', 181);
    const unrelated = song('local:other.m4a', 'Song Name', ['Someone Else'], 'The Album', 180);

    assert.equal(findLocalTrackMatch(searchResult, [unrelated, local]), local);
});

test('prefers an exact downloaded source ID and ignores unavailable tracks', () => {
    const searchResult = song('yt:same', 'Song Name', ['The Artist'], 'The Album', 180, false);
    const exact = song('yt:same', 'Song Name', ['The Artist'], 'The Album', 180);
    const betterMetadataButNotDownloaded = song('local:missing.m4a', 'Song Name', ['The Artist'], 'The Album', 180, false);

    assert.equal(findLocalTrackMatch(searchResult, [betterMetadataButNotDownloaded, exact]), exact);
    assert.equal(findLocalTrackMatch(searchResult, [betterMetadataButNotDownloaded]), undefined);
});

test('does not guess between equally matching local versions', () => {
    const searchResult = song('yt:search', 'Song Name', ['The Artist'], undefined, 0, false);
    const first = song('local:first.m4a', 'Song Name', ['The Artist'], undefined, 0);
    const second = song('local:second.m4a', 'Song Name', ['The Artist'], undefined, 0);

    assert.equal(findLocalTrackMatch(searchResult, [first, second]), undefined);
});

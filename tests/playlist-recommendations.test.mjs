import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPlaylistRecommendations, filterRecommendationsByArtist } from '../src/lib/playlist-recommendations.ts';

function song(id, title, artists) {
    return {
        id,
        title,
        artists: artists.map((name) => ({ name, thumbnails: [] })),
        album: null,
        thumbnails: [],
        duration: 180,
        isDownloaded: false,
    };
}

test('excludes a playlist song returned with a different provider ID', () => {
    const playlist = [song('yt:one', 'Moonlight', ['XXXTENTACION'])];
    const recommendations = [
        song('yt:other-upload', 'Moonlight', ['XXXTENTACION']),
        song('yt:two', 'Changes', ['XXXTENTACION']),
    ];

    assert.deepEqual(filterPlaylistRecommendations(recommendations, playlist).map((track) => track.id), ['yt:two']);
});

test('matches case, punctuation, accents, and featured artist variations', () => {
    const playlist = [song('js:one', 'Café (feat. Guest)', ['Artist One'])];
    const recommendations = [
        song('yt:duplicate', 'Cafe', ['Artist-One, Guest']),
        song('yt:different-artist', 'Cafe', ['Another Artist']),
    ];

    assert.deepEqual(
        filterPlaylistRecommendations(recommendations, playlist).map((track) => track.id),
        ['yt:different-artist'],
    );
});

test('removes duplicate recommendations and honors the result limit', () => {
    const recommendations = [
        song('yt:a', 'One', ['Artist']),
        song('js:a', 'One', ['Artist']),
        song('yt:b', 'Two', ['Artist']),
    ];

    assert.deepEqual(filterPlaylistRecommendations(recommendations, [], 1).map((track) => track.id), ['yt:a']);
});

test('keeps recommendations to one song per credited artist', () => {
    const recommendations = [
        song('yt:a', 'One', ['Artist One']),
        song('yt:b', 'Two', ['Artist One']),
        song('yt:c', 'Three', ['Artist Two feat. Artist One']),
        song('yt:d', 'Four', ['Artist Two']),
        song('yt:e', 'Five', ['Artist Three']),
    ];

    assert.deepEqual(filterRecommendationsByArtist(recommendations).map((track) => track.id), ['yt:a', 'yt:d', 'yt:e']);
});

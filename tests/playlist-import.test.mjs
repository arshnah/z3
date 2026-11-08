import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExportifyCsv } from '../src/lib/playlist-import.ts';

test('parses Exportify rows with quoted commas, quotes, and multiple artists', () => {
    const csv = [
        '\uFEFFTrack URI,Track Name,Album Name,Artist Name(s),Duration (ms)',
        '"spotify:track:1","Song, with comma","The ""Best"" Album","First Artist; Second Artist",215432',
    ].join('\r\n');

    assert.deepEqual(parseExportifyCsv(csv), [{
        title: 'Song, with comma',
        artists: ['First Artist', 'Second Artist'],
        album: 'The "Best" Album',
        uri: 'spotify:track:1',
        durationSeconds: 215,
    }]);
});

test('ignores blank rows and skips rows without track metadata', () => {
    const csv = [
        'Track Name,Artist Name(s),Album Name',
        ',,',
        'A Song,An Artist,An Album',
        '',
    ].join('\n');

    assert.deepEqual(parseExportifyCsv(csv), [{
        title: 'A Song',
        artists: ['An Artist'],
        album: 'An Album',
        uri: '',
        durationSeconds: 0,
    }]);
});

test('rejects CSV files without the Exportify track columns', () => {
    assert.throws(() => parseExportifyCsv('Name,Artists\nSong,Artist'), /Track Name or Artist Name/);
    assert.throws(() => parseExportifyCsv('Track Name,Artist Name(s)\n"Song,Artist'), /unterminated quoted field/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { encode } from '@msgpack/msgpack';
import { backupPlaylistId, makeZetaBackup, mergeBackupEvents, openZetaBackup } from '../src/lib/zeta-backup.ts';
import { newerRelease } from '../src/lib/releases.ts';

const song = {
    id: 'local:Example.wav', title: 'Example', artists: [], album: null,
    thumbnails: [{ url: 'file:///private/cover.jpg', data: Uint8Array.of(1, 2), mimetype: 'image/jpeg' }],
    duration: 1, isDownloaded: true,
};
const event = { songId: song.id, timestamp: 12345, playTimeMs: 1000 };
const manifest = {
    songs: [{ song, audio: 'Music/Example.wav' }],
    favourites: [song.id],
    playlists: [{ id: 'playlist.m3u8', name: 'Example playlist', createdAt: 1, trackIds: [song.id] }],
    events: [event],
};

test('Zeta backups round-trip portable song data, playlists, history and audio', async () => {
    const audio = Uint8Array.of(2, 3, 5, 7);
    const backup = await makeZetaBackup(manifest, async () => audio);
    const restored = await openZetaBackup(backup);
    const restoredSong = restored.manifest.songs[0].song;
    assert.equal(restoredSong.id, song.id);
    assert.equal(restoredSong.thumbnails[0].url, undefined);
    assert.deepEqual(restoredSong.thumbnails[0].data, song.thumbnails[0].data);
    assert.deepEqual(restored.manifest.favourites, manifest.favourites);
    assert.deepEqual(restored.manifest.playlists[0].trackIds, [song.id]);
    assert.deepEqual(await restored.readAudio('audio/0.wav'), audio);
    assert.deepEqual(mergeBackupEvents(restored.manifest.events, [event, event]), []);
    const playlistId = await backupPlaylistId(manifest.playlists[0].id);
    assert.equal(await backupPlaylistId(playlistId), playlistId);
});

test('Zeta backup import rejects audio paths outside their assigned entry', async () => {
    const archive = new JSZip();
    archive.file('zeta.msgpack', encode({ ...manifest, version: 1, songs: [{ song, audio: '../Example.wav' }] }));
    await assert.rejects(openZetaBackup(await archive.generateAsync({ type: 'uint8array' })), /invalid audio entry/);
});

test('GitHub updates require a newer stable version', () => {
    const release = { tag_name: 'v0.10.0', prerelease: false, draft: false, assets: [] };
    assert.equal(newerRelease(release, '0.5.2').version, '0.10.0');
    assert.equal(newerRelease(release, '0.10.0'), null);
    assert.equal(newerRelease(release, '1.0.0'), null);
    assert.equal(newerRelease({ ...release, draft: true }, '0.5.2'), null);
    assert.equal(newerRelease({ ...release, prerelease: true }, '0.5.2'), null);
});

test('duplicate review groups different providers and preserves alternate editions', async () => {
    const { duplicateSongs } = await import('../src/lib/library-tools.ts');
    const track = { ...song, title: 'Éxample', artists: [{ name: 'Artist', thumbnails: [] }] };
    const copy = { ...track, id: 'yt:jNQXAC9IVRw', title: 'Example' };
    const live = { ...track, id: 'js:live', title: 'Example (Live)' };
    assert.deepEqual(duplicateSongs([track, copy, live, copy]), [[track, copy]]);
});

test('listening history filters artist, title, and exclusive end dates', async () => {
    const { matchesListeningFilter } = await import('../src/lib/listening-history.ts');
    const name = { title: 'Example', artists: ['Artist'] };
    assert.equal(matchesListeningFilter({ timestamp: 100 }, name, { query: 'ARTIST', from: 100, until: 101 }), true);
    assert.equal(matchesListeningFilter({ timestamp: 101 }, name, { query: 'example', from: 100, until: 101 }), false);
    assert.equal(matchesListeningFilter({ timestamp: 100 }, name, { query: 'another' }), false);
});

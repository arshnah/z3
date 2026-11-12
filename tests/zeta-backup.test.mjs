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

test('large embedded cover art does not prevent a backup with audio', async () => {
    const url = 'https://example.com/cover.jpg';
    const largeCover = { url, data: new Uint8Array(16 * 1024 * 1024) };
    const audio = Uint8Array.of(1, 2, 3);
    const backup = await makeZetaBackup({ ...manifest, songs: [{
        ...manifest.songs[0], song: { ...song, thumbnails: [largeCover] },
    }] }, async () => audio);
    const restored = await openZetaBackup(backup);
    assert.equal(restored.manifest.songs[0].song.thumbnails[0].url, url);
    assert.equal(restored.manifest.songs[0].song.thumbnails[0].data, undefined);
    assert.deepEqual(await restored.readAudio('audio/0.wav'), audio);
    assert.deepEqual(restored.manifest.events, [event]);
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

test('playlist covers survive a normal backup and are dropped if they would block a large export', async () => {
    const cover = 'data:image/jpeg;base64,AQID';
    const playlist = { ...manifest.playlists[0], thumbnail: cover };
    const small = await makeZetaBackup({ ...manifest, playlists: [playlist] }, async () => undefined, false);
    assert.equal((await openZetaBackup(small)).manifest.playlists[0].thumbnail, cover);

    const largeCover = 'data:image/jpeg;base64,' + 'A'.repeat(1024 * 1024);
    const playlists = Array.from({ length: 17 }, (_, index) => ({
        ...playlist, id: `playlist-${index}.m3u8`, thumbnail: largeCover,
    }));
    const large = await makeZetaBackup({ ...manifest, playlists }, async () => undefined, false);
    const restored = (await openZetaBackup(large)).manifest;
    assert.equal(restored.playlists.length, playlists.length);
    assert.ok(restored.playlists.every(({ thumbnail }) => thumbnail === undefined));
    assert.deepEqual(restored.playlists[0].trackIds, playlist.trackIds);
    assert.deepEqual(restored.events, manifest.events);
});

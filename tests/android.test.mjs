import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AndroidStorage, emptyLibrary, requirePlaylist, rememberSong, FAVOURITES_ID } from '../src/lib/android/storage.ts';
import { summarize } from '../src/lib/android/stats.ts';
import { musicText, youtubeArtistNames } from '../src/lib/music-metadata.ts';

function memoryFilesystem(initial) {
    const files = new Map(initial === undefined ? [] : [['zeta/library.json', initial]]);
    return {
        files, failNextWrite: false,
        async mkdir() {},
        async readFile({ path }) {
            if (!files.has(path)) throw { code: 'OS-PLUG-FILE-0008' };
            return { data: files.get(path) };
        },
        async writeFile({ path, data }) {
            if (this.failNextWrite) { this.failNextWrite = false; throw new Error('Disk full'); }
            files.set(path, data);
        },
        async rename({ from, to }) { files.set(to, files.get(from)); files.delete(from); },
    };
}

test('concurrent playlist edits survive restart without sharing mutable snapshots', async () => {
    const filesystem = memoryFilesystem();
    const storage = new AndroidStorage(filesystem);
    await Promise.all(Array.from({ length: 20 }, (_, i) => storage.edit((state) => {
        state.playlists.push({ id: String(i), name: `Playlist ${i}`, tracks: [], createdAt: i });
    })));
    const snapshot = await storage.snapshot();
    assert.equal(snapshot.playlists.length, 21);
    snapshot.playlists.length = 0;
    assert.equal((await storage.snapshot()).playlists.length, 21);
    assert.equal((await new AndroidStorage(filesystem).snapshot()).playlists.length, 21);
    assert.equal(filesystem.files.has('zeta/library.json.tmp'), false);
});

test('a failed disk write rolls back in memory and on disk and the next edit succeeds', async () => {
    const filesystem = memoryFilesystem();
    const storage = new AndroidStorage(filesystem);
    await storage.edit((state) => { state.names.saved = { title: 'Saved', artists: [] }; });
    filesystem.failNextWrite = true;
    await assert.rejects(storage.edit((state) => { state.names.failed = { title: 'Lost', artists: [] }; }), /Disk full/);
    assert.equal((await storage.snapshot()).names.failed, undefined);
    await storage.edit((state) => { state.names.next = { title: 'Next', artists: [] }; });
    const reopened = await new AndroidStorage(filesystem).snapshot();
    assert.deepEqual(Object.keys(reopened.names), ['saved', 'next']);
});

test('corrupt or unreadable libraries are preserved instead of replaced', async () => {
    const filesystem = memoryFilesystem('{broken');
    const storage = new AndroidStorage(filesystem);
    await assert.rejects(storage.snapshot(), SyntaxError);
    await assert.rejects(storage.edit((state) => { state.playlists.length = 0; }), SyntaxError);
    assert.equal(filesystem.files.get('zeta/library.json'), '{broken');
    filesystem.readFile = async () => { throw { code: 'OS-PLUG-FILE-0007' }; };
    await assert.rejects(new AndroidStorage(filesystem).snapshot(), { code: 'OS-PLUG-FILE-0007' });
});

test('downloaded metadata updates every playlist and protects favourites', () => {
    const library = emptyLibrary();
    const song = { id: 'local:test', title: 'Test', artists: [], album: null, thumbnails: [], duration: 3, isDownloaded: false };
    library.playlists[0].tracks.push(song);
    const downloaded = { ...song, isDownloaded: true };
    rememberSong(library, { song: downloaded, file: 'zeta/audio/test', mimetype: 'audio/mpeg' });
    assert.equal(library.playlists[0].tracks[0].isDownloaded, true);
    assert.equal(library.songs[song.id].file, 'zeta/audio/test');
    assert.throws(() => requirePlaylist(library, FAVOURITES_ID, true), /cannot be renamed or deleted/);
    assert.throws(() => requirePlaylist(library, 'missing'), /not found/);
});

test('stats retain totals beyond the display limit and label unsaved songs', () => {
    const library = emptyLibrary();
    library.names.a = { title: 'Song A', artists: ['Artist', 'Artist'] };
    library.names.b = { title: 'Song B', artists: ['Artist'] };
    library.events.push(
        { songId: 'a', playTimeMs: 1000, timestamp: 100 },
        { songId: 'b', playTimeMs: 3000, timestamp: 300 },
        { songId: 'a', playTimeMs: 2000, timestamp: 200 },
    );
    const stats = summarize(library, 1);
    assert.deepEqual(stats.totals, { totalPlayTimeMs: 6000, totalPlays: 3, uniqueSongs: 2 });
    assert.equal(stats.topSongs.length, 1);
    assert.equal(stats.topSongs[0].title, 'Song A');
    assert.equal(stats.topSongs[0].lastPlayed, 200);
    assert.equal(stats.history[0].id, 'b');
    assert.equal(stats.topArtists[0].playTimeMs, 6000);
    assert.equal(stats.topArtists[0].plays, 3);
});

test('provider metadata uses readable entities and logged-out artist text', () => {
    assert.equal(musicText('Bach &amp; Mozart: &quot;Air&quot; &#x266b;'), 'Bach & Mozart: "Air" ♫');
    assert.deepEqual(youtubeArtistNames({ flex_columns: [{ title: 'Air' }, { title: 'Orchestra • Bach • 4:12' }] }), ['Orchestra']);
    assert.deepEqual(youtubeArtistNames({ authors: [{ name: 'A &amp; B' }] }), ['A & B']);
    assert.deepEqual(youtubeArtistNames({ flex_columns: [{ title: 'Air' }, { title: '4:12' }] }), []);
});

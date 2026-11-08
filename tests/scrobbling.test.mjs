import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ScrobblingService, emptyScrobbles, lastfmSignature, qualifiesForScrobble } from '../src/lib/scrobbling/service.ts';
import { ScrobbleTracker } from '../src/lib/scrobbling/tracker.ts';

const credentials = { apiKey: 'test-key', apiSecret: 'test-secret' };
const track = { id: 'yt:test', title: 'A Song', artists: ['An Artist'], album: 'An Album', duration: 100 };
function fixture(data = emptyScrobbles(), fetcher = async () => Response.json({})) {
    let disk = structuredClone(data);
    return {
        service: new ScrobblingService({ async read() { return structuredClone(disk); }, async write(value) { disk = structuredClone(value); } }, credentials, fetcher),
        disk: () => structuredClone(disk),
    };
}
function connected() {
    const data = emptyScrobbles();
    data.lastfm = { enabled: true, username: 'last-user', sessionKey: 'last-session' };
    data.listenbrainz = { enabled: true, username: 'brainz-user', token: 'brainz-token' };
    return data;
}

test('Last.fm signatures sort raw parameters and exclude format/callback', () => {
    const params = { token: 'té st', api_key: 'test-key', method: 'auth.getSession', format: 'json', callback: 'unused' };
    const expected = createHash('md5').update('api_keytest-keymethodauth.getSessiontokenté sttest-secret').digest('hex');
    assert.equal(lastfmSignature(params, credentials.apiSecret), expected);
});

test('scrobbling thresholds require >30 seconds and half the song or 4 minutes', () => {
    assert.equal(qualifiesForScrobble(30, 30000), false);
    assert.equal(qualifiesForScrobble(100, 49999), false);
    assert.equal(qualifiesForScrobble(100, 50000), true);
    assert.equal(qualifiesForScrobble(900, 240000), true);
    assert.equal(qualifiesForScrobble(NaN, 300000), false);
});

test('actual audio progress excludes pauses and seeks and submits once per play', () => {
    const announced = [], submitted = [];
    const tracker = new ScrobbleTracker((song) => announced.push(song), (...args) => submitted.push(args));
    const short = { ...track, duration: 40 };
    tracker.tick(short, 0, false, 1000);
    for (let i = 1; i <= 10; i++) tracker.tick(short, i, false, 1000 + i * 1000);
    tracker.tick(short, 30, false, 12000); // seek ahead is not listening
    tracker.tick(short, 31, true, 13000);
    tracker.tick(short, 31, true, 999000);
    tracker.tick(short, 31, false, 1000000);
    for (let i = 32; i <= 41; i++) tracker.tick(short, i, false, 1000000 + i * 1000);
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0][2], 20000);
    tracker.finish();
    assert.equal(submitted.length, 1);
    tracker.tick(short, 0, false, 2000000);
    for (let i = 1; i <= 20; i++) tracker.tick(short, i, false, 2000000 + i * 1000);
    assert.equal(announced.length, 3); // initial play, resume refresh, and repeat
    assert.equal(submitted.length, 2);
});

test('one service failure stays queued while the other is delivered exactly once', async () => {
    let fail = true;
    const calls = [];
    const app = fixture(connected(), async (url, options) => {
        calls.push({ url, options });
        if (String(url).includes('audioscrobbler') && fail) return new Response('', { status: 503 });
        return Response.json({ scrobbles: { scrobble: { ignoredMessage: { code: '0' } } } });
    });
    const startedAt = Date.now() - 100000;
    await app.service.submit(track, startedAt, 50000);
    assert.equal(app.disk().queue.length, 1);
    assert.deepEqual(app.disk().queue[0].targets, { lastfm: 'last-user' });
    const brainz = JSON.parse(calls.find((c) => String(c.url).includes('listenbrainz')).options.body);
    assert.equal(brainz.listen_type, 'single');
    assert.equal(brainz.payload[0].listened_at, Math.floor(startedAt / 1000));
    assert.equal(brainz.payload[0].track_metadata.artist_name, 'An Artist');
    fail = false;
    await app.service.retry();
    assert.equal(app.disk().queue.length, 0);
    assert.equal(calls.filter((c) => String(c.url).includes('listenbrainz')).length, 1);
    assert.equal(calls.filter((c) => String(c.url).includes('audioscrobbler')).length, 2);
    const body = new URLSearchParams(calls.at(-1).options.body);
    assert.equal(body.get('timestamp'), String(Math.floor(startedAt / 1000)));
    assert.equal(body.get('sk'), 'last-session');
});

test('now-playing has no timestamp and cannot create a persistent listen', async () => {
    const calls = [];
    const app = fixture(connected(), async (url, options) => { calls.push({ url, options }); return Response.json({}); });
    await app.service.nowPlaying({
        ...track,
        title: '  A   Song ',
        artists: [' An Artist ', 'Second Artist', 'an artist', ''],
        album: ' An Album ',
    });
    assert.equal(app.disk().queue.length, 0);
    const lastfm = new URLSearchParams(calls.find((c) => String(c.url).includes('audioscrobbler')).options.body);
    assert.equal(lastfm.get('method'), 'track.updateNowPlaying');
    assert.equal(lastfm.has('timestamp'), false);
    assert.equal(lastfm.get('track'), 'A Song');
    assert.equal(lastfm.get('artist'), 'An Artist, Second Artist');
    assert.equal(lastfm.get('album'), 'An Album');
    const brainz = JSON.parse(calls.find((c) => String(c.url).includes('listenbrainz')).options.body);
    assert.equal(brainz.listen_type, 'playing_now');
    assert.equal('listened_at' in brainz.payload[0], false);
    assert.equal(brainz.payload[0].track_metadata.artist_name, 'An Artist, Second Artist');
    assert.deepEqual(brainz.payload[0].track_metadata.additional_info.artist_names, ['An Artist', 'Second Artist']);
    assert.equal(brainz.payload[0].track_metadata.release_name, 'An Album');
});

test('authentication stores sessions privately and status omits tokens', async () => {
    const app = fixture(undefined, async (url, options) => {
        if (String(url).includes('validate-token')) return Response.json({ valid: true, user_name: 'brainz-user' });
        const params = new URLSearchParams(options.body);
        return params.get('method') === 'auth.getToken' ? Response.json({ token: 'pending-token' }) : Response.json({ session: { name: 'last-user', key: 'session-secret' } });
    });
    const url = new URL(await app.service.startLastfm());
    assert.equal(url.hostname, 'www.last.fm');
    assert.equal(url.searchParams.get('token'), 'pending-token');
    await app.service.finishLastfm();
    await app.service.connectListenbrainz('private-token');
    const status = JSON.stringify(await app.service.status());
    for (const secret of ['pending-token', 'session-secret', 'private-token', credentials.apiSecret]) assert.equal(status.includes(secret), false);
    assert.equal((await app.service.status()).lastfm.connected, true);
});

test('disconnect removes queued delivery for that account and disabled accounts send nothing', async () => {
    const app = fixture(connected(), async () => { throw new Error('Offline'); });
    await app.service.submit(track, Date.now() - 100000, 50000);
    await app.service.disconnect('lastfm');
    assert.deepEqual(app.disk().queue[0].targets, { listenbrainz: 'brainz-user' });
    await app.service.setEnabled('listenbrainz', false);
    const queued = app.disk().queue.length;
    await app.service.submit({ ...track, id: 'different' }, Date.now() - 100000, 50000);
    assert.equal(app.disk().queue.length, queued);
});

test('invalid sessions pause that service and retain queued listens for reconnecting', async () => {
    let calls = 0;
    const app = fixture(connected(), async (url) => {
        if (String(url).includes('audioscrobbler')) { calls++; return Response.json({ error: 9, message: 'Reconnect Last.fm.' }); }
        return Response.json({});
    });
    await app.service.submit(track, Date.now() - 100000, 50000);
    assert.equal((await app.service.status()).lastfm.enabled, false);
    assert.equal((await app.service.status()).lastfm.queued, 1);
    await app.service.retry();
    assert.equal(calls, 1);
});

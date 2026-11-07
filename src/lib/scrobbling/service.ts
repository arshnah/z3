import MD5 from 'crypto-js/md5.js';

export type ScrobbleProvider = 'lastfm' | 'listenbrainz';
export interface ScrobbleTrack {
    id: string;
    title: string;
    artists: string[];
    album?: string;
    duration: number;
}
interface Account { enabled: boolean; username?: string; error?: string }
interface PendingListen {
    id: string; track: ScrobbleTrack; timestamp: number;
    targets: Partial<Record<ScrobbleProvider, string>>;
}
export interface ScrobbleData {
    version: 1;
    lastfm: Account & { sessionKey?: string; pendingToken?: string };
    listenbrainz: Account & { token?: string };
    queue: PendingListen[];
}
export interface ScrobbleStorage { read(): Promise<ScrobbleData | null>; write(data: ScrobbleData): Promise<void> }
export interface LastfmCredentials { apiKey: string; apiSecret: string }

export function emptyScrobbles(): ScrobbleData {
    return { version: 1, lastfm: { enabled: false }, listenbrainz: { enabled: false }, queue: [] };
}

/** Last.fm signs unescaped UTF-8 values, in alphabetical parameter order. */
export function lastfmSignature(params: Record<string, string>, secret: string): string {
    const message = Object.keys(params).filter((key) => !['format', 'callback', 'api_sig'].includes(key)).sort()
        .map((key) => key + params[key]).join('') + secret;
    return MD5(message).toString();
}

export function qualifiesForScrobble(duration: number, listenedMs: number): boolean {
    return Number.isFinite(duration) && duration > 30 && Number.isFinite(listenedMs)
        && listenedMs >= Math.min(duration / 2, 240) * 1000;
}

class ApiError extends Error {
    readonly permanent: boolean;
    readonly authentication: boolean;
    constructor(message: string, permanent = false, authentication = false) {
        super(message); this.permanent = permanent; this.authentication = authentication;
    }
}

export class ScrobblingService {
    private storage: ScrobbleStorage;
    private credentials: LastfmCredentials;
    private request: typeof fetch;
    private loaded?: Promise<ScrobbleData>;
    private writes: Promise<unknown> = Promise.resolve();
    private flushing?: Promise<void>;

    constructor(storage: ScrobbleStorage, credentials: LastfmCredentials, request: typeof fetch = fetch) {
        this.storage = storage; this.credentials = credentials; this.request = request;
    }

    private load(): Promise<ScrobbleData> {
        return this.loaded ??= this.storage.read().then((data) => {
            if (!data) return emptyScrobbles();
            if (data.version !== 1 || !data.lastfm || !data.listenbrainz || !Array.isArray(data.queue)) throw new Error('Scrobbling settings could not be read. Existing data was preserved.');
            return data;
        }).catch((error) => { this.loaded = undefined; throw error; });
    }

    private edit<T>(update: (data: ScrobbleData) => T): Promise<T> {
        const run = async () => {
            const data = structuredClone(await this.load());
            const result = update(data);
            await this.storage.write(data);
            this.loaded = Promise.resolve(data);
            return result;
        };
        const next = this.writes.then(run, run);
        this.writes = next.catch(() => {});
        return next;
    }

    private async snapshot() { await this.writes; return structuredClone(await this.load()); }

    async status() {
        const data = await this.snapshot();
        const account = (provider: ScrobbleProvider) => ({
            enabled: data[provider].enabled, username: data[provider].username ?? '', error: data[provider].error ?? '',
            connected: provider === 'lastfm' ? !!data.lastfm.sessionKey : !!data.listenbrainz.token,
            queued: data.queue.filter((item) => item.targets[provider]).length,
        });
        return {
            lastfm: { ...account('lastfm'), configured: !!(this.credentials.apiKey && this.credentials.apiSecret), pending: !!data.lastfm.pendingToken },
            listenbrainz: account('listenbrainz'),
        };
    }

    private async lastfm(method: string, values: Record<string, string>, sessionKey?: string, signed = true) {
        if (!this.credentials.apiKey || !this.credentials.apiSecret) throw new Error('Last.fm is not configured in this build.');
        const params: Record<string, string> = { ...values, method, api_key: this.credentials.apiKey };
        if (sessionKey) params.sk = sessionKey;
        if (signed) params.api_sig = lastfmSignature(params, this.credentials.apiSecret);
        const response = await this.request('https://ws.audioscrobbler.com/2.0/', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ ...params, format: 'json' }).toString(), signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new ApiError(`Last.fm returned ${response.status}.`, response.status === 400, response.status === 401 || response.status === 403);
        const result = await response.json();
        if (result.error) throw new ApiError(result.message || 'Last.fm rejected the request.', ![11, 16, 29].includes(result.error), [4, 9, 14, 26].includes(result.error));
        return result;
    }

    async startLastfm() {
        const result = await this.lastfm('auth.getToken', {}, undefined, false);
        if (typeof result.token !== 'string' || !result.token) throw new Error('Last.fm did not return an authorization token.');
        await this.edit((data) => { data.lastfm.pendingToken = result.token; data.lastfm.error = undefined; });
        return `https://www.last.fm/api/auth/?${new URLSearchParams({ api_key: this.credentials.apiKey, token: result.token })}`;
    }

    async finishLastfm() {
        const data = await this.snapshot();
        if (!data.lastfm.pendingToken) throw new Error('Start Last.fm authorization first.');
        const result = await this.lastfm('auth.getSession', { token: data.lastfm.pendingToken });
        if (!result.session?.key || !result.session?.name) throw new Error('Approve Zeta in Last.fm, then finish connecting.');
        await this.edit((state) => {
            state.lastfm = { enabled: true, username: result.session.name, sessionKey: result.session.key };
        });
        await this.retry();
    }

    async connectListenbrainz(token: string) {
        const trimmed = token.trim();
        if (!trimmed) throw new Error('Enter your ListenBrainz user token.');
        const response = await this.request('https://api.listenbrainz.org/1/validate-token', {
            headers: { Authorization: `Token ${trimmed}` }, signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`ListenBrainz returned ${response.status}.`);
        const result = await response.json();
        if (!result.valid || !result.user_name) throw new Error('This ListenBrainz token is invalid.');
        await this.edit((data) => { data.listenbrainz = { enabled: true, username: result.user_name, token: trimmed }; });
        await this.retry();
    }

    async setEnabled(provider: ScrobbleProvider, enabled: boolean) {
        await this.edit((data) => {
            if (enabled && !(provider === 'lastfm' ? data.lastfm.sessionKey : data.listenbrainz.token)) throw new Error('Connect your account first.');
            data[provider].enabled = enabled;
        });
        if (enabled) await this.retry();
    }

    async disconnect(provider: ScrobbleProvider) {
        await this.edit((data) => {
            data[provider] = { enabled: false };
            for (const listen of data.queue) delete listen.targets[provider];
            data.queue = data.queue.filter((listen) => Object.keys(listen.targets).length);
        });
    }

    private metadata(track: ScrobbleTrack) {
        return {
            artist_name: track.artists.join(', '), track_name: track.title,
            ...(track.album ? { release_name: track.album } : {}),
            additional_info: { media_player: 'Zeta', submission_client: 'zeta', duration_ms: Math.round(track.duration * 1000) },
        };
    }

    private async send(provider: ScrobbleProvider, data: ScrobbleData, track: ScrobbleTrack, timestamp?: number) {
        if (provider === 'lastfm') {
            const values: Record<string, string> = { artist: track.artists[0], track: track.title, duration: String(Math.round(track.duration)) };
            if (track.album) values.album = track.album;
            if (timestamp !== undefined) values.timestamp = String(timestamp);
            const result = await this.lastfm(timestamp === undefined ? 'track.updateNowPlaying' : 'track.scrobble', values, data.lastfm.sessionKey);
            const ignored = result.scrobbles?.scrobble?.ignoredMessage;
            if (ignored && Number(ignored.code)) throw new ApiError(ignored['#text'] || 'Last.fm ignored this scrobble.', true);
        } else {
            const response = await this.request('https://api.listenbrainz.org/1/submit-listens', {
                method: 'POST', headers: { Authorization: `Token ${data.listenbrainz.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ listen_type: timestamp === undefined ? 'playing_now' : 'single', payload: [{ track_metadata: this.metadata(track), ...(timestamp === undefined ? {} : { listened_at: timestamp }) }] }),
                signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) throw new ApiError(`ListenBrainz returned ${response.status}.`, response.status === 400, response.status === 401 || response.status === 403);
        }
    }

    async nowPlaying(track: ScrobbleTrack) {
        if (!track.title.trim() || !track.artists[0]?.trim()) return;
        const data = await this.snapshot();
        await Promise.all((['lastfm', 'listenbrainz'] as const).map(async (provider) => {
            if (!data[provider].enabled || !data[provider].username) return;
            try { await this.send(provider, data, track); }
            catch (error) { await this.edit((state) => {
                state[provider].error = (error as Error).message;
                if (error instanceof ApiError && error.authentication) state[provider].enabled = false;
            }); }
        }));
    }

    async submit(track: ScrobbleTrack, startedAt: number, listenedMs: number) {
        if (!qualifiesForScrobble(track.duration, listenedMs) || !track.title.trim() || !track.artists[0]?.trim()) return;
        const timestamp = Math.floor(startedAt / 1000);
        if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() / 1000 + 60) return;
        const id = `${track.id}:${timestamp}`;
        await this.edit((data) => {
            if (data.queue.some((listen) => listen.id === id)) return;
            const targets: PendingListen['targets'] = {};
            for (const provider of ['lastfm', 'listenbrainz'] as const) {
                if (data[provider].enabled && data[provider].username) targets[provider] = data[provider].username;
            }
            if (Object.keys(targets).length) data.queue.push({ id, track, timestamp, targets });
        });
        await this.retry();
    }

    retry(): Promise<void> {
        if (this.flushing) return this.flushing;
        this.flushing = this.flush().finally(() => { this.flushing = undefined; });
        return this.flushing;
    }

    private async flush() {
        const data = await this.snapshot();
        const failed = new Set<ScrobbleProvider>();
        for (const listen of data.queue) {
            for (const provider of ['lastfm', 'listenbrainz'] as const) {
                if (failed.has(provider) || !listen.targets[provider] || !data[provider].enabled || listen.targets[provider] !== data[provider].username) continue;
                let remove = false;
                let authentication = false;
                let message: string | undefined;
                try { await this.send(provider, data, listen.track, listen.timestamp); remove = true; }
                catch (error) {
                    message = (error as Error).message;
                    remove = error instanceof ApiError && error.permanent && !error.authentication;
                    authentication = error instanceof ApiError && error.authentication;
                    failed.add(provider);
                }
                await this.edit((state) => {
                    state[provider].error = message;
                    if (authentication) state[provider].enabled = false;
                    const queued = state.queue.find((item) => item.id === listen.id);
                    if (queued && remove) delete queued.targets[provider];
                    state.queue = state.queue.filter((item) => Object.keys(item.targets).length);
                });
            }
        }
    }
}

export function scrobblingRoutes(service: ScrobblingService) {
    return {
        scrobbleStatus: () => service.status(),
        scrobbleLastfmStart: () => service.startLastfm(),
        scrobbleLastfmFinish: () => service.finishLastfm(),
        scrobbleListenbrainzConnect: (token: string) => service.connectListenbrainz(token),
        scrobbleSetEnabled: (provider: ScrobbleProvider, enabled: boolean) => service.setEnabled(provider, enabled),
        scrobbleDisconnect: (provider: ScrobbleProvider) => service.disconnect(provider),
        scrobbleNowPlaying: (track: ScrobbleTrack) => service.nowPlaying(track),
        scrobbleSubmit: (track: ScrobbleTrack, startedAt: number, listenedMs: number) => service.submit(track, startedAt, listenedMs),
        scrobbleRetry: () => service.retry(),
    };
}

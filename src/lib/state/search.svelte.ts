import { browser } from "$app/environment";
import { client } from "$lib/ephaptic";
import { filterPlaylistRecommendations, filterRecommendationsByArtist } from "$lib/playlist-recommendations";
import type { Artist, CollectionSummary, MusicProvider, Song } from "$lib/schema";
import { slimSong } from "$lib/utils";

const RECENT_KEY = "zeta:recent-searches";

/** Search state lives outside the page so results survive navigation. */
class SearchStore {
    query = $state("");
    lastQuery = $state("");
    provider = $state<MusicProvider>("yt");
    results = $state<Song[]>([]);
    artists = $state<Artist[]>([]);
    albums = $state<CollectionSummary[]>([]);
    playlists = $state<CollectionSummary[]>([]);
    recommendations = $state<Song[]>([]);
    recommendationsLoading = $state(false);
    recommendationsError = $state("");
    loading = $state(false);
    error = $state("");
    recent = $state<string[]>(browser ? JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") : []);

    private seq = 0;

    clear() {
        this.seq++;
        this.query = "";
        this.lastQuery = "";
        this.results = [];
        this.artists = [];
        this.albums = [];
        this.playlists = [];
        this.recommendations = [];
        this.recommendationsLoading = false;
        this.recommendationsError = "";
        this.loading = false;
        this.error = "";
    }

    async run(query = this.query) {
        const q = query.trim();
        if (!q) return;
        this.query = q;
        this.error = "";
        this.recommendations = [];
        this.recommendationsError = "";
        this.recommendationsLoading = false;
        this.loading = true;
        const seq = ++this.seq;
        const provider = $state.snapshot(this.provider);
        try {
            const [results, extras] = await Promise.all([
                client.musicSearch(q, provider),
                client.musicSearchExtras(q, provider).catch(() => ({ artists: [], albums: [], playlists: [] })),
            ]);
            if (seq !== this.seq) return; // a newer search superseded this one
            let playlists = extras.playlists;
            let albums = extras.albums;
            if (provider === "yt" && (playlists.length < 8 || albums.length < 6)) {
                const playlistFallbacks = playlists.length < 8
                    ? Promise.allSettled([
                        client.musicSearchPlaylists(`Top 100 ${q}`, provider),
                        client.musicSearchPlaylists(`Best ${q} songs playlist`, provider),
                    ])
                    : Promise.resolve([]);
                const albumFallback = albums.length < 6
                    ? client.musicSearchAlbums(`${q} albums`, provider).catch(() => [])
                    : Promise.resolve([]);
                const [fallbacks, albumMatches] = await Promise.all([playlistFallbacks, albumFallback]);
                playlists = [
                    ...playlists,
                    ...fallbacks.flatMap((result) => result.status === "fulfilled" ? result.value : []),
                ];
                albums = [...albums, ...albumMatches];
                if (seq !== this.seq) return;
            }
            this.results = results;
            this.artists = extras.artists;
            this.albums = [...new Map(albums.map((album) => [album.id, album])).values()].slice(0, 12);
            this.playlists = [...new Map(playlists.map((playlist) => [playlist.id, playlist])).values()].slice(0, 12);
            this.lastQuery = q;
            this.remember(q);
            if (results.length) void this.loadRecommendations(results, seq);
        } catch (err: any) {
            if (seq === this.seq) this.error = err?.message ?? String(err);
        } finally {
            if (seq === this.seq) this.loading = false;
        }
    }

    private async loadRecommendations(results: Song[], seq: number) {
        this.recommendationsLoading = true;
        try {
            const excludedIds = results.map((song) => song.id);
            const seeds = results.slice(0, 4);
            const batches = await Promise.allSettled(
                seeds.map((seed) => client.musicRadio(slimSong(seed), excludedIds)),
            );
            if (seq !== this.seq) return;
            const songs = batches.flatMap((batch) => batch.status === "fulfilled" ? batch.value : []);
            this.recommendations = filterRecommendationsByArtist(
                filterPlaylistRecommendations(songs, results, 40),
                16,
            );
            const failure = batches.find((batch) => batch.status === "rejected");
            if (failure?.status === "rejected") this.recommendationsError = failure.reason?.message ?? String(failure.reason);
        } catch (err) {
            if (seq === this.seq) this.recommendationsError = err instanceof Error ? err.message : String(err);
        } finally {
            if (seq === this.seq) this.recommendationsLoading = false;
        }
    }

    remember(q: string) {
        this.recent = [q, ...this.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 10);
        localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    }

    forget(q: string) {
        this.recent = this.recent.filter((r) => r !== q);
        localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    }
}

export const searchState = new SearchStore();

import { browser } from "$app/environment";
import { client } from "$lib/ephaptic";
import { libraryState } from "$lib/state/library.svelte";
import { toasts } from "$lib/state/toast.svelte";
import {
    getDownloadQuality,
    getStreamingQuality,
    isAudioQuality,
    saveDownloadQuality,
    saveStreamingQuality,
    type AudioQuality,
} from "$lib/audio-quality";

const PREFER_LOCAL_SEARCH_KEY = "zeta:prefer-local-search-results";

class SettingsStore {
    musicDir = $state<string>("");
    isRemote = $state<boolean>(false);
    discordRpcEnabled = $state<boolean>(false);
    youtubeCookiesConfigured = $state(false);
    youtubeBrowserProfileId = $state<string | null>(null);
    updatingYoutubeCookies = $state(false);
    streamingQuality = $state<AudioQuality>(browser ? getStreamingQuality() : "best");
    downloadQuality = $state<AudioQuality>(browser ? getDownloadQuality() : "best");
    preferLocalSearchResults = $state<boolean>(
        browser && localStorage.getItem(PREFER_LOCAL_SEARCH_KEY) !== "false",
    );
    loading = $state<boolean>(true);
    saving = $state<boolean>(false);

    constructor() {
        if (!browser) return;
        this.load();
    }

    async load() {
        this.loading = true;
        try {
            const { musicDir, isRemote, discordRpcEnabled, youtubeCookiesConfigured, youtubeBrowserProfileId } = await client.getSettings();
            this.musicDir = musicDir;
            this.isRemote = isRemote;
            this.discordRpcEnabled = discordRpcEnabled;
            this.youtubeCookiesConfigured = youtubeCookiesConfigured;
            this.youtubeBrowserProfileId = youtubeBrowserProfileId;
        } catch (err) {
            toasts.error(err);
        } finally {
            this.loading = false;
        }
    }

    /** Open the native folder picker (local dirs only). */
    async pickDirectory(): Promise<string | null> {
        try {
            return await client.pickMusicDirectory();
        } catch (err) {
            toasts.error(err);
            return null;
        }
    }

    /** Switch the music directory (local path or sftp://, ftp:// URL). */
    async setMusicDir(value: string): Promise<boolean> {
        const trimmed = value.trim();
        if (!trimmed) return false;

        this.saving = true;
        try {
            const { playlists, path } = await client.setMusicDir(trimmed);
            libraryState.playlists = playlists;
            libraryState.path = path;
            await this.load();
            toasts.success("Music directory updated.");
            return true;
        } catch (err) {
            toasts.error(err);
            return false;
        } finally {
            this.saving = false;
        }
    }

    async setDiscordRpcEnabled(enabled: boolean) {
        try {
            this.discordRpcEnabled = await client.setDiscordRpcEnabled(enabled);
        } catch (err) {
            toasts.error(err);
        }
    }

    async updateYoutubeCookies(remove = false) {
        this.updatingYoutubeCookies = true;
        try {
            if (remove) {
                await client.clearYoutubeCookies();
                this.youtubeCookiesConfigured = false;
                this.youtubeBrowserProfileId = null;
            } else {
                const configured = await client.pickYoutubeCookies();
                if (configured !== null) {
                    this.youtubeCookiesConfigured = configured;
                    this.youtubeBrowserProfileId = null;
                }
            }
        } catch (err) {
            toasts.error(err);
        } finally {
            this.updatingYoutubeCookies = false;
        }
    }

    async useYoutubeBrowserProfile(id: string) {
        this.updatingYoutubeCookies = true;
        try {
            await client.setYoutubeBrowserProfile(id);
            this.youtubeCookiesConfigured = true;
            this.youtubeBrowserProfileId = id;
        } catch (err) {
            toasts.error(err);
        } finally {
            this.updatingYoutubeCookies = false;
        }
    }

    setStreamingQuality(value: string) {
        if (!isAudioQuality(value)) throw new Error("Invalid streaming quality.");
        try {
            saveStreamingQuality(value);
            this.streamingQuality = value;
        } catch (err) {
            toasts.error(err);
        }
    }

    setDownloadQuality(value: string) {
        if (!isAudioQuality(value)) throw new Error("Invalid download quality.");
        try {
            saveDownloadQuality(value);
            this.downloadQuality = value;
        } catch (err) {
            toasts.error(err);
        }
    }

    setPreferLocalSearchResults(enabled: boolean) {
        try {
            localStorage.setItem(PREFER_LOCAL_SEARCH_KEY, String(enabled));
            this.preferLocalSearchResults = enabled;
        } catch (err) {
            toasts.error(err);
        }
    }

    busyMuzza = $state<false | "export" | "import">(false);

    /** Export the whole library to a Muzza-compatible `.backup` file. */
    async exportToMuzza() {
        if (this.busyMuzza) return;
        this.busyMuzza = "export";
        try {
            const result = await client.muzzaExport();
            if (!result) return; // cancelled
            toasts.success(
                `Exported ${result.songs} songs, ${result.playlists} playlists and ${result.liked} liked songs to Muzza.`,
            );
        } catch (err) {
            toasts.error(err);
        } finally {
            this.busyMuzza = false;
        }
    }

    /** Import a Muzza `.backup` file, merging it into the library. */
    async importFromMuzza() {
        if (this.busyMuzza) return;
        this.busyMuzza = "import";
        try {
            const result = await client.muzzaImport();
            if (!result) return; // cancelled
            await libraryState.refresh();
            toasts.success(
                `Imported ${result.songs} songs, ${result.playlists} playlists and ${result.liked} liked songs from Muzza.`,
            );
        } catch (err) {
            toasts.error(err);
        } finally {
            this.busyMuzza = false;
        }
    }

    busyM3u = $state(false);

    /** Import a local M3U playlist and its referenced audio files. */
    async importM3uPlaylist() {
        if (this.busyM3u) return;
        this.busyM3u = true;
        try {
            const result = await client.m3uImport();
            if (!result) return;
            await libraryState.refresh();
            const skipped = result.skipped ? ` (${result.skipped} entries skipped)` : "";
            toasts.success(`Imported “${result.playlist.name}” with ${result.imported} songs${skipped}.`);
        } catch (err) {
            toasts.error(err);
        } finally {
            this.busyM3u = false;
        }
    }

    busyOnlinePlaylist = $state<false | "spotify" | "youtube">(false);

    /** Import a Spotify CSV exported from Exportify. */
    async importSpotifyPlaylist() {
        if (this.busyOnlinePlaylist) return;
        this.busyOnlinePlaylist = "spotify";
        try {
            const result = await client.spotifyPlaylistImport();
            if (!result) return;
            await libraryState.refresh();
            const skipped = result.skipped ? ` (${result.skipped} tracks skipped)` : "";
            toasts.success(`Imported ${result.imported} Spotify tracks as “${result.playlist.name}”${skipped}.`);
        } catch (err) {
            toasts.error(err);
        } finally {
            this.busyOnlinePlaylist = false;
        }
    }

    /** Import a public YouTube playlist URL. */
    async importYoutubePlaylist(url: string) {
        if (this.busyOnlinePlaylist) return;
        this.busyOnlinePlaylist = "youtube";
        try {
            const result = await client.youtubePlaylistImport(url);
            await libraryState.refresh();
            const skipped = result.skipped ? ` (${result.skipped} tracks skipped)` : "";
            toasts.success(`Imported ${result.imported} YouTube tracks as “${result.playlist.name}”${skipped}.`);
        } catch (err) {
            toasts.error(err);
        } finally {
            this.busyOnlinePlaylist = false;
        }
    }
}

export const settingsState = new SettingsStore();

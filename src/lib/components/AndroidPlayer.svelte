<script lang="ts">
    import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
    import { onMount, untrack } from 'svelte';
    import type { Song } from '$lib/schema';

    interface NativeState { id: string; position: number; duration: number; paused: boolean; ready: boolean; ended: boolean }
    const native = registerPlugin<{
        setSource(options: { uri: string; id: string; title: string; artist: string; artwork?: string; position: number; paused: boolean }): Promise<void>;
        setPaused(options: { paused: boolean }): Promise<void>;
        seek(options: { position: number }): Promise<void>;
        setVolume(options: { volume: number }): Promise<void>;
        clear(): Promise<void>;
        setKeepAwake(options: { enabled: boolean }): Promise<void>;
        addListener(name: 'state', callback: (state: NativeState) => void): Promise<PluginListenerHandle>;
        addListener(name: 'playbackError', callback: (error: { message: string; id?: string }) => void): Promise<PluginListenerHandle>;
    }>('ZetaPlayer');

    let {
        uri, track, paused = $bindable(true), currentTime = $bindable(0), duration = $bindable(0),
        restoreAt = $bindable<number | null>(null), volume = 1, keepAwake = false,
        onended, ontimeupdate, onerror,
    }: {
        uri?: string; track: Song | null; paused?: boolean; currentTime?: number; duration?: number;
        restoreAt?: number | null; volume?: number; keepAwake?: boolean;
        onended: () => void; ontimeupdate: () => void; onerror: (error: Error) => void;
    } = $props();

    let ready = $state(false);
    let loadedUri: string | undefined;
    let nativePosition = 0;
    let endedFor: string | undefined;
    let pendingSource = false;

    onMount(() => {
        let disposed = false;
        const handles: PluginListenerHandle[] = [];
        void Promise.all([
            native.addListener('state', (state) => {
                if (state.id !== track?.id || !uri || pendingSource) return;
                nativePosition = state.position;
                currentTime = state.position;
                duration = state.duration;
                paused = state.paused;
                ontimeupdate();
                if (state.ready && restoreAt !== null) restoreAt = null;
                if (state.ended && endedFor !== state.id) { endedFor = state.id; onended(); }
                if (!state.ended) endedFor = undefined;
            }),
            native.addListener('playbackError', (error) => {
                if (!error.id || error.id === track?.id) onerror(new Error(error.message));
            }),
        ]).then((listeners) => {
            handles.push(...listeners);
            if (disposed) handles.forEach((handle) => void handle.remove());
            else ready = true;
        }).catch(onerror);
        return () => {
            disposed = true;
            handles.forEach((handle) => void handle.remove());
            void native.clear().catch(() => {});
            void native.setKeepAwake({ enabled: false }).catch(() => {});
        };
    });

    $effect(() => {
        if (!ready) return;
        const nextUri = uri;
        const song = track;
        if (loadedUri === nextUri) return;
        loadedUri = nextUri;
        pendingSource = true;
        endedFor = undefined;
        nativePosition = 0;
        const action = nextUri && song ? native.setSource({
            uri: nextUri, id: song.id, title: song.title, artist: song.artists.map((a) => a.name).join(', '),
            artwork: song.thumbnails.find((t) => t.url?.startsWith('https://'))?.url,
            position: untrack(() => restoreAt ?? 0), paused: untrack(() => paused),
        }) : native.clear();
        void action.then(() => { if (loadedUri === nextUri) pendingSource = false; }).catch(onerror);
    });

    $effect(() => {
        if (ready && uri) void native.setPaused({ paused }).catch(onerror);
    });
    $effect(() => {
        if (ready) void native.setVolume({ volume: volume * volume }).catch(onerror);
    });
    $effect(() => {
        if (ready) void native.setKeepAwake({ enabled: !!uri && keepAwake && !paused }).catch(onerror);
    });
    $effect(() => {
        const position = currentTime;
        if (ready && uri && !pendingSource && Math.abs(position - nativePosition) > 0.8) {
            nativePosition = position;
            void native.seek({ position }).catch(onerror);
        }
    });
</script>

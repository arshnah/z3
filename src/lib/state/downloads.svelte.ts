import { client } from '$lib/ephaptic';
import { getDownloadQuality } from '$lib/audio-quality';
import { libraryState } from './library.svelte';
import { slimSong } from '$lib/utils';
import type { Song } from '$lib/schema';

type Job = { song: Song; status: 'queued' | 'downloading' | 'done' | 'failed'; error?: string };

class DownloadQueue {
    jobs = $state<Job[]>([]);
    paused = $state(false);
    private active = false;

    add(songs: Song[]) {
        const known = new Map(this.jobs.map((job) => [job.song.id, job]));
        for (const song of songs) {
            if (!/^(yt|js):/.test(song.id) || song.isDownloaded) continue;
            const existing = known.get(song.id);
            if (existing && existing.status !== 'done') continue;
            const job = { song: slimSong(song), status: 'queued' } as const;
            if (existing) this.jobs[this.jobs.indexOf(existing)] = job;
            else this.jobs.push(job);
            known.set(song.id, job);
        }
        void this.run();
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        if (!paused) void this.run();
    }

    retry() {
        for (const job of this.jobs) if (job.status === 'failed') job.status = 'queued';
        void this.run();
    }

    remove(id: string) {
        this.jobs = this.jobs.filter((job) => job.song.id !== id || job.status === 'downloading');
    }

    clearFinished() {
        this.jobs = this.jobs.filter(({ status }) => status !== 'done');
    }

    private async run() {
        if (this.active) return;
        this.active = true;
        try {
            while (!this.paused) {
                const job = this.jobs.find(({ status }) => status === 'queued');
                if (!job) break;
                job.status = 'downloading';
                job.error = undefined;
                try {
                    const song = await client.musicDownloadSong($state.snapshot(job.song), undefined, getDownloadQuality());
                    libraryState.markDownloaded(song.id, song);
                    job.status = 'done';
                } catch (error) {
                    job.error = error instanceof Error ? error.message : String(error);
                    job.status = 'failed';
                }
            }
        } finally {
            this.active = false;
        }
    }
}

export const downloads = new DownloadQueue();

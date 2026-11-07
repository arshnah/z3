import type { ScrobbleTrack } from './service';
import { qualifiesForScrobble } from './service.ts';

/** Measures audio actually heard, excluding pauses, loading, and seek jumps. */
export class ScrobbleTracker {
    private current?: { track: ScrobbleTrack; startedAt: number; listened: number; position: number; submitted: boolean; announcedAt: number };
    private announce: (track: ScrobbleTrack) => void;
    private submit: (track: ScrobbleTrack, startedAt: number, listened: number) => void;

    constructor(announce: (track: ScrobbleTrack) => void, submit: (track: ScrobbleTrack, startedAt: number, listened: number) => void) {
        this.announce = announce; this.submit = submit;
    }

    tick(track: ScrobbleTrack, position: number, paused: boolean, now = Date.now()) {
        if (this.current?.track.id !== track.id) this.finish();
        if (!this.current) {
            if (paused) return;
            this.current = { track, position, startedAt: now, listened: 0, submitted: false, announcedAt: now };
            this.announce(track);
            return;
        }
        const entry = this.current;
        entry.track = track;
        const delta = position - entry.position;
        entry.position = position;
        if (paused) return;
        if (delta > 0 && delta < 2) entry.listened += delta * 1000;
        if (now - entry.announcedAt >= 5 * 60_000) { entry.announcedAt = now; this.announce(track); }
        if (!entry.submitted && qualifiesForScrobble(track.duration, entry.listened)) {
            entry.submitted = true;
            this.submit(track, entry.startedAt, entry.listened);
        }
    }

    finish() {
        const entry = this.current;
        if (entry && !entry.submitted && qualifiesForScrobble(entry.track.duration, entry.listened)) {
            this.submit(entry.track, entry.startedAt, entry.listened);
        }
        this.current = undefined;
    }
}

import { client } from '$lib/ephaptic';
import type { UpdateStatus } from '$lib/releases';
import { toasts } from '$lib/state/toast.svelte';

class Updates {
    status = $state<UpdateStatus>({ current: '', phase: 'idle' });
    checking = $state(false);
    applying = $state(false);
    private announced = '';

    async check(announce = false) {
        if (this.checking || this.applying || this.status.phase === 'downloading') return;
        this.checking = true;
        try {
            this.status = await client.checkForZetaUpdate();
            if (announce) this.announce();
        } catch (error) {
            if (!announce) toasts.error(error);
        } finally {
            this.checking = false;
        }
    }

    private announce() {
        const { version, phase } = this.status;
        if (!version || version === this.announced || !['available', 'manual', 'ready'].includes(phase)) return;
        this.announced = version;
        toasts.success(phase === 'ready'
            ? `Zeta ${version} is ready to install in Settings → Updates.`
            : `Zeta ${version} is available in Settings → Updates.`);
    }

    async apply() {
        if (this.applying || this.status.phase === 'downloading') return;
        this.applying = true;
        try {
            this.status = await client.applyZetaUpdate();
        } catch (error) {
            toasts.error(error);
        } finally {
            this.applying = false;
        }
    }

    start() {
        void this.check(true);
        const checks = setInterval(() => void this.check(true), 6 * 60 * 60 * 1000);
        const progress = setInterval(() => {
            if (this.status.phase !== 'downloading' && !this.applying) return;
            void client.updateStatus().then((status) => {
                this.status = status;
                if (!this.applying) this.announce();
            }).catch(() => {});
        }, 700);
        return () => { clearInterval(checks); clearInterval(progress); };
    }
}

export const updates = new Updates();

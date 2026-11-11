import { App } from '@capacitor/app';
import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { LATEST_RELEASE_API, RELEASES_URL, newerRelease, type UpdateStatus } from '../releases';

const installer = registerPlugin<{
    install(options: { version: string; size: number; digest: string }): Promise<{ permissionRequired: boolean }>;
}>('ZetaUpdates');

let status: UpdateStatus = { current: '', phase: 'idle' };
let apk: { version: string; size: number; digest: string } | undefined;
let checking: Promise<UpdateStatus> | undefined;

async function check(): Promise<UpdateStatus> {
    if (status.phase === 'downloading') return status;
    try {
        const { version: current } = await App.getInfo();
        const response = await CapacitorHttp.get({
            url: LATEST_RELEASE_API, connectTimeout: 15_000, readTimeout: 15_000, responseType: 'json',
        });
        if (response.status !== 200) throw new Error(`GitHub returned HTTP ${response.status}`);
        const release = newerRelease(response.data, current);
        const asset = release?.assets.find(({ name, state }) => state === 'uploaded' && name === `Zeta-${release.version}-android.apk`);
        const digest = asset?.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
        apk = release && digest && asset?.size && Number.isSafeInteger(asset.size) && asset.size > 0
            ? { version: release.version, size: asset.size, digest } : undefined;
        status = {
            current, version: release?.version, phase: release ? (apk ? 'available' : 'manual') : 'current',
        };
    } catch {
        status = { current: status.current, phase: 'error', message: 'Could not check GitHub for updates.' };
    }
    return status;
}

export const updateRoutes = {
    async updateStatus(): Promise<UpdateStatus> { return status; },
    async checkForZetaUpdate(): Promise<UpdateStatus> {
        return checking ??= check().finally(() => { checking = undefined; });
    },
    async applyZetaUpdate(): Promise<UpdateStatus> {
        if (status.phase === 'manual') {
            await Browser.open({ url: `${RELEASES_URL}/tag/v${status.version}` });
        } else if (status.phase === 'available' && apk) {
            status = { ...status, phase: 'downloading', message: undefined };
            try {
                const { permissionRequired } = await installer.install(apk);
                status = { ...status, phase: 'available', message: permissionRequired
                    ? 'Allow Zeta to install apps in Android settings, then return and tap Install update again.'
                    : 'Finish installing the update in Android’s installer.' };
            } catch (error) {
                status = { ...status, phase: 'available', message: error instanceof Error ? error.message : String(error) };
            }
        }
        return status;
    },
};

import { app, net, shell } from 'electron';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import updater from 'electron-updater';
import { LATEST_RELEASE_API, RELEASES_URL, newerRelease, type UpdateStatus } from '../../src/lib/releases';

const { autoUpdater } = updater;
let status: UpdateStatus = { current: app.getVersion(), phase: 'idle' };
let checking: Promise<UpdateStatus> | undefined;
let downloading: Promise<void> | undefined;

async function useInstaller(): Promise<boolean> {
    if (!app.isPackaged || !existsSync(join(process.resourcesPath, 'app-update.yml'))) return false;
    if (process.platform === 'win32') {
        // MSI and portable installs cannot use the NSIS updater.
        return !process.env.PORTABLE_EXECUTABLE_FILE &&
            existsSync(join(dirname(process.execPath), 'Uninstall Zeta.exe'));
    }
    if (process.platform === 'linux') return !!process.env.APPIMAGE || existsSync(join(process.resourcesPath, 'package-type'));
    if (process.platform !== 'darwin') return false;
    const bundle = dirname(dirname(dirname(process.execPath)));
    try {
        const { stderr } = await promisify(execFile)('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], { timeout: 5000 });
        return /^TeamIdentifier=[A-Z0-9]{10}$/m.test(stderr);
    } catch {
        return false;
    }
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
autoUpdater.disableWebInstaller = true;
autoUpdater.on('error', (error) => console.warn('[updates]', error.message));
autoUpdater.on('download-progress', ({ percent }) => {
    if (status.phase === 'downloading') status = { ...status, progress: Math.round(percent) };
});
autoUpdater.on('update-downloaded', () => {
    status = { ...status, phase: 'ready', progress: undefined };
});

function manualUpdate() {
    status = { ...status, phase: 'manual', progress: undefined, message: 'Get the installer for this device from GitHub.' };
}

async function check(): Promise<UpdateStatus> {
    if (!app.isPackaged || status.phase === 'downloading' || status.phase === 'ready') return status;
    try {
        const response = await net.fetch(LATEST_RELEASE_API, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
        const release = newerRelease(await response.json(), app.getVersion());
        status = release
            ? { current: app.getVersion(), version: release.version, phase: 'available' }
            : { current: app.getVersion(), phase: 'current' };
        if (release) {
            if (await useInstaller()) startDownload();
            else manualUpdate();
        }
    } catch (error) {
        console.warn('[updates] Check failed:', error);
        status = { current: app.getVersion(), phase: 'error', message: 'Could not check GitHub for updates.' };
    }
    return status;
}

async function download(): Promise<void> {
    try {
        const info = await autoUpdater.checkForUpdates();
        if (!info?.isUpdateAvailable || info.updateInfo.version !== status.version) {
            manualUpdate();
            return;
        }
        await autoUpdater.downloadUpdate();
    } catch {
        manualUpdate();
    }
}

function startDownload() {
    if (downloading) return;
    status = { ...status, phase: 'downloading', progress: 0 };
    downloading = download().finally(() => { downloading = undefined; });
}

export const updateRoutes = {
    async updateStatus(): Promise<UpdateStatus> { return status; },
    async checkForZetaUpdate(): Promise<UpdateStatus> {
        return checking ??= check().finally(() => { checking = undefined; });
    },
    async applyZetaUpdate(): Promise<UpdateStatus> {
        if (status.phase === 'ready') {
            autoUpdater.quitAndInstall(false, true);
        } else if (status.phase === 'available') {
            startDownload();
        } else if (status.phase === 'manual') {
            await shell.openExternal(`${RELEASES_URL}/tag/v${status.version}`);
        }
        return status;
    },
};

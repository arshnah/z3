export const RELEASES_URL = 'https://github.com/zeta-zx/z3/releases';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/zeta-zx/z3/releases/latest';

export interface UpdateStatus {
    current: string;
    version?: string;
    phase: 'idle' | 'current' | 'available' | 'downloading' | 'ready' | 'manual' | 'error';
    message?: string;
    progress?: number;
}

function versionParts(value: string): number[] | undefined {
    return /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : undefined;
}

export function newerRelease(data: unknown, current: string) {
    const release = data as { tag_name?: unknown; draft?: boolean; prerelease?: boolean; assets?: unknown } | null;
    if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) return null;
    const version = release.tag_name.slice(1);
    const remote = versionParts(version);
    const local = versionParts(current);
    if (!remote || !local) return null;
    const difference = remote.map((part, index) => part - local[index]).find((part) => part !== 0);
    if (difference === undefined || difference < 0) return null;
    return { version, assets: Array.isArray(release.assets) ? release.assets as Array<{
        name?: string; digest?: string; size?: number; state?: string;
    }> : [] };
}

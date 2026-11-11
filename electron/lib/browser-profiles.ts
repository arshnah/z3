import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

interface BrowserRoot {
    browser: string;
    extractor: string;
    path: string;
}

interface BrowserProfile {
    id: string;
    browser: string;
    name: string;
    ytDlpSource: string;
}

function browserRoots(): BrowserRoot[] {
    const home = homedir();
    const config = process.env.XDG_CONFIG_HOME || join(home, '.config');
    const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const mac = join(home, 'Library', 'Application Support');
    const roots: BrowserRoot[] = [];
    const add = (browser: string, extractor: string, base: string, ...paths: string[]) => {
        for (const path of paths) roots.push({ browser, extractor, path: join(base, path) });
    };

    switch (process.platform) {
        case 'win32':
            add('Helium', 'chromium', local, 'imput/Helium/User Data', 'Helium/User Data');
            add('Firefox', 'firefox', roaming, 'Mozilla/Firefox/Profiles');
            add('Firefox', 'firefox', local, 'Packages/Mozilla.Firefox_n80bbvh6b1yt2/LocalCache/Roaming/Mozilla/Firefox/Profiles');
            add('Chrome', 'chrome', local, 'Google/Chrome/User Data');
            add('Brave', 'brave', local, 'BraveSoftware/Brave-Browser/User Data');
            add('Chromium', 'chromium', local, 'Chromium/User Data');
            add('Edge', 'edge', local, 'Microsoft/Edge/User Data');
            add('Vivaldi', 'vivaldi', local, 'Vivaldi/User Data');
            add('Opera', 'opera', roaming, 'Opera Software/Opera Stable');
            break;
        case 'darwin':
            add('Helium', 'chromium', mac, 'net.imput.helium', 'Helium');
            add('Firefox', 'firefox', mac, 'Firefox/Profiles');
            add('Chrome', 'chrome', mac, 'Google/Chrome');
            add('Brave', 'brave', mac, 'BraveSoftware/Brave-Browser');
            add('Chromium', 'chromium', mac, 'Chromium');
            add('Edge', 'edge', mac, 'Microsoft Edge');
            add('Vivaldi', 'vivaldi', mac, 'Vivaldi');
            add('Opera', 'opera', mac, 'com.operasoftware.Opera');
            break;
        default:
            add('Helium', 'chromium', config, 'net.imput.helium', 'helium');
            add('Firefox', 'firefox', config, 'mozilla/firefox');
            add('Firefox', 'firefox', home, '.mozilla/firefox', 'snap/firefox/common/.mozilla/firefox',
                '.var/app/org.mozilla.firefox/.mozilla/firefox', '.var/app/org.mozilla.firefox/config/mozilla/firefox');
            add('Chrome', 'chrome', config, 'google-chrome');
            add('Brave', 'brave', config, 'BraveSoftware/Brave-Browser');
            add('Chromium', 'chromium', config, 'chromium');
            add('Edge', 'edge', config, 'microsoft-edge');
            add('Vivaldi', 'vivaldi', config, 'vivaldi');
            add('Opera', 'opera', config, 'opera');
            add('Helium', 'chromium', home, '.var/app/net.imput.helium/config/net.imput.helium');
            add('Chrome', 'chrome', home, '.var/app/com.google.Chrome/config/google-chrome');
            add('Brave', 'brave', home, '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser',
                'snap/brave/current/.config/BraveSoftware/Brave-Browser');
            add('Chromium', 'chromium', home, '.var/app/org.chromium.Chromium/config/chromium',
                'snap/chromium/common/chromium');
    }
    return roots;
}

async function profilesInRoot(root: BrowserRoot): Promise<BrowserProfile[]> {
    const children = await readdir(root.path, { withFileTypes: true }).catch(() => []);
    const directories = children
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .filter((entry) => root.extractor === 'firefox' || /^(Default|Profile \d+)$/.test(entry.name))
        .map((entry) => join(root.path, entry.name));
    if (root.extractor === 'opera') directories.push(root.path);

    const profiles = await Promise.all(directories.map(async (path) => {
        // Only check for a profile database. yt-dlp reads the selected profile
        // when it retries a YouTube request.
        const candidates = root.extractor === 'firefox' ? ['cookies.sqlite'] : ['Network/Cookies', 'Cookies'];
        for (const candidate of candidates) {
            const file = await stat(join(path, candidate)).catch(() => null);
            if (!file?.isFile()) continue;
            return {
                id: createHash('sha256').update(root.browser + '\0' + path).digest('hex'),
                browser: root.browser,
                name: basename(path),
                ytDlpSource: `${root.extractor}:${path}`,
            };
        }
        return null;
    }));
    return profiles.filter((profile) => profile !== null);
}

export async function findBrowserProfiles(): Promise<BrowserProfile[]> {
    const profiles = (await Promise.all(browserRoots().map(profilesInRoot))).flat();
    return [...new Map(profiles.map((profile) => [profile.id, profile])).values()]
        .sort((a, b) => a.browser.localeCompare(b.browser) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

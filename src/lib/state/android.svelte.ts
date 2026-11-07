import { browser } from '$app/environment';

const KEY = 'zeta:android-prefs';
function load(): { haptics?: boolean; keepAwake?: boolean } {
    if (!browser) return {};
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

class AndroidPreferences {
    private saved = load();
    haptics = $state(this.saved.haptics !== false);
    keepAwake = $state(this.saved.keepAwake === true);

    save() {
        if (browser) localStorage.setItem(KEY, JSON.stringify({ haptics: this.haptics, keepAwake: this.keepAwake }));
    }
}

export const androidPreferences = new AndroidPreferences();

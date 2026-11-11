const KEY = 'zeta:audio-effects';

function load() {
    try {
        const settings = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        return {
            leveling: settings.leveling === true,
            bands: [0, 1, 2, 3, 4].map((index) => Math.max(-6, Math.min(6, Number(settings.bands?.[index]) || 0))),
        };
    } catch { return { leveling: false, bands: [0, 0, 0, 0, 0] }; }
}
const saved = load();
export const audioEffects = $state(saved);
export const audioFrequencies = [60, 230, 910, 3600, 14000];
export function saveAudioEffects() {
    localStorage.setItem(KEY, JSON.stringify(audioEffects));
}

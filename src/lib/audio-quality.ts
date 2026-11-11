export type AudioQuality = "best" | "high" | "medium" | "low" | "skype-2008";

export const AUDIO_QUALITY_OPTIONS: { value: AudioQuality; label: string; description: string }[] = [
    { value: "best", label: "Best available", description: "Use the highest quality source." },
    { value: "high", label: "High", description: "Prefer audio up to 256 kbps." },
    { value: "medium", label: "Medium", description: "Prefer audio up to 160 kbps." },
    { value: "low", label: "Low", description: "Prefer audio up to 96 kbps." },
    { value: "skype-2008", label: "Skype 2008", description: "The 8 kbps potato mode, for the lolz." },
];

const QUALITY_PREFERENCE_KEYS = {
    streaming: "zeta:streaming-quality",
    download: "zeta:download-quality",
} as const;

export const MAX_BITRATE_KBPS: Record<AudioQuality, number> = {
    best: Infinity,
    high: 256,
    medium: 160,
    low: 96,
    "skype-2008": 8,
};

export function isAudioQuality(value: unknown): value is AudioQuality {
    return value === "best" || value === "high" || value === "medium" || value === "low" || value === "skype-2008";
}

function readQualityPreference(key: string): AudioQuality {
    if (typeof localStorage === "undefined") return "best";
    const value = localStorage.getItem(key);
    return isAudioQuality(value) ? value : "best";
}

export function getStreamingQuality(): AudioQuality {
    return readQualityPreference(QUALITY_PREFERENCE_KEYS.streaming);
}

export function getDownloadQuality(): AudioQuality {
    return readQualityPreference(QUALITY_PREFERENCE_KEYS.download);
}

export function saveStreamingQuality(quality: AudioQuality): void {
    localStorage.setItem(QUALITY_PREFERENCE_KEYS.streaming, quality);
}

export function saveDownloadQuality(quality: AudioQuality): void {
    localStorage.setItem(QUALITY_PREFERENCE_KEYS.download, quality);
}

/** Pick the highest available bitrate that stays at or below the selected tier. */
export function chooseAudioFormat<T>(
    formats: readonly T[],
    quality: AudioQuality,
    getBitrateKbps: (format: T) => number,
): T | undefined {
    const ranked = formats
        .map((format) => ({ format, bitrate: getBitrateKbps(format) }))
        .filter(({ bitrate }) => Number.isFinite(bitrate) && bitrate > 0)
        .sort((a, b) => a.bitrate - b.bitrate);
    if (!ranked.length) return undefined;
    if (quality === "best") return ranked[ranked.length - 1].format;
    return ranked.filter(({ bitrate }) => bitrate <= MAX_BITRATE_KBPS[quality]).at(-1)?.format ?? ranked[0].format;
}

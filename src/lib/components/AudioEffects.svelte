<script lang="ts">
    import { audioEffects, audioFrequencies, saveAudioEffects } from '$lib/state/audio-effects.svelte';

    const isFlat = $derived(audioEffects.bands.every((gain) => gain === 0));

    function formatGain(gain: number) {
        return `${gain > 0 ? '+' : gain < 0 ? '−' : ''}${Math.abs(gain)} dB`;
    }

    function reset() {
        audioEffects.bands = audioFrequencies.map(() => 0);
        saveAudioEffects();
    }
</script>

<div class="card effects">
    <div class="leveling">
        <span id="volume-leveling-label">Consistent volume</span>
        <button class="switch" type="button" role="switch" aria-labelledby="volume-leveling-label"
            aria-checked={audioEffects.leveling} onclick={() => {
                audioEffects.leveling = !audioEffects.leveling;
                saveAudioEffects();
            }}></button>
    </div>

    <section class="equalizer" aria-labelledby="equalizer-label">
        <div class="equalizer-head">
            <h3 id="equalizer-label">Equalizer</h3>
            <button class="btn" type="button" disabled={isFlat} onclick={reset}>Reset equalizer</button>
        </div>
        {#each audioFrequencies as frequency, index (frequency)}
            {@const gain = audioEffects.bands[index]}
            {@const position = (gain + 6) / 12 * 100}
            <div class="band">
                <label for={`equalizer-${frequency}`}>{frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}</label>
                <div class="range" style:--fill-start={`${Math.min(50, position)}%`} style:--fill-end={`${Math.max(50, position)}%`}>
                    <div class="rail" aria-hidden="true"></div>
                    <input id={`equalizer-${frequency}`} type="range" min="-6" max="6" step="1" value={gain}
                        aria-valuetext={formatGain(gain)} oninput={(event) => {
                            audioEffects.bands[index] = event.currentTarget.valueAsNumber;
                            saveAudioEffects();
                        }} />
                </div>
                <span class="gain" class:adjusted={gain !== 0}>{formatGain(gain)}</span>
            </div>
        {/each}
    </section>
</div>

<style>
    .leveling, .equalizer-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .leveling {
        padding: 14px 20px;
        border-bottom: 1px solid var(--border);
        font-weight: 650;
    }
    .leveling .switch { flex-shrink: 0; }
    .equalizer { padding: 12px 20px 16px; }
    .equalizer-head { margin-bottom: 4px; }
    h3 { margin: 0; font-size: 14px; font-weight: 650; }
    .band {
        display: grid;
        grid-template-columns: 4.5rem minmax(0, 1fr) 3.25rem;
        align-items: center;
        gap: 12px;
        min-height: 38px;
        font-size: 13px;
    }
    .gain {
        text-align: right;
        color: var(--text-3);
        font-variant-numeric: tabular-nums;
    }
    .gain.adjusted { color: var(--text); }
    .range {
        --thumb-size: 14px;
        position: relative;
        display: grid;
        align-items: center;
        min-width: 0;
    }
    .rail {
        position: absolute;
        inset: auto calc(var(--thumb-size) / 2);
        height: 4px;
        border-radius: var(--r-full);
        background: linear-gradient(to right,
            var(--border-strong) 0 var(--fill-start),
            var(--accent) var(--fill-start) var(--fill-end),
            var(--border-strong) var(--fill-end) 100%);
        pointer-events: none;
    }
    .rail::after {
        content: '';
        position: absolute;
        top: -2px;
        left: 50%;
        width: 1px;
        height: 8px;
        background: var(--text-3);
    }
    input[type='range'] {
        position: relative;
        appearance: none;
        width: 100%;
        height: 36px;
        margin: 0;
        background: transparent;
        border-radius: var(--r-sm);
        cursor: pointer;
    }
    input[type='range']::-webkit-slider-thumb {
        appearance: none;
        width: var(--thumb-size);
        height: var(--thumb-size);
        border-radius: 50%;
        background: var(--text);
        box-shadow: 0 1px 5px rgb(0 0 0 / 0.35);
    }
    input[type='range']::-moz-range-thumb {
        width: var(--thumb-size);
        height: var(--thumb-size);
        border: 0;
        border-radius: 50%;
        background: var(--text);
        box-shadow: 0 1px 5px rgb(0 0 0 / 0.35);
    }
    input[type='range']:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    @media (max-width: 520px) {
        .leveling, .equalizer { padding-inline: 14px; }
        .band { grid-template-columns: 3.5rem minmax(0, 1fr) 2.75rem; gap: 8px; }
    }
</style>

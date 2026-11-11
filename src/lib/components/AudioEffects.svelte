<script lang="ts">
    import { audioEffects, audioFrequencies, saveAudioEffects } from '$lib/state/audio-effects.svelte';
</script>
<section class="card effects">
    <h2>Sound</h2>
    <label><input type="checkbox" bind:checked={audioEffects.leveling} onchange={saveAudioEffects} /> Consistent volume</label>
    <h3>Equalizer</h3>
    {#each audioFrequencies as frequency, index (frequency)}
        <label class="band">
            <span>{frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}</span>
            <input type="range" min="-6" max="6" step="1" bind:value={audioEffects.bands[index]} oninput={saveAudioEffects} />
            <span>{audioEffects.bands[index]} dB</span>
        </label>
    {/each}
    <button class="btn" onclick={() => { audioEffects.bands = [0, 0, 0, 0, 0]; saveAudioEffects(); }}>Reset equalizer</button>
</section>

<style>
    .effects { display: grid; gap: 10px; padding: 18px; }
    .band { display: grid; grid-template-columns: 65px minmax(100px, 1fr) 50px; align-items: center; gap: 10px; max-width: 440px; }
    button { justify-self: start; }
</style>

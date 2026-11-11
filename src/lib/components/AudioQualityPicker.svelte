<script lang="ts">
    import { Check, ChevronDown, Headphones } from "lucide-svelte";
    import { AUDIO_QUALITY_OPTIONS, type AudioQuality } from "$lib/audio-quality";

    let {
        label,
        value,
        onchange,
    }: {
        label: string;
        value: AudioQuality;
        onchange: (value: AudioQuality) => void;
    } = $props();

    let picker = $state<HTMLDetailsElement>();
    let selected = $derived(AUDIO_QUALITY_OPTIONS.find((option) => option.value === value)!);

    function choose(quality: AudioQuality) {
        onchange(quality);
        if (picker) {
            picker.open = false;
            picker.querySelector("summary")?.focus();
        }
    }

    function onWindowClick(event: MouseEvent) {
        if (picker && event.target instanceof Node && !picker.contains(event.target)) picker.open = false;
    }

    function onWindowKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && picker?.open) {
            picker.open = false;
            picker.querySelector("summary")?.focus();
        }
    }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<details class="picker" bind:this={picker}>
    <summary aria-label={`${label}: ${selected.label}`} aria-haspopup="true">
        <span class="value">
            <span class="icon"><Headphones size={15} /></span>
            <span>{selected.label}</span>
        </span>
        <span class="chevron"><ChevronDown size={16} /></span>
    </summary>
    <div class="options" aria-label={`${label} options`}>
        <p class="menu-heading"><Headphones size={14} /> Choose quality</p>
        {#each AUDIO_QUALITY_OPTIONS as option}
            <button
                type="button"
                class="option"
                class:selected={value === option.value}
                aria-pressed={value === option.value}
                onclick={() => choose(option.value)}
            >
                <span class="option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                </span>
                {#if value === option.value}<span class="check"><Check size={16} /></span>{/if}
            </button>
        {/each}
    </div>
</details>

<style>
    .picker {
        position: relative;
        flex: 0 0 240px;
        color: var(--text);
        z-index: 1;
    }
    .picker[open] {
        z-index: 5;
    }
    summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 36px;
        padding: 0 12px;
        list-style: none;
        cursor: pointer;
        border: 1px solid var(--border-strong);
        border-radius: 11px;
        background: var(--surface-2);
        transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }
    summary::-webkit-details-marker {
        display: none;
    }
    summary:hover,
    .picker[open] summary {
        border-color: var(--accent);
        background: var(--surface-3);
    }
    summary:focus-visible,
    .option:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .value {
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: 13px;
        font-weight: 600;
    }
    .icon {
        display: grid;
        width: 22px;
        height: 22px;
        place-items: center;
        border-radius: 8px;
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 14%, transparent);
    }
    .icon :global(svg) {
        width: 15px;
        height: 15px;
    }
    .chevron {
        display: grid;
        place-items: center;
        flex: none;
        color: var(--text-3);
        transition: transform 140ms ease;
    }
    .chevron :global(svg) {
        width: 16px;
        height: 16px;
    }
    .picker[open] .chevron {
        transform: rotate(180deg);
    }
    .options {
        position: absolute;
        top: calc(100% + 7px);
        right: 0;
        width: 100%;
        padding: 6px;
        border: 1px solid var(--border-strong);
        border-radius: 13px;
        background: rgb(16 13 24);
        box-shadow: 0 12px 32px rgb(0 0 0 / 55%);
        animation: enter 120ms ease-out;
    }
    .menu-heading {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 3px 8px 6px;
        color: var(--text-3);
        font-size: 11px;
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }
    .option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: 8px;
        padding: 7px 10px;
        border: 0;
        border-radius: 8px;
        color: var(--text);
        background: transparent;
        text-align: left;
        cursor: pointer;
        transition: background 120ms ease;
    }
    .option:hover {
        background: rgb(38 34 47);
    }
    .option.selected {
        background: color-mix(in srgb, var(--accent) 22%, rgb(16 13 24));
    }
    .option-copy {
        display: grid;
        gap: 2px;
    }
    .option strong {
        font-size: 13px;
        font-weight: 650;
    }
    .option small {
        color: var(--text-3);
        font-size: 11px;
    }
    .check {
        display: grid;
        place-items: center;
        flex: none;
        color: var(--accent);
    }
    .check :global(svg) {
        width: 16px;
        height: 16px;
    }
    @keyframes enter {
        from {
            opacity: 0;
            transform: translateY(-4px) scale(0.98);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    @media (max-width: 560px) {
        .picker {
            flex-basis: 190px;
        }
    }
</style>

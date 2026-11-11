<script lang="ts">
	import "$lib/styles.css";
	import Toaster from "$lib/components/Toaster.svelte";
	import { onMount } from 'svelte';
	import { isAndroid } from '$lib/platform';
	import { ui } from '$lib/state/ui.svelte';
	import { artworkState } from '$lib/state/artwork.svelte';
	import { androidPreferences } from '$lib/state/android.svelte';

	let { children } = $props();

	$effect(() => {
		document.documentElement.classList.toggle('lite', ui.lite);
		artworkState.restyle();
	});

	onMount(() => {
		if (!isAndroid) return;
		let disposed = false;
		let remove: (() => void) | undefined;
		let lastHaptic = 0;
		const haptic = (event: PointerEvent) => {
			if (!androidPreferences.haptics || Date.now() - lastHaptic < 80) return;
			const button = (event.target as Element).closest('button, a, [role="button"]');
			if (!button || button.hasAttribute('disabled')) return;
			lastHaptic = Date.now();
			void import('@capacitor/haptics').then(({ Haptics }) => Haptics.selectionChanged()).catch(() => {});
		};
		document.addEventListener('pointerup', haptic);
		void import('@capacitor/app').then(async ({ App }) => {
			const listener = await App.addListener('backButton', ({ canGoBack }) => {
				if (ui.dialog) { ui.dialog.resolve(null); ui.dialog = null; }
				else if (ui.menu) ui.closeMenu();
				else if (ui.shortcutsOpen) ui.shortcutsOpen = false;
				else if (ui.nowPlayingOpen) ui.nowPlayingOpen = false;
				else if (ui.sidePanel) { ui.sidePanel = null; ui.save(); }
				else if (canGoBack) history.back();
				else void App.minimizeApp();
			});
			remove = () => void listener.remove();
			if (disposed) remove();
		});
		return () => { disposed = true; remove?.(); document.removeEventListener('pointerup', haptic); };
	});
</script>

<svelte:head>
	<title>Zeta</title>
	<link rel="icon" href="/zeta.png" />
</svelte:head>

{@render children()}

<Toaster />

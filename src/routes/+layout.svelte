<script lang="ts">
	import './layout.css';
	import { CHECKERBOARD_FAVICON_HREF } from '$lib/drawing-svg';
	import { injectAnalytics } from '@vercel/analytics/sveltekit'
	injectAnalytics();

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={CHECKERBOARD_FAVICON_HREF} /></svelte:head>
{@render children()}

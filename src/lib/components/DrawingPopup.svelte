<script lang="ts">
	import type { Drawing } from '$lib/types';

	interface Props {
		drawing: Drawing | null;
		x: number;
		y: number;
		visible: boolean;
	}

	let { drawing, x, y, visible }: Props = $props();

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'numeric',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Position popup above and to the top-right of cursor
	// Keep popup within viewport bounds - estimate pill width at ~350px max
	let adjustedX = $derived(Math.min(Math.max(x + 15, 10), window.innerWidth - 350));
	let adjustedY = $derived(Math.max(y - 35, 10));
</script>

{#if visible && drawing}
	<div
		class="popup"
		style="left: {adjustedX}px; top: {adjustedY}px;"
		role="tooltip"
	>
		<span class="name">{drawing.name}</span>
		<span class="separator"></span>
		<span class="creator">by {drawing.creator}</span>
		<span class="separator"></span>
		<span class="date">{formatDate(drawing.created)}</span>
	</div>
{/if}

<style>
	.popup {
		position: fixed;
		z-index: 1000;
		background: #000;
		padding: 0.25rem 0.5rem;
		border: 1px solid #333;
		pointer-events: none;
		animation: fadeIn 0.15s ease-out;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
		font-size: 0.7rem;
		color: #fff;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(3px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.name {
		font-weight: 600;
		color: #fff;
	}

	.separator {
		width: 3px;
		height: 3px;
		background: #fff;
		flex-shrink: 0;
	}

	.creator {
		font-weight: 400;
	}

	.date {
		font-weight: 400;
	}
</style>


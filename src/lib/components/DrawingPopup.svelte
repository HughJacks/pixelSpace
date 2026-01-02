<script lang="ts">
	import type { Drawing } from '$lib/types';
	import { GRID_SIZE } from '$lib/palette';

	interface Props {
		drawing: Drawing | null;
		x: number;
		y: number;
		visible: boolean;
	}

	let { drawing, x, y, visible }: Props = $props();

	// Render pixels to a small canvas-like grid (grayscale)
	function getPixelStyle(idx: number): string {
		if (!drawing) return 'background-color: #000';
		const gray = drawing.pixels[idx] ?? 255;
		return `background-color: rgb(${gray}, ${gray}, ${gray})`;
	}

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Keep popup within viewport bounds
	let adjustedX = $derived(Math.min(x, window.innerWidth - 250));
	let adjustedY = $derived(Math.min(y, window.innerHeight - 300));
</script>

{#if visible && drawing}
	<div
		class="popup"
		style="left: {adjustedX + 15}px; top: {adjustedY + 15}px;"
		role="tooltip"
	>
		<div class="preview-grid">
			{#each Array(GRID_SIZE * GRID_SIZE) as _, idx}
				<div class="preview-pixel" style={getPixelStyle(idx)}></div>
			{/each}
		</div>

		<div class="info">
			<h3 class="name">{drawing.name}</h3>
			<p class="creator">by <span class="creator-name">{drawing.creator}</span></p>
			<p class="date">{formatDate(drawing.created)}</p>
		</div>
	</div>
{/if}

<style>
	.popup {
		position: fixed;
		z-index: 1000;
		background: #fff;
		border-radius: 12px;
		padding: 16px;
		box-shadow:
			0 8px 32px rgba(0, 0, 0, 0.15),
			0 0 0 1px rgba(0, 0, 0, 0.08);
		pointer-events: none;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-5px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.preview-grid {
		display: grid;
		grid-template-columns: repeat(16, 1fr);
		gap: 0px;
		background-color: #000;
		padding: 1px;
		border-radius: 2px;
		width: 160px;
		height: 160px;
		margin-bottom: 12px;
	}

	.preview-pixel {
		width: 100%;
		height: 100%;
	}

	.info {
		text-align: center;
	}

	.name {
		margin: 0 0 4px 0;
		font-size: 1.1rem;
		font-weight: 700;
		color: #000;
	}

	.creator {
		margin: 0 0 2px 0;
		font-size: 0.85rem;
		color: #666;
	}

	.creator-name {
		color: #000;
		font-weight: 600;
	}

	.date {
		margin: 0;
		font-size: 0.75rem;
		color: #999;
	}
</style>


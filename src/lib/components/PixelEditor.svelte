<script lang="ts">
	import { GRID_SIZE, getDefaultPixels, PALETTE, colorToHex, COLOR_WHITE } from '$lib/palette';

	interface Props {
		pixels?: number[];
		onSave?: (pixels: number[]) => void;
	}

	let { pixels: pixelsProp = getDefaultPixels(), onSave }: Props = $props();

	// Local copy of pixels to avoid mutating props directly
	let pixels = $state([...pixelsProp]);

	// Currently selected color index (0 = black by default)
	let selectedColorIndex = $state(0);
	let isDrawing = $state(false);

	// Convert flat array to 2D grid for easier rendering (color indices)
	let grid = $derived.by(() => {
		const result: number[][] = [];
		for (let y = 0; y < GRID_SIZE; y++) {
			const row: number[] = [];
			for (let x = 0; x < GRID_SIZE; x++) {
				const idx = y * GRID_SIZE + x;
				row.push(pixels[idx] ?? COLOR_WHITE);
			}
			result.push(row);
		}
		return result;
	});

	function getPixelColor(colorIndex: number): string {
		const color = PALETTE[colorIndex] ?? PALETTE[COLOR_WHITE];
		return colorToHex(color);
	}

	function setPixel(x: number, y: number, colorIndex: number) {
		const idx = y * GRID_SIZE + x;
		pixels[idx] = colorIndex;
		pixels = [...pixels];
	}

	function handlePointerDown(x: number, y: number, event: PointerEvent) {
		event.preventDefault();
		isDrawing = true;

		// Right click always erases (white)
		if (event.button === 2) {
			setPixel(x, y, COLOR_WHITE);
		} else {
			setPixel(x, y, selectedColorIndex);
		}
	}

	function handlePointerEnter(x: number, y: number, event: PointerEvent) {
		if (!isDrawing) return;

		if (event.buttons === 2) {
			setPixel(x, y, COLOR_WHITE);
		} else if (event.buttons === 1) {
			setPixel(x, y, selectedColorIndex);
		}
	}

	function handlePointerUp() {
		isDrawing = false;
	}

	function clearCanvas() {
		pixels = getDefaultPixels();
	}

	function handleSave() {
		onSave?.(pixels);
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
	}
</script>

<svelte:window onpointerup={handlePointerUp} />

<div class="pixel-editor">
	<div class="palette-bar">
		{#each PALETTE as color, index}
			<button
				class="color-swatch"
				class:active={selectedColorIndex === index}
				style="background-color: {colorToHex(color)}"
				onclick={() => (selectedColorIndex = index)}
				title={color.name}
			></button>
		{/each}
		<div class="palette-divider"></div>
		<button class="tool-btn" onclick={clearCanvas} title="Clear Canvas">
			Clear
		</button>
	</div>

	<div class="grid-wrapper">
		<div class="grid-container" oncontextmenu={handleContextMenu}>
			{#each grid as row, y}
				{#each row as colorIndex, x}
					<button
						class="pixel"
						style="background-color: {getPixelColor(colorIndex)}"
						onpointerdown={(e) => handlePointerDown(x, y, e)}
						onpointerenter={(e) => handlePointerEnter(x, y, e)}
						aria-label="Pixel {x},{y}"
					></button>
				{/each}
			{/each}
		</div>
	</div>

	{#if onSave}
		<div class="actions">
			<button class="btn-save" onclick={handleSave}>Save Drawing</button>
		</div>
	{/if}
</div>

<style>
	.pixel-editor {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		width: 100%;
	}

	.palette-bar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 0.875rem;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.color-swatch {
		width: 32px;
		height: 32px;
		border: 2px solid #ddd;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
		padding: 0;
	}

	.color-swatch:hover {
		transform: scale(1.1);
		border-color: #999;
	}

	.color-swatch.active {
		border-color: #000;
		box-shadow: 0 0 0 2px #fff, 0 0 0 4px #000;
		transform: scale(1.1);
	}

	.palette-divider {
		width: 1px;
		height: 28px;
		background: #e0e0e0;
		margin: 0 0.5rem;
	}

	.tool-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		background: #f8f8f8;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s ease;
		font-size: 0.85rem;
		font-weight: 500;
		color: #666;
	}

	.tool-btn:hover {
		background: #f0f0f0;
		border-color: #ccc;
		color: #333;
	}

	.grid-wrapper {
		padding: 1px;
		background: #ccc;
		border-radius: 2px;
		box-shadow:
			0 4px 20px rgba(0, 0, 0, 0.12),
			0 0 0 1px rgba(0, 0, 0, 0.08);
	}

	.grid-container {
		display: grid;
		grid-template-columns: repeat(16, 1fr);
		gap: 1px;
		background: #ccc;
		touch-action: none;
		user-select: none;
	}

	.pixel {
		width: clamp(24px, 4vw, 36px);
		height: clamp(24px, 4vw, 36px);
		border: none;
		cursor: crosshair;
		padding: 0;
		transition: transform 0.05s ease;
	}

	.pixel:hover {
		transform: scale(1.05);
		z-index: 1;
		position: relative;
	}

	.actions {
		margin-top: 0.5rem;
	}

	.btn-save {
		padding: 1rem 2.5rem;
		background: #000;
		border: none;
		border-radius: 10px;
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.btn-save:hover {
		background: #222;
		transform: translateY(-2px);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
	}

	.btn-save:active {
		transform: translateY(0);
	}
</style>

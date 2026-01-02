<script lang="ts">
	import { GRID_SIZE, getDefaultPixels, PALETTE, colorToHex, COLOR_WHITE } from '$lib/palette';

	interface Props {
		pixels?: number[];
		onDrawStart?: () => void;
		onDrawEnd?: () => void;
	}

	let { pixels = $bindable(getDefaultPixels()), onDrawStart, onDrawEnd }: Props = $props();

	// Currently selected color index (0 = black by default)
	let selectedColorIndex = $state(0);
	let isDrawing = $state(false);
	let isErasing = $state(false);
	let gridContainer: HTMLDivElement;
	let lastPixelX = -1;
	let lastPixelY = -1;

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
		if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
		const idx = y * GRID_SIZE + x;
		if (pixels[idx] !== colorIndex) {
			pixels[idx] = colorIndex;
			pixels = [...pixels];
		}
	}

	// Get pixel coordinates from pointer position
	function getPixelFromPoint(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!gridContainer) return null;
		
		const rect = gridContainer.getBoundingClientRect();
		const relX = clientX - rect.left;
		const relY = clientY - rect.top;
		
		// Account for 1px gap between pixels
		const cellWidth = rect.width / GRID_SIZE;
		const cellHeight = rect.height / GRID_SIZE;
		
		const x = Math.floor(relX / cellWidth);
		const y = Math.floor(relY / cellHeight);
		
		if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
			return { x, y };
		}
		return null;
	}

	function drawAtPoint(clientX: number, clientY: number) {
		const pixel = getPixelFromPoint(clientX, clientY);
		if (!pixel) return;
		
		// Only draw if we moved to a new pixel
		if (pixel.x === lastPixelX && pixel.y === lastPixelY) return;
		
		lastPixelX = pixel.x;
		lastPixelY = pixel.y;
		
		setPixel(pixel.x, pixel.y, isErasing ? COLOR_WHITE : selectedColorIndex);
	}

	function handlePointerDown(event: PointerEvent) {
		event.preventDefault();
		isDrawing = true;
		isErasing = event.button === 2;
		lastPixelX = -1;
		lastPixelY = -1;
		
		// Capture pointer for smooth dragging
		gridContainer.setPointerCapture(event.pointerId);
		
		// Notify parent that drawing started
		onDrawStart?.();
		
		drawAtPoint(event.clientX, event.clientY);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!isDrawing) return;
		event.preventDefault();
		drawAtPoint(event.clientX, event.clientY);
	}

	function handlePointerUp(event: PointerEvent) {
		if (isDrawing) {
			gridContainer.releasePointerCapture(event.pointerId);
			// Notify parent that drawing ended
			onDrawEnd?.();
		}
		isDrawing = false;
		isErasing = false;
		lastPixelX = -1;
		lastPixelY = -1;
	}

	function clearCanvas() {
		pixels = getDefaultPixels();
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
	}
</script>

<div class="pixel-editor">
	<div class="palette-bar">
		<div class="color-swatches">
			{#each PALETTE as color, index}
				<button
					class="color-swatch"
					class:active={selectedColorIndex === index}
					style="background-color: {colorToHex(color)}"
					onclick={() => (selectedColorIndex = index)}
					title={color.name}
				></button>
			{/each}
		</div>
		<button class="tool-btn" onclick={clearCanvas} title="Clear Canvas">
			Clear
		</button>
	</div>

	<div class="grid-wrapper">
		<div
			class="grid-container"
			bind:this={gridContainer}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			onpointerleave={handlePointerUp}
			oncontextmenu={handleContextMenu}
		>
			{#each grid as row, y}
				{#each row as colorIndex, x}
					<div
						class="pixel"
						style="background-color: {getPixelColor(colorIndex)}"
						aria-label="Pixel {x},{y}"
					></div>
				{/each}
			{/each}
		</div>
	</div>
</div>

<style>
	.pixel-editor {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		max-height: 100%;
		min-height: 0;
	}

	@media (min-width: 768px) {
		.pixel-editor {
			gap: 1.5rem;
		}
	}

	.palette-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
		flex-shrink: 0;
	}

	.color-swatches {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 0.25rem;
	}

	.color-swatch {
		width: 28px;
		height: 28px;
		border: 2px solid #ddd;
		border-radius: 5px;
		cursor: pointer;
		transition: all 0.15s ease;
		padding: 0;
	}

	@media (min-width: 480px) {
		.palette-bar {
			gap: 0.75rem;
			padding: 0.75rem 1rem;
			border-radius: 12px;
		}

		.color-swatches {
			gap: 0.375rem;
		}

		.color-swatch {
			width: 32px;
			height: 32px;
			border-radius: 6px;
		}
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
		/* Fit within viewport - account for name input, palette, save button, creator badge, gaps, and padding */
		--grid-size: min(calc(100vw - 3rem), calc(100dvh - 340px), 450px);
		width: var(--grid-size);
		height: var(--grid-size);
		flex-shrink: 0;
		/* Allow canvas to show through when drawing */
		transition: box-shadow 0.3s ease;
	}

	@media (max-width: 480px) {
		.grid-wrapper {
			/* Mobile: tighter constraints, no creator badge shown */
			--grid-size: min(calc(100vw - 1.5rem), calc(100dvh - 240px));
		}
	}

	.grid-container {
		display: grid;
		grid-template-columns: repeat(16, 1fr);
		gap: 1px;
		background: #ccc;
		touch-action: none;
		user-select: none;
		cursor: crosshair;
	}

	.pixel {
		aspect-ratio: 1;
		width: 100%;
		pointer-events: none;
	}
</style>

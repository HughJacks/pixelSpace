<script lang="ts">
	import { GRID_SIZE, getDefaultPixels } from '$lib/palette';

	interface Props {
		pixels?: number[];
		onSave?: (pixels: number[]) => void;
	}

	let { pixels: pixelsProp = getDefaultPixels(), onSave }: Props = $props();

	// Local copy of pixels to avoid mutating props directly
	let pixels = $state([...pixelsProp]);

	// Tool state: 'draw' = black, 'erase' = white
	let currentTool: 'draw' | 'erase' = $state('draw');
	let isDrawing = $state(false);

	// Convert flat array to 2D grid for easier rendering (grayscale)
	let grid = $derived.by(() => {
		const result: number[][] = [];
		for (let y = 0; y < GRID_SIZE; y++) {
			const row: number[] = [];
			for (let x = 0; x < GRID_SIZE; x++) {
				const idx = y * GRID_SIZE + x;
				row.push(pixels[idx] ?? 255);
			}
			result.push(row);
		}
		return result;
	});

	function setPixel(x: number, y: number, tool: 'draw' | 'erase') {
		const idx = y * GRID_SIZE + x;
		pixels[idx] = tool === 'draw' ? 0 : 255;
		pixels = [...pixels];
	}

	function handlePointerDown(x: number, y: number, event: PointerEvent) {
		event.preventDefault();
		isDrawing = true;

		// Right click always erases
		if (event.button === 2) {
			setPixel(x, y, 'erase');
		} else {
			setPixel(x, y, currentTool);
		}
	}

	function handlePointerEnter(x: number, y: number, event: PointerEvent) {
		if (!isDrawing) return;

		if (event.buttons === 2) {
			setPixel(x, y, 'erase');
		} else if (event.buttons === 1) {
			setPixel(x, y, currentTool);
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
	<div class="toolbar">
		<button
			class="tool-btn"
			class:active={currentTool === 'draw'}
			onclick={() => (currentTool = 'draw')}
			title="Draw (Black)"
		>
			<span class="tool-icon draw"></span>
			<span class="tool-label">Draw</span>
		</button>
		<button
			class="tool-btn"
			class:active={currentTool === 'erase'}
			onclick={() => (currentTool = 'erase')}
			title="Erase (White)"
		>
			<span class="tool-icon erase"></span>
			<span class="tool-label">Erase</span>
		</button>
		<div class="toolbar-divider"></div>
		<button class="tool-btn" onclick={clearCanvas} title="Clear Canvas">
			<span class="tool-label">Clear</span>
		</button>
	</div>

	<div class="grid-wrapper">
		<div class="grid-container" oncontextmenu={handleContextMenu}>
			{#each grid as row, y}
				{#each row as grayValue, x}
					<button
						class="pixel"
						style="background-color: rgb({grayValue}, {grayValue}, {grayValue})"
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

	.toolbar {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.tool-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: #f8f8f8;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s ease;
		font-size: 0.9rem;
		color: #666;
	}

	.tool-btn:hover {
		background: #f0f0f0;
		border-color: #ccc;
		color: #333;
	}

	.tool-btn.active {
		background: #000;
		border-color: #000;
		color: #fff;
	}

	.tool-icon {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		border: 2px solid currentColor;
	}

	.tool-icon.draw {
		background: #000;
		border-color: #000;
	}

	.tool-btn.active .tool-icon.draw {
		border-color: #fff;
	}

	.tool-icon.erase {
		background: #fff;
		border-color: #ccc;
	}

	.tool-btn.active .tool-icon.erase {
		border-color: #666;
	}

	.tool-label {
		font-weight: 500;
	}

	.toolbar-divider {
		width: 1px;
		background: #e0e0e0;
		margin: 0 0.5rem;
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

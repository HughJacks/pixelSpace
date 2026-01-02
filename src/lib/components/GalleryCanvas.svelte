<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Drawing, DrawingWithPosition, UMAPWorkerMessage, UMAPWorkerResponse } from '$lib/types';
	import { GRID_SIZE } from '$lib/palette';
	import DrawingPopup from './DrawingPopup.svelte';

	interface Props {
		drawings: Drawing[];
	}

	let { drawings }: Props = $props();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let container: HTMLDivElement;

	// Transform state
	let scale = $state(1);
	let offsetX = $state(0);
	let offsetY = $state(0);

	// Interaction state
	let isDragging = $state(false);
	let lastMouseX = 0;
	let lastMouseY = 0;

	// Momentum and smoothing state
	let velocityX = 0;
	let velocityY = 0;
	let targetScale = 1;
	let targetOffsetX = 0;
	let targetOffsetY = 0;
	let animating = false;
	const FRICTION = 0.92;
	const ZOOM_SMOOTHING = 0.15;
	const MIN_VELOCITY = 0.1;

	// Popup state
	let hoveredDrawing: Drawing | null = $state(null);
	let mouseX = $state(0);
	let mouseY = $state(0);
	let showPopup = $state(false);

	// UMAP state
	let positions: Map<string, { x: number; y: number }> = $state(new Map());
	let isComputing = $state(false);
	let progress = $state(0);
	let worker: Worker | null = null;

	// Drawing size on canvas
	const DRAWING_SIZE = 48;
	const DRAWING_PADDING = 4;
	const MIN_SPACING = DRAWING_SIZE + DRAWING_PADDING * 2;

	// Bounds of all drawings (for fit-all functionality)
	let bounds = $state({ minX: 0, maxX: 0, minY: 0, maxY: 0 });

	let renderScheduled = false;

	// Drawings with positions for rendering
	let drawingsWithPositions = $derived.by(() => {
		return drawings
			.filter((d) => positions.has(d.id))
			.map((d) => ({
				...d,
				x: positions.get(d.id)!.x,
				y: positions.get(d.id)!.y
			}));
	});

	// Resolve overlapping positions using spatial grid (O(n) per iteration instead of O(n²))
	function resolveCollisions(positionsMap: Map<string, { x: number; y: number }>, minDistance: number, iterations = 8) {
		const entries = Array.from(positionsMap.entries());
		const cellSize = minDistance; // Grid cell size matches min distance
		const minDistSq = minDistance * minDistance;
		
		for (let iter = 0; iter < iterations; iter++) {
			// Build spatial grid
			const grid = new Map<string, number[]>();
			
			for (let i = 0; i < entries.length; i++) {
				const [, p] = entries[i];
				const cellX = Math.floor(p.x / cellSize);
				const cellY = Math.floor(p.y / cellSize);
				const key = `${cellX},${cellY}`;
				
				if (!grid.has(key)) grid.set(key, []);
				grid.get(key)!.push(i);
			}
			
			// Check only neighboring cells
			for (let i = 0; i < entries.length; i++) {
				const [, p1] = entries[i];
				const cellX = Math.floor(p1.x / cellSize);
				const cellY = Math.floor(p1.y / cellSize);
				
				// Check 3x3 neighborhood
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						const key = `${cellX + dx},${cellY + dy}`;
						const neighbors = grid.get(key);
						if (!neighbors) continue;
						
						for (const j of neighbors) {
							if (j <= i) continue; // Skip self and already-checked pairs
							
							const [, p2] = entries[j];
							const distX = p2.x - p1.x;
							const distY = p2.y - p1.y;
							const distSq = distX * distX + distY * distY;
							
							if (distSq < minDistSq && distSq > 0) {
								const dist = Math.sqrt(distSq);
								const overlap = (minDistance - dist) / 2;
								const nx = distX / dist;
								const ny = distY / dist;
								p1.x -= nx * overlap;
								p1.y -= ny * overlap;
								p2.x += nx * overlap;
								p2.y += ny * overlap;
							} else if (distSq === 0) {
								// Identical positions - push apart randomly
								const angle = Math.random() * Math.PI * 2;
								p1.x -= Math.cos(angle) * minDistance / 2;
								p1.y -= Math.sin(angle) * minDistance / 2;
								p2.x += Math.cos(angle) * minDistance / 2;
								p2.y += Math.sin(angle) * minDistance / 2;
							}
						}
					}
				}
			}
		}
	}

	// Schedule a render on next animation frame
	function scheduleRender() {
		if (renderScheduled) return;
		renderScheduled = true;
		requestAnimationFrame(() => {
			renderScheduled = false;
			render();
		});
	}

	// Animation loop for momentum and smooth zoom
	function animate() {
		let needsAnimation = false;

		// Apply momentum (only when not dragging)
		if (!isDragging && (Math.abs(velocityX) > MIN_VELOCITY || Math.abs(velocityY) > MIN_VELOCITY)) {
			offsetX += velocityX;
			offsetY += velocityY;
			velocityX *= FRICTION;
			velocityY *= FRICTION;
			needsAnimation = true;
		}

		// Smooth zoom interpolation
		const scaleDiff = targetScale - scale;
		const offsetXDiff = targetOffsetX - offsetX;
		const offsetYDiff = targetOffsetY - offsetY;

		if (Math.abs(scaleDiff) > 0.001 || Math.abs(offsetXDiff) > 0.5 || Math.abs(offsetYDiff) > 0.5) {
			scale += scaleDiff * ZOOM_SMOOTHING;
			offsetX += offsetXDiff * ZOOM_SMOOTHING;
			offsetY += offsetYDiff * ZOOM_SMOOTHING;
			needsAnimation = true;
		} else if (!isDragging) {
			// Snap to target when close enough
			scale = targetScale;
			offsetX = targetOffsetX;
			offsetY = targetOffsetY;
		}

		if (needsAnimation) {
			scheduleRender();
			requestAnimationFrame(animate);
		} else {
			animating = false;
		}
	}

	function startAnimation() {
		if (!animating) {
			animating = true;
			requestAnimationFrame(animate);
		}
	}

	onMount(() => {
		ctx = canvas.getContext('2d');
		if (ctx) {
			// Disable image smoothing for crisp pixel art
			ctx.imageSmoothingEnabled = false;
		}
		resizeCanvas();

		// Initialize UMAP worker
		worker = new Worker(new URL('$lib/workers/umap.worker.ts', import.meta.url), {
			type: 'module'
		});

		worker.onmessage = (event: MessageEvent<UMAPWorkerResponse>) => {
			const data = event.data;

			if (data.type === 'log') {
				console.log(`[UMAP] ${data.message}`);
				return;
			}
			
			if (data.type === 'progress') {
				progress = ((data.iteration || 0) / (data.totalIterations || 1)) * 100;
			} else if (data.type === 'done' && data.embeddings) {
				console.log(`[GalleryCanvas] UMAP done, got ${data.embeddings.length} embeddings`);
				const postProcessStart = performance.now();
				
				// Map embeddings to drawing IDs
				const newPositions = new Map<string, { x: number; y: number }>();
				
				// Normalize embeddings to fit nicely in the view
				const embeddings = data.embeddings;
				let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
				
				for (const [ex, ey] of embeddings) {
					minX = Math.min(minX, ex);
					maxX = Math.max(maxX, ex);
					minY = Math.min(minY, ey);
					maxY = Math.max(maxY, ey);
				}
				
				const rangeX = maxX - minX || 1;
				const rangeY = maxY - minY || 1;
				const spreadFactor = Math.max(canvas.width, canvas.height) * 1.2;

				// Use untrack to avoid creating reactive dependencies
				const currentDrawings = untrack(() => drawings);
				currentDrawings.forEach((drawing, i) => {
					if (embeddings[i]) {
						const normalizedX = ((embeddings[i][0] - minX) / rangeX - 0.5) * spreadFactor;
						const normalizedY = ((embeddings[i][1] - minY) / rangeY - 0.5) * spreadFactor;
						newPositions.set(drawing.id, { x: normalizedX, y: normalizedY });
					}
				});

				// Push apart any overlapping drawings
				const collisionStart = performance.now();
				resolveCollisions(newPositions, MIN_SPACING);
				console.log(`[GalleryCanvas] Collision resolution: ${(performance.now() - collisionStart).toFixed(1)}ms`);

				positions = newPositions;
				isComputing = false;
				progress = 100;
				console.log(`[GalleryCanvas] Post-UMAP processing: ${(performance.now() - postProcessStart).toFixed(1)}ms`);
				
				// Calculate bounds of all drawings
				let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
				for (const pos of newPositions.values()) {
					bMinX = Math.min(bMinX, pos.x);
					bMaxX = Math.max(bMaxX, pos.x);
					bMinY = Math.min(bMinY, pos.y);
					bMaxY = Math.max(bMaxY, pos.y);
				}
				bounds = { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
				
				// Pre-cache all drawing images for fast rendering
				cacheAllDrawingImages(currentDrawings);
				
				// Fit all drawings in view initially
				fitAllInView();
			}
		};

		return () => {
			worker?.terminate();
		};
	});

	// Track drawings length to trigger UMAP, but use untrack for the actual computation
	// to avoid creating deep reactive dependencies on every pixel value
	let lastDrawingsLength = 0;
	
	$effect(() => {
		const currentLength = drawings.length;
		console.log(`[GalleryCanvas] Effect triggered: ${currentLength} drawings, worker=${!!worker}, isComputing=${isComputing}`);
		
		// Only run UMAP if:
		// 1. We have drawings
		// 2. Worker is ready
		// 3. Not already computing
		// 4. Drawings count has changed (prevents re-running on same data)
		if (currentLength > 0 && worker && !isComputing && currentLength !== lastDrawingsLength) {
			lastDrawingsLength = currentLength;
			// Use untrack to read drawings without creating deep dependencies
			untrack(() => runUMAP());
		}
	});

	// Re-render when transform or positions change
	$effect(() => {
		// Read reactive values to track them
		const _scale = scale;
		const _offsetX = offsetX;
		const _offsetY = offsetY;
		const _drawings = drawingsWithPositions;
		
		if (ctx && _drawings) {
			scheduleRender();
		}
	});

	function runUMAP() {
		// Read drawings without creating reactive dependencies
		const currentDrawings = untrack(() => drawings);
		
		if (!worker || currentDrawings.length === 0) {
			console.log('[GalleryCanvas] runUMAP skipped:', !worker ? 'no worker' : 'no drawings');
			return;
		}

		console.log(`[GalleryCanvas] Starting UMAP with ${currentDrawings.length} drawings`);
		isComputing = true;
		progress = 0;

		// Convert Svelte proxies to plain arrays for worker transfer
		const vectors = currentDrawings.map((d) => [...d.pixels]);
		console.log(`[GalleryCanvas] Prepared ${vectors.length} vectors, each with ${vectors[0]?.length || 0} values`);

		const message: UMAPWorkerMessage = {
			type: 'run',
			vectors,
			config: {
				nNeighbors: 10,
				minDist: 0.1,
				nEpochs: 50
			}
		};

		console.log('[GalleryCanvas] Posting message to UMAP worker...');
		worker.postMessage(message);
	}

	function resizeCanvas() {
		if (!container || !canvas) return;
		const rect = container.getBoundingClientRect();
		canvas.width = rect.width;
		canvas.height = rect.height;
		// Re-apply image smoothing setting after resize
		if (ctx) {
			ctx.imageSmoothingEnabled = false;
		}
		offsetX = canvas.width / 2;
		offsetY = canvas.height / 2;
		targetOffsetX = offsetX;
		targetOffsetY = offsetY;
		targetScale = scale;
		scheduleRender();
	}

	// Calculate the scale needed to fit all drawings in view
	function getMinScaleForBounds(): number {
		if (bounds.minX === bounds.maxX && bounds.minY === bounds.maxY) return 0.1;
		
		const padding = DRAWING_SIZE * 2; // Extra padding around bounds
		const boundsWidth = bounds.maxX - bounds.minX + padding;
		const boundsHeight = bounds.maxY - bounds.minY + padding;
		
		const scaleX = canvas.width / boundsWidth;
		const scaleY = canvas.height / boundsHeight;
		
		return Math.min(scaleX, scaleY, 1) * 0.9; // 0.9 to leave some margin
	}

	// Fit all drawings in the viewport
	function fitAllInView() {
		if (positions.size === 0) return;
		
		const fitScale = getMinScaleForBounds();
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;
		
		targetScale = fitScale;
		targetOffsetX = canvas.width / 2 - centerX * fitScale;
		targetOffsetY = canvas.height / 2 - centerY * fitScale;
		
		// Also set current values for immediate effect on initial load
		scale = fitScale;
		offsetX = targetOffsetX;
		offsetY = targetOffsetY;
		
		startAnimation();
	}

	function render() {
		if (!ctx) return;

		// Clear canvas with white background
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Ensure crisp scaling
		ctx.imageSmoothingEnabled = false;

		// Draw each pixel art
		for (const drawing of drawingsWithPositions) {
			const screenX = drawing.x * scale + offsetX;
			const screenY = drawing.y * scale + offsetY;

			// Skip if off-screen
			const size = DRAWING_SIZE * scale;
			if (
				screenX + size < 0 ||
				screenX - size > canvas.width ||
				screenY + size < 0 ||
				screenY - size > canvas.height
			) {
				continue;
			}

			renderDrawing(drawing, screenX, screenY, size);
		}
	}

	// Cache for rendered drawing ImageBitmaps (much faster than recreating ImageData every frame)
	const drawingImageCache = new Map<string, ImageBitmap>();
	
	// Create an ImageBitmap for a drawing (cached)
	async function getDrawingImage(drawing: Drawing): Promise<ImageBitmap | null> {
		const cached = drawingImageCache.get(drawing.id);
		if (cached) return cached;
		
		// Create ImageData and convert to ImageBitmap (only done once per drawing)
		const imageData = new ImageData(GRID_SIZE, GRID_SIZE);
		const data = imageData.data;
		
		for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
			const gray = drawing.pixels[i] ?? 255;
			const offset = i * 4;
			data[offset] = gray;     // R
			data[offset + 1] = gray; // G
			data[offset + 2] = gray; // B
			data[offset + 3] = 255;  // A
		}
		
		try {
			const bitmap = await createImageBitmap(imageData);
			drawingImageCache.set(drawing.id, bitmap);
			return bitmap;
		} catch {
			return null;
		}
	}
	
	// Pre-cache all drawing images when positions are ready
	async function cacheAllDrawingImages(drawings: Drawing[]) {
		const promises = drawings.map(d => getDrawingImage(d));
		await Promise.all(promises);
	}

	function renderDrawing(drawing: DrawingWithPosition, screenX: number, screenY: number, size: number) {
		if (!ctx) return;

		const x = Math.round(screenX - size / 2);
		const y = Math.round(screenY - size / 2);
		const drawSize = Math.round(size);
		
		// Use cached ImageBitmap if available
		const cached = drawingImageCache.get(drawing.id);
		if (cached) {
			ctx.drawImage(cached, x, y, drawSize, drawSize);
			return;
		}
		
		// Fallback: draw directly if not cached yet (shouldn't happen often)
		const tempCanvas = new OffscreenCanvas(GRID_SIZE, GRID_SIZE);
		const tempCtx = tempCanvas.getContext('2d');
		if (!tempCtx) return;
		
		const imageData = tempCtx.createImageData(GRID_SIZE, GRID_SIZE);
		const data = imageData.data;
		
		for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
			const gray = drawing.pixels[i] ?? 255;
			const offset = i * 4;
			data[offset] = gray;     // R
			data[offset + 1] = gray; // G
			data[offset + 2] = gray; // B
			data[offset + 3] = 255;  // A
		}
		
		tempCtx.putImageData(imageData, 0, 0);
		ctx.drawImage(tempCanvas, x, y, drawSize, drawSize);
		
		// Cache for next time (async, don't wait)
		getDrawingImage(drawing);
	}

	function handleWheel(event: WheelEvent) {
		event.preventDefault();

		const rect = canvas.getBoundingClientRect();
		const mouseCanvasX = event.clientX - rect.left;
		const mouseCanvasY = event.clientY - rect.top;

		// Zoom toward cursor - set target values for smooth animation
		const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05;
		const minScale = Math.min(getMinScaleForBounds(), 1);
		const newScale = Math.max(minScale, Math.min(5, targetScale * zoomFactor));

		// Adjust offset to zoom toward cursor
		targetOffsetX = mouseCanvasX - (mouseCanvasX - targetOffsetX) * (newScale / targetScale);
		targetOffsetY = mouseCanvasY - (mouseCanvasY - targetOffsetY) * (newScale / targetScale);
		targetScale = newScale;

		// Stop any momentum when zooming
		velocityX = 0;
		velocityY = 0;

		startAnimation();
	}

	function handlePointerDown(event: PointerEvent) {
		if (event.button === 0) {
			isDragging = true;
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
			// Stop momentum when starting new drag
			velocityX = 0;
			velocityY = 0;
			canvas.setPointerCapture(event.pointerId);
		}
	}

	function handlePointerMove(event: PointerEvent) {
		mouseX = event.clientX;
		mouseY = event.clientY;

		if (isDragging) {
			const deltaX = event.clientX - lastMouseX;
			const deltaY = event.clientY - lastMouseY;
			
			// Track velocity for momentum
			velocityX = deltaX * 0.8 + velocityX * 0.2;
			velocityY = deltaY * 0.8 + velocityY * 0.2;
			
			// Update position directly while dragging
			offsetX += deltaX;
			offsetY += deltaY;
			targetOffsetX = offsetX;
			targetOffsetY = offsetY;
			
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
			scheduleRender();
			return; // Skip hit detection while dragging for performance
		}

		// Hit detection for hover (only when not dragging)
		const rect = canvas.getBoundingClientRect();
		const canvasX = event.clientX - rect.left;
		const canvasY = event.clientY - rect.top;

		let found: Drawing | null = null;
		const hitSize = (DRAWING_SIZE * scale) / 2 + DRAWING_PADDING * scale;

		for (const drawing of drawingsWithPositions) {
			const screenX = drawing.x * scale + offsetX;
			const screenY = drawing.y * scale + offsetY;

			if (
				Math.abs(canvasX - screenX) < hitSize &&
				Math.abs(canvasY - screenY) < hitSize
			) {
				found = drawing;
				break;
			}
		}

		hoveredDrawing = found;
		showPopup = found !== null;
	}

	function handlePointerUp(event: PointerEvent) {
		isDragging = false;
		canvas.releasePointerCapture(event.pointerId);
		
		// Start momentum animation if we have velocity
		if (Math.abs(velocityX) > MIN_VELOCITY || Math.abs(velocityY) > MIN_VELOCITY) {
			// Set targets ahead based on momentum
			targetOffsetX = offsetX + velocityX * 10;
			targetOffsetY = offsetY + velocityY * 10;
			startAnimation();
		}
	}

	function handlePointerLeave() {
		showPopup = false;
	}
</script>

<svelte:window onresize={resizeCanvas} />

<div class="gallery-container" bind:this={container}>
	{#if isComputing}
		<div class="loading-overlay">
			<div class="loading-content">
				<p class="loading-title">Computing UMAP layout</p>
				<div class="progress-bar">
					<div class="progress-fill" style="width: {progress}%"></div>
				</div>
				<p class="progress-text">{Math.round(progress)}%</p>
			</div>
		</div>
	{/if}

	<canvas
		bind:this={canvas}
		onwheel={handleWheel}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointerleave={handlePointerLeave}
	></canvas>

	<DrawingPopup drawing={hoveredDrawing} x={mouseX} y={mouseY} visible={showPopup} />

	<div class="controls">
		<span class="zoom-level">{Math.round(scale * 100)}%</span>
		<button onclick={() => { targetScale = Math.min(5, targetScale * 1.3); startAnimation(); }}>+</button>
		<button onclick={() => { targetScale = Math.max(getMinScaleForBounds(), targetScale / 1.3); startAnimation(); }}>−</button>
		<button onclick={fitAllInView}>Fit All</button>
	</div>

	{#if drawings.length === 0}
		<div class="empty-state">
			<p>No drawings yet!</p>
			<p class="hint">Be the first to create one.</p>
		</div>
	{/if}
</div>

<style>
	.gallery-container {
		position: relative;
		width: 100%;
		height: 100%;
		background: #fff;
		overflow: hidden;
	}

	canvas {
		width: 100%;
		height: 100%;
		cursor: grab;
		touch-action: none;
		image-rendering: pixelated;
		image-rendering: crisp-edges;
	}

	canvas:active {
		cursor: grabbing;
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		background: rgba(255, 255, 255, 0.95);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.loading-content {
		text-align: center;
		color: #333;
	}

	.loading-title {
		margin: 0 0 16px 0;
		font-size: 1rem;
		font-weight: 600;
		color: #000;
	}

	.progress-bar {
		width: 280px;
		height: 12px;
		background: #e0e0e0;
		border-radius: 6px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #000;
		transition: width 0.15s ease-out;
	}

	.progress-text {
		margin: 12px 0 0 0;
		font-size: 0.9rem;
		font-weight: 500;
		color: #666;
		font-variant-numeric: tabular-nums;
	}

	.controls {
		position: absolute;
		bottom: 16px;
		right: 16px;
		display: flex;
		gap: 8px;
		align-items: center;
		background: rgba(255, 255, 255, 0.95);
		padding: 8px 12px;
		border-radius: 8px;
		border: 1px solid #e0e0e0;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.zoom-level {
		color: #666;
		font-size: 0.85rem;
		font-family: monospace;
		min-width: 48px;
	}

	.controls button {
		background: #fff;
		border: 1px solid #ccc;
		color: #000;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1.1rem;
		transition: all 0.15s ease;
	}

	.controls button:hover {
		background: #f0f0f0;
		border-color: #999;
	}

	.controls button:last-child {
		width: auto;
		padding: 0 12px;
		font-size: 0.85rem;
	}

	.empty-state {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #666;
		pointer-events: none;
	}

	.empty-state p {
		margin: 0;
		font-size: 1.2rem;
	}

	.empty-state .hint {
		font-size: 0.9rem;
		margin-top: 8px;
		color: #999;
	}
</style>


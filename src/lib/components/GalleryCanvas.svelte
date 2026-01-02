<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Drawing, DrawingWithPosition, TSNEWorkerMessage, TSNEWorkerResponse } from '$lib/types';
	import { GRID_SIZE, PALETTE, colorToHex, isLegacyBWFormat, convertLegacyPixels, COLOR_WHITE, pixelsToEncodedValues } from '$lib/palette';
	import DrawingPopup from './DrawingPopup.svelte';

	// ============================================================================
	// Feature Extraction (translation, rotation, reflection invariant)
	// Uses single-value color encoding for compact 64-feature vectors
	// ============================================================================

	// Downsample 16x16 to 8x8 by averaging 2x2 blocks
	function downsample(pixels: number[]): number[] {
		const downsampled: number[] = [];
		for (let by = 0; by < 8; by++) {
			for (let bx = 0; bx < 8; bx++) {
				const i = by * 2 * 16 + bx * 2;
				const avg = (pixels[i] + pixels[i + 1] + pixels[i + 16] + pixels[i + 17]) / 4;
				downsampled.push(avg);
			}
		}
		return downsampled;
	}

	// Center a drawing by moving center of mass to grid center
	// Uses all non-white pixels for center of mass calculation
	function centerDrawing(pixels: number[], encodedValues: number[]): number[] {
		const size = GRID_SIZE;
		const whiteEncoding = 255; // White's encoding value
		const centered = new Array(size * size).fill(whiteEncoding);

		// Find center of mass (weighted by non-white encoded values)
		let sumX = 0,
			sumY = 0,
			totalWeight = 0;
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const val = encodedValues[y * size + x];
				// Non-white pixels contribute to center of mass
				const weight = val !== whiteEncoding ? 1 : 0;
				sumX += x * weight;
				sumY += y * weight;
				totalWeight += weight;
			}
		}

		if (totalWeight === 0) return encodedValues; // Empty drawing

		const comX = sumX / totalWeight;
		const comY = sumY / totalWeight;

		// Shift to center
		const shiftX = Math.round(size / 2 - comX);
		const shiftY = Math.round(size / 2 - comY);

		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const srcX = x - shiftX;
				const srcY = y - shiftY;
				if (srcX >= 0 && srcX < size && srcY >= 0 && srcY < size) {
					centered[y * size + x] = encodedValues[srcY * size + srcX];
				}
			}
		}

		return centered;
	}

	// Rotate 90° clockwise
	function rotate90(pixels: number[], size: number): number[] {
		const rotated = new Array(size * size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				rotated[x * size + (size - 1 - y)] = pixels[y * size + x];
			}
		}
		return rotated;
	}

	// Flip horizontally
	function flipH(pixels: number[], size: number): number[] {
		const flipped = new Array(size * size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				flipped[y * size + (size - 1 - x)] = pixels[y * size + x];
			}
		}
		return flipped;
	}

	// Generate all 8 orientation variants (4 rotations × 2 flips)
	function getAllVariants(pixels: number[], size: number): number[][] {
		const variants: number[][] = [];
		let current = pixels;

		// 4 rotations, each with original and flipped
		for (let r = 0; r < 4; r++) {
			variants.push(current);
			variants.push(flipH(current, size));
			current = rotate90(current, size);
		}

		return variants;
	}

	// Create invariant feature vector using single-value color encoding
	// Returns 64 features (8x8 downsampled, averaged across 8 orientations)
	function extractInvariantFeatures(pixels: number[]): number[] {
		// Convert pixel indices to encoded values (0-255 range based on color)
		const encodedValues = pixelsToEncodedValues(pixels);
		
		// Step 1: Center the drawing (translation invariance)
		const centered = centerDrawing(pixels, encodedValues);

		// Step 2: Get all 8 orientation variants (rotation + reflection invariance)
		const variants = getAllVariants(centered, GRID_SIZE);

		// Step 3: Downsample each variant to 8x8
		const downsampledVariants = variants.map(v => downsample(v));

		// Step 4: Average across all variants for rotation/reflection invariance
		const avgFeature = new Array(64).fill(0);
		for (const variant of downsampledVariants) {
			for (let i = 0; i < 64; i++) {
				avgFeature[i] += variant[i] / 8;
			}
		}

		return avgFeature;
	}

	interface Props {
		drawings: Drawing[];
		onCenterOnDrawing?: (fn: (drawingId: string) => void) => void;
	}

	let { drawings, onCenterOnDrawing }: Props = $props();

	// Expose centerOnDrawing method to parent
	$effect(() => {
		if (onCenterOnDrawing) {
			onCenterOnDrawing(centerOnDrawing);
		}
	});

	// Center the view on a specific drawing by ID
	function centerOnDrawing(drawingId: string) {
		const pos = positions.get(drawingId);
		if (!pos) return;

		// Animate to center on the drawing
		targetOffsetX = canvas.width / 2 - pos.x * targetScale;
		targetOffsetY = canvas.height / 2 - pos.y * targetScale;
		
		// Zoom in a bit for better view
		targetScale = Math.max(targetScale, 2);
		
		// Stop any momentum
		velocityX = 0;
		velocityY = 0;
		
		startAnimation();
	}

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let container: HTMLDivElement;

	// Transform state
	let scale = $state(1.5);
	let offsetX = $state(0);
	let offsetY = $state(0);

	// Interaction state
	let isDragging = $state(false);
	let lastMouseX = 0;
	let lastMouseY = 0;

	// Touch zoom state
	let initialPinchDistance = 0;
	let initialPinchScale = 1;
	let activeTouches: Map<number, { x: number; y: number }> = new Map();

	// Momentum and smoothing state
	let velocityX = 0;
	let velocityY = 0;
	let targetScale = 1.5;
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

	// t-SNE state
	let positions: Map<string, { x: number; y: number }> = $state(new Map());
	let isComputing = $state(false);
	let progress = $state(0);
	let worker: Worker | null = null;

	// Drawing size on canvas
	const DRAWING_SIZE = 48;
	const DRAWING_PADDING = 1;
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

		// Initialize t-SNE worker
		worker = new Worker(new URL('$lib/workers/tsne.worker.ts', import.meta.url), {
			type: 'module'
		});

		worker.onmessage = (event: MessageEvent<TSNEWorkerResponse>) => {
			const data = event.data;
			
			if (data.type === 'progress') {
				progress = ((data.iteration || 0) / (data.totalIterations || 1)) * 100;
			} else if (data.type === 'done' && data.embeddings) {
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
				resolveCollisions(newPositions, MIN_SPACING);

				positions = newPositions;
				isComputing = false;
				progress = 100;
				
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

	// Track drawings length to trigger t-SNE, but use untrack for the actual computation
	// to avoid creating deep reactive dependencies on every pixel value
	let lastDrawingsLength = 0;
	
	$effect(() => {
		const currentLength = drawings.length;
		
		// Only run t-SNE if:
		// 1. We have drawings
		// 2. Worker is ready
		// 3. Not already computing
		// 4. Drawings count has changed (prevents re-running on same data)
		if (currentLength > 0 && worker && !isComputing && currentLength !== lastDrawingsLength) {
			lastDrawingsLength = currentLength;
			// Use untrack to read drawings without creating deep dependencies
			untrack(() => runTSNE());
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

	function runTSNE() {
		// Read drawings without creating reactive dependencies
		const currentDrawings = untrack(() => drawings);

		if (!worker || currentDrawings.length === 0) return;

		isComputing = true;
		progress = 0;

		// Extract invariant features (centered + averaged across 8 orientations)
		// This makes clustering invariant to translation, rotation, and reflection
		const vectors = currentDrawings.map((d) => extractInvariantFeatures([...d.pixels]));

		const message: TSNEWorkerMessage = {
			type: 'run',
			vectors,
			config: {
				perplexity: 30,
				iterations: 500,
				learningRate: 100
			}
		};

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

	// Cache for SVG images (scales perfectly at any size)
	const drawingImageCache = new Map<string, HTMLImageElement>();
	
	// Get hex color for a pixel value (handles both legacy BW and color indices)
	function getPixelHexColor(pixelValue: number): string {
		// Legacy BW format uses values like 0 and 255
		if (pixelValue > 7) {
			// Legacy grayscale - threshold to black or white
			const colorIdx = pixelValue <= 127 ? COLOR_BLACK : COLOR_WHITE;
			return colorToHex(PALETTE[colorIdx]);
		}
		// Color index format (0-7)
		const color = PALETTE[pixelValue] ?? PALETTE[COLOR_WHITE];
		return colorToHex(color);
	}
	
	// Generate SVG string for a drawing's pixels
	function generateSVG(pixels: number[]): string {
		// Use run-length encoding for rows to reduce SVG size
		let rects = '';
		
		for (let y = 0; y < GRID_SIZE; y++) {
			let x = 0;
			while (x < GRID_SIZE) {
				const pixelValue = pixels[y * GRID_SIZE + x] ?? COLOR_WHITE;
				let width = 1;
				
				// Extend run while same color
				while (x + width < GRID_SIZE && pixels[y * GRID_SIZE + x + width] === pixelValue) {
					width++;
				}
				
				// Only render non-white pixels (white is the background)
				// For legacy format: skip 255, for color index: skip 1
				const isWhite = pixelValue === COLOR_WHITE || pixelValue === 255;
				if (!isWhite) {
					const hexColor = getPixelHexColor(pixelValue);
					rects += `<rect x="${x}" y="${y}" width="${width}" height="1" fill="${hexColor}"/>`;
				}
				
				x += width;
			}
		}
		
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_SIZE} ${GRID_SIZE}" shape-rendering="crispEdges"><rect width="${GRID_SIZE}" height="${GRID_SIZE}" fill="#fff"/>${rects}</svg>`;
	}
	
	// Create an Image element from SVG (cached)
	function getDrawingImage(drawing: Drawing): Promise<HTMLImageElement> {
		const cached = drawingImageCache.get(drawing.id);
		if (cached) return Promise.resolve(cached);
		
		return new Promise((resolve) => {
			const svg = generateSVG(drawing.pixels);
			const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
			
			const img = new Image();
			img.onload = () => {
				drawingImageCache.set(drawing.id, img);
				resolve(img);
			};
			img.onerror = () => {
				// Fallback: create a simple placeholder
				resolve(img);
			};
			img.src = dataUrl;
		});
	}
	
	// Pre-cache all drawing images when positions are ready
	async function cacheAllDrawingImages(drawings: Drawing[]) {
		const promises = drawings.map(d => getDrawingImage(d));
		await Promise.all(promises);
		scheduleRender(); // Re-render once all images are cached
	}

	function renderDrawing(drawing: DrawingWithPosition, screenX: number, screenY: number, size: number) {
		if (!ctx) return;

		const drawSize = Math.round(size);
		const x = Math.round(screenX - drawSize / 2);
		const y = Math.round(screenY - drawSize / 2);
		
		// Use cached SVG image if available
		const cached = drawingImageCache.get(drawing.id);
		if (cached) {
			ctx.drawImage(cached, x, y, drawSize, drawSize);
			return;
		}
		
		// Fallback: draw a placeholder while loading
		ctx.fillStyle = '#f0f0f0';
		ctx.fillRect(x, y, drawSize, drawSize);
		
		// Cache and re-render when ready
		getDrawingImage(drawing).then(() => {
			scheduleRender();
		});
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

	// Touch event handlers for pinch-to-zoom
	function handleTouchStart(event: TouchEvent) {
		for (const touch of event.changedTouches) {
			activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
		}

		if (activeTouches.size === 2) {
			// Start pinch gesture
			const touches = Array.from(activeTouches.values());
			const dx = touches[1].x - touches[0].x;
			const dy = touches[1].y - touches[0].y;
			initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
			initialPinchScale = scale;
		}
	}

	function handleTouchMove(event: TouchEvent) {
		// Update touch positions
		for (const touch of event.changedTouches) {
			activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
		}

		if (activeTouches.size === 2 && initialPinchDistance > 0) {
			event.preventDefault();
			
			const touches = Array.from(activeTouches.values());
			const dx = touches[1].x - touches[0].x;
			const dy = touches[1].y - touches[0].y;
			const currentDistance = Math.sqrt(dx * dx + dy * dy);

			// Calculate new scale based on pinch
			const scaleChange = currentDistance / initialPinchDistance;
			const minScale = Math.min(getMinScaleForBounds(), 1);
			const newScale = Math.max(minScale, Math.min(5, initialPinchScale * scaleChange));

			// Get pinch center point
			const rect = canvas.getBoundingClientRect();
			const centerX = (touches[0].x + touches[1].x) / 2 - rect.left;
			const centerY = (touches[0].y + touches[1].y) / 2 - rect.top;

			// Zoom toward pinch center
			const scaleRatio = newScale / scale;
			offsetX = centerX - (centerX - offsetX) * scaleRatio;
			offsetY = centerY - (centerY - offsetY) * scaleRatio;
			scale = newScale;

			targetScale = scale;
			targetOffsetX = offsetX;
			targetOffsetY = offsetY;

			scheduleRender();
		}
	}

	function handleTouchEnd(event: TouchEvent) {
		for (const touch of event.changedTouches) {
			activeTouches.delete(touch.identifier);
		}

		if (activeTouches.size < 2) {
			initialPinchDistance = 0;
		}
	}
</script>

<svelte:window onresize={resizeCanvas} />

<div class="gallery-container" bind:this={container}>
	{#if isComputing}
		<div class="loading-overlay">
			<div class="loading-content">
				<p class="loading-title">Computing t-SNE layout</p>
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
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
		ontouchcancel={handleTouchEnd}
	></canvas>

	<DrawingPopup drawing={hoveredDrawing} x={mouseX} y={mouseY} visible={showPopup} />

	<div class="controls">
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
	}

	.controls button {
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #e0e0e0;
		color: #000;
		padding: 8px 14px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.85rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		transition: all 0.15s ease;
	}

	.controls button:hover {
		background: #f0f0f0;
		border-color: #999;
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


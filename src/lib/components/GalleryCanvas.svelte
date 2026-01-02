<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Drawing, DrawingWithPosition, UMAPWorkerMessage, UMAPWorkerResponse } from '$lib/types';
	import { GRID_SIZE, PALETTE, colorToHex, isLegacyBWFormat, convertLegacyPixels, COLOR_WHITE, COLOR_BLACK, NUM_COLORS } from '$lib/palette';
	import DrawingPopup from './DrawingPopup.svelte';

	// ============================================================================
	// Enhanced Feature Extraction for Strong Clustering
	// Combines spatial, color distribution, adjacency, and symmetry features
	// ============================================================================

	// Normalize pixels to color index format (handles legacy BW data)
	function normalizePixels(pixels: number[]): number[] {
		return isLegacyBWFormat(pixels) ? convertLegacyPixels(pixels) : pixels;
	}

	// --- Color Histogram (8 features) ---
	// Distribution of colors used in the drawing
	function colorHistogram(pixels: number[]): number[] {
		const hist = new Array(NUM_COLORS).fill(0);
		for (const p of pixels) {
			hist[p]++;
		}
		// Normalize to [0, 1]
		const total = pixels.length;
		return hist.map(h => h / total);
	}

	// --- Color Adjacency Matrix (64 features) ---
	// Captures which colors appear next to each other
	function colorAdjacencyMatrix(pixels: number[]): number[] {
		const adj = Array(NUM_COLORS).fill(null).map(() => Array(NUM_COLORS).fill(0));
		
		for (let y = 0; y < GRID_SIZE; y++) {
			for (let x = 0; x < GRID_SIZE; x++) {
				const c1 = pixels[y * GRID_SIZE + x];
				// Check right neighbor
				if (x < GRID_SIZE - 1) {
					const c2 = pixels[y * GRID_SIZE + x + 1];
					adj[c1][c2]++;
					adj[c2][c1]++;
				}
				// Check bottom neighbor
				if (y < GRID_SIZE - 1) {
					const c2 = pixels[(y + 1) * GRID_SIZE + x];
					adj[c1][c2]++;
					adj[c2][c1]++;
				}
			}
		}
		
		// Flatten and normalize
		const flat = adj.flat();
		const sum = flat.reduce((a, b) => a + b, 0) || 1;
		return flat.map(v => v / sum);
	}

	// --- Symmetry Features (4 features) ---
	// Horizontal, vertical, diagonal, and rotational symmetry scores
	function symmetryFeatures(pixels: number[]): number[] {
		let hSym = 0, vSym = 0, dSym = 0, rotSym = 0;
		const total = GRID_SIZE * GRID_SIZE;
		
		for (let y = 0; y < GRID_SIZE; y++) {
			for (let x = 0; x < GRID_SIZE; x++) {
				const p = pixels[y * GRID_SIZE + x];
				// Horizontal symmetry (left-right)
				if (p === pixels[y * GRID_SIZE + (GRID_SIZE - 1 - x)]) hSym++;
				// Vertical symmetry (top-bottom)
				if (p === pixels[(GRID_SIZE - 1 - y) * GRID_SIZE + x]) vSym++;
				// Diagonal symmetry (transpose)
				if (p === pixels[x * GRID_SIZE + y]) dSym++;
				// 180° rotational symmetry
				if (p === pixels[(GRID_SIZE - 1 - y) * GRID_SIZE + (GRID_SIZE - 1 - x)]) rotSym++;
			}
		}
		
		return [hSym / total, vSym / total, dSym / total, rotSym / total];
	}

	// --- Structural Features (6 features) ---
	// Fill ratio, edge density, bounding box, and dispersion
	function structuralFeatures(pixels: number[]): number[] {
		let nonWhiteCount = 0;
		let edgeCount = 0;
		let minX = GRID_SIZE, maxX = 0, minY = GRID_SIZE, maxY = 0;
		let sumX = 0, sumY = 0;
		
		for (let y = 0; y < GRID_SIZE; y++) {
			for (let x = 0; x < GRID_SIZE; x++) {
				const p = pixels[y * GRID_SIZE + x];
				if (p !== COLOR_WHITE) {
					nonWhiteCount++;
					sumX += x;
					sumY += y;
					minX = Math.min(minX, x);
					maxX = Math.max(maxX, x);
					minY = Math.min(minY, y);
					maxY = Math.max(maxY, y);
					
					// Count color transitions (edges)
					if (x < GRID_SIZE - 1 && pixels[y * GRID_SIZE + x + 1] !== p) edgeCount++;
					if (y < GRID_SIZE - 1 && pixels[(y + 1) * GRID_SIZE + x] !== p) edgeCount++;
				}
			}
		}
		
		const total = GRID_SIZE * GRID_SIZE;
		const fillRatio = nonWhiteCount / total;
		const edgeDensity = edgeCount / (2 * (GRID_SIZE - 1) * GRID_SIZE); // Normalize by max edges
		
		// Bounding box aspect ratio and coverage
		const bbWidth = maxX >= minX ? maxX - minX + 1 : 0;
		const bbHeight = maxY >= minY ? maxY - minY + 1 : 0;
		const bbAspect = bbHeight > 0 ? bbWidth / bbHeight : 1;
		const bbCoverage = (bbWidth * bbHeight) / total;
		
		// Centroid dispersion (how spread out the drawing is from its center)
		let dispersion = 0;
		if (nonWhiteCount > 0) {
			const centX = sumX / nonWhiteCount;
			const centY = sumY / nonWhiteCount;
			for (let y = 0; y < GRID_SIZE; y++) {
				for (let x = 0; x < GRID_SIZE; x++) {
					if (pixels[y * GRID_SIZE + x] !== COLOR_WHITE) {
						dispersion += Math.sqrt((x - centX) ** 2 + (y - centY) ** 2);
					}
				}
			}
			dispersion /= (nonWhiteCount * GRID_SIZE); // Normalize
		}
		
		return [fillRatio, edgeDensity, bbAspect / 2, bbCoverage, dispersion, nonWhiteCount / total];
	}

	// --- Connected Components (4 features) ---
	// Number and size distribution of distinct regions
	function connectedComponentFeatures(pixels: number[]): number[] {
		const visited = new Set<number>();
		const componentSizes: number[] = [];
		
		function floodFill(start: number, color: number): number {
			const stack = [start];
			let size = 0;
			while (stack.length > 0) {
				const idx = stack.pop()!;
				if (visited.has(idx) || pixels[idx] !== color) continue;
				visited.add(idx);
				size++;
				
				const x = idx % GRID_SIZE, y = Math.floor(idx / GRID_SIZE);
				if (x > 0) stack.push(idx - 1);
				if (x < GRID_SIZE - 1) stack.push(idx + 1);
				if (y > 0) stack.push(idx - GRID_SIZE);
				if (y < GRID_SIZE - 1) stack.push(idx + GRID_SIZE);
			}
			return size;
		}
		
		for (let i = 0; i < pixels.length; i++) {
			if (!visited.has(i) && pixels[i] !== COLOR_WHITE) {
				componentSizes.push(floodFill(i, pixels[i]));
			}
		}
		
		const total = pixels.length;
		const numComponents = componentSizes.length;
		
		if (numComponents === 0) {
			return [0, 0, 0, 0];
		}
		
		const largest = Math.max(...componentSizes) / total;
		const smallest = Math.min(...componentSizes) / total;
		const mean = componentSizes.reduce((a, b) => a + b, 0) / numComponents / total;
		
		return [
			Math.min(numComponents / 10, 1), // Normalized component count (cap at 10)
			largest,
			smallest,
			mean
		];
	}

	// --- Downsampled Spatial Features (16 features) ---
	// 4x4 downsampled non-white density per region
	function downsampledSpatial(pixels: number[]): number[] {
		const features: number[] = [];
		const blockSize = GRID_SIZE / 4; // 4x4 blocks
		
		for (let by = 0; by < 4; by++) {
			for (let bx = 0; bx < 4; bx++) {
				let nonWhite = 0;
				for (let dy = 0; dy < blockSize; dy++) {
					for (let dx = 0; dx < blockSize; dx++) {
						const x = bx * blockSize + dx;
						const y = by * blockSize + dy;
						if (pixels[y * GRID_SIZE + x] !== COLOR_WHITE) {
							nonWhite++;
						}
					}
				}
				features.push(nonWhite / (blockSize * blockSize));
			}
		}
		
		return features;
	}

	// --- Combined Enhanced Feature Extraction ---
	// Total: 8 + 64 + 4 + 6 + 4 + 16 = 102 features
	function extractEnhancedFeatures(pixels: number[]): number[] {
		const normalized = normalizePixels(pixels);
		
		return [
			...colorHistogram(normalized),           // 8: color distribution
			...colorAdjacencyMatrix(normalized),     // 64: color relationships
			...symmetryFeatures(normalized),         // 4: symmetry scores
			...structuralFeatures(normalized),       // 6: shape metrics
			...connectedComponentFeatures(normalized), // 4: region analysis
			...downsampledSpatial(normalized)        // 16: spatial density
		];
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
	let initialPinchOffsetX = 0;
	let initialPinchOffsetY = 0;
	let pinchCenterX = 0;
	let pinchCenterY = 0;
	let isPinching = false;
	let activeTouches: Map<number, { x: number; y: number }> = new Map();

	// Tap detection for mobile
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	const TAP_THRESHOLD = 10; // max movement in pixels
	const TAP_DURATION = 300; // max duration in ms

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

	// UMAP state
	let positions: Map<string, { x: number; y: number }> = $state(new Map());
	let isComputing = $state(false);
	let progress = $state(0);
	let worker: Worker | null = null;

	// Drawing size on canvas
	const DRAWING_SIZE = 48;
	const DRAWING_PADDING = 20;
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
				// Optional: log UMAP progress messages
				// console.log('[UMAP]', data.message);
			} else if (data.type === 'progress') {
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

	// Track drawings length to trigger UMAP, but use untrack for the actual computation
	// to avoid creating deep reactive dependencies on every pixel value
	let lastDrawingsLength = 0;
	
	$effect(() => {
		const currentLength = drawings.length;
		
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

		if (!worker || currentDrawings.length === 0) return;

		isComputing = true;
		progress = 0;

		// Extract enhanced feature vectors for better clustering
		// 102 features: color histogram, adjacency, symmetry, structure, components, spatial
		const vectors = currentDrawings.map((d) => extractEnhancedFeatures([...d.pixels]));

		// Dynamic config based on dataset size
		const n = vectors.length;
		const nNeighbors = Math.min(15, Math.max(5, Math.floor(n / 5)));
		const nEpochs = n < 50 ? 100 : n < 200 ? 150 : 200;

		const message: UMAPWorkerMessage = {
			type: 'run',
			vectors,
			config: {
				nNeighbors,
				minDist: 0.1,
				nEpochs
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
		// Skip if pinching (touch events handle this)
		if (isPinching || event.pointerType === 'touch') return;
		
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
		// Skip if pinching (touch events handle this)
		if (isPinching || event.pointerType === 'touch') return;
		
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
		// Skip if touch (touch events handle this)
		if (event.pointerType === 'touch') return;
		
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

	// Find drawing at screen coordinates
	function findDrawingAtPoint(clientX: number, clientY: number): Drawing | null {
		const rect = canvas.getBoundingClientRect();
		const canvasX = clientX - rect.left;
		const canvasY = clientY - rect.top;

		const hitSize = (DRAWING_SIZE * scale) / 2 + DRAWING_PADDING * scale;

		for (const drawing of drawingsWithPositions) {
			const screenX = drawing.x * scale + offsetX;
			const screenY = drawing.y * scale + offsetY;

			if (
				Math.abs(canvasX - screenX) < hitSize &&
				Math.abs(canvasY - screenY) < hitSize
			) {
				return drawing;
			}
		}
		return null;
	}

	// Touch event handlers for pinch-to-zoom and panning
	function handleTouchStart(event: TouchEvent) {
		// Clear stale touches and rebuild from current event
		activeTouches.clear();
		for (let i = 0; i < event.touches.length; i++) {
			const touch = event.touches[i];
			activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
		}

		if (event.touches.length === 2) {
			// Prevent browser handling of pinch/pan
			event.preventDefault();
			
			// Start pinch gesture
			isPinching = true;
			isDragging = false;
			velocityX = 0;
			velocityY = 0;
			
			const t0 = event.touches[0];
			const t1 = event.touches[1];
			const dx = t1.clientX - t0.clientX;
			const dy = t1.clientY - t0.clientY;
			
			initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
			initialPinchScale = scale;
			initialPinchOffsetX = offsetX;
			initialPinchOffsetY = offsetY;
			
			// Store initial pinch center (in canvas coordinates)
			const rect = canvas.getBoundingClientRect();
			pinchCenterX = (t0.clientX + t1.clientX) / 2 - rect.left;
			pinchCenterY = (t0.clientY + t1.clientY) / 2 - rect.top;
		} else if (event.touches.length === 1) {
			// Record for tap detection
			touchStartX = event.touches[0].clientX;
			touchStartY = event.touches[0].clientY;
			touchStartTime = Date.now();
			
			// Single touch - start drag
			isDragging = true;
			lastMouseX = event.touches[0].clientX;
			lastMouseY = event.touches[0].clientY;
			velocityX = 0;
			velocityY = 0;
		}
	}

	function handleTouchMove(event: TouchEvent) {
		// Update touch positions
		for (let i = 0; i < event.touches.length; i++) {
			const touch = event.touches[i];
			activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
		}

		if (event.touches.length === 2 && isPinching && initialPinchDistance > 0) {
			event.preventDefault();
			
			const t0 = event.touches[0];
			const t1 = event.touches[1];
			const dx = t1.clientX - t0.clientX;
			const dy = t1.clientY - t0.clientY;
			const currentDistance = Math.sqrt(dx * dx + dy * dy);

			// Calculate new scale based on pinch
			const scaleChange = currentDistance / initialPinchDistance;
			const minScale = Math.min(getMinScaleForBounds(), 0.5);
			const newScale = Math.max(minScale, Math.min(5, initialPinchScale * scaleChange));

			// Current pinch center
			const rect = canvas.getBoundingClientRect();
			const currentCenterX = (t0.clientX + t1.clientX) / 2 - rect.left;
			const currentCenterY = (t0.clientY + t1.clientY) / 2 - rect.top;

			// Calculate new offset to keep initial pinch point stationary
			// The world point under the initial pinch center should stay under the current center
			const worldX = (pinchCenterX - initialPinchOffsetX) / initialPinchScale;
			const worldY = (pinchCenterY - initialPinchOffsetY) / initialPinchScale;
			
			offsetX = currentCenterX - worldX * newScale;
			offsetY = currentCenterY - worldY * newScale;
			scale = newScale;

			targetScale = scale;
			targetOffsetX = offsetX;
			targetOffsetY = offsetY;

			scheduleRender();
		} else if (event.touches.length === 1 && isDragging && !isPinching) {
			// Single touch pan
			const touch = event.touches[0];
			const deltaX = touch.clientX - lastMouseX;
			const deltaY = touch.clientY - lastMouseY;
			
			// Track velocity for momentum
			velocityX = deltaX * 0.8 + velocityX * 0.2;
			velocityY = deltaY * 0.8 + velocityY * 0.2;
			
			offsetX += deltaX;
			offsetY += deltaY;
			targetOffsetX = offsetX;
			targetOffsetY = offsetY;
			
			lastMouseX = touch.clientX;
			lastMouseY = touch.clientY;
			
			scheduleRender();
		}
	}

	function handleTouchEnd(event: TouchEvent) {
		// Get the ended touch for tap detection
		const endedTouch = event.changedTouches[0];
		
		// Update active touches from remaining touches
		activeTouches.clear();
		for (let i = 0; i < event.touches.length; i++) {
			const touch = event.touches[i];
			activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
		}

		if (event.touches.length < 2) {
			// End pinch
			if (isPinching) {
				isPinching = false;
				initialPinchDistance = 0;
				
				// If one finger remains, transition to pan
				if (event.touches.length === 1) {
					isDragging = true;
					lastMouseX = event.touches[0].clientX;
					lastMouseY = event.touches[0].clientY;
					velocityX = 0;
					velocityY = 0;
				}
			}
		}

		if (event.touches.length === 0) {
			// All fingers lifted
			const wasDragging = isDragging;
			isDragging = false;
			isPinching = false;
			
			// Check if this was a tap (minimal movement, short duration)
			if (endedTouch && wasDragging) {
				const dx = endedTouch.clientX - touchStartX;
				const dy = endedTouch.clientY - touchStartY;
				const distance = Math.sqrt(dx * dx + dy * dy);
				const duration = Date.now() - touchStartTime;
				
				if (distance < TAP_THRESHOLD && duration < TAP_DURATION) {
					// This was a tap - check if we tapped on a drawing
					const tappedDrawing = findDrawingAtPoint(endedTouch.clientX, endedTouch.clientY);
					
					if (tappedDrawing) {
						// Show popup for tapped drawing
						hoveredDrawing = tappedDrawing;
						mouseX = endedTouch.clientX;
						mouseY = endedTouch.clientY;
						showPopup = true;
					} else {
						// Tapped empty space - dismiss popup
						showPopup = false;
						hoveredDrawing = null;
					}
					return; // Don't start momentum after tap
				}
			}
			
			// Start momentum animation (only if not a tap)
			if (Math.abs(velocityX) > MIN_VELOCITY || Math.abs(velocityY) > MIN_VELOCITY) {
				targetOffsetX = offsetX + velocityX * 10;
				targetOffsetY = offsetY + velocityY * 10;
				startAnimation();
			}
		}
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


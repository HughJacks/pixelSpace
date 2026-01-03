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
	// Also validates and fixes any malformed data
	function normalizePixels(pixels: number[]): number[] {
		const expectedLength = GRID_SIZE * GRID_SIZE;
		let normalized = isLegacyBWFormat(pixels) ? convertLegacyPixels(pixels) : [...pixels];
		
		// Ensure array is the correct length
		if (normalized.length < expectedLength) {
			// Pad with white pixels
			normalized = [...normalized, ...new Array(expectedLength - normalized.length).fill(COLOR_WHITE)];
		} else if (normalized.length > expectedLength) {
			normalized = normalized.slice(0, expectedLength);
		}
		
		// Ensure all values are valid color indices (0 to NUM_COLORS-1)
		for (let i = 0; i < normalized.length; i++) {
			const val = normalized[i];
			if (val === undefined || val === null || val < 0 || val >= NUM_COLORS) {
				normalized[i] = COLOR_WHITE; // Default to white for invalid values
			}
		}
		
		return normalized;
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
				const c1 = pixels[y * GRID_SIZE + x] ?? COLOR_WHITE;
				// Skip invalid color indices
				if (c1 < 0 || c1 >= NUM_COLORS) continue;
				
				// Check right neighbor
				if (x < GRID_SIZE - 1) {
					const c2 = pixels[y * GRID_SIZE + x + 1] ?? COLOR_WHITE;
					if (c2 >= 0 && c2 < NUM_COLORS) {
						adj[c1][c2]++;
						adj[c2][c1]++;
					}
				}
				// Check bottom neighbor
				if (y < GRID_SIZE - 1) {
					const c2 = pixels[(y + 1) * GRID_SIZE + x] ?? COLOR_WHITE;
					if (c2 >= 0 && c2 < NUM_COLORS) {
						adj[c1][c2]++;
						adj[c2][c1]++;
					}
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

	// --- Combined Enhanced Feature Extraction with Weights ---
	// Total: 8 + 64 + 4 + 6 + 4 + 16 = 102 features
	function extractEnhancedFeatures(pixels: number[], weights: {
		colorHist: number;
		adjacency: number;
		symmetry: number;
		structure: number;
		components: number;
		spatial: number;
	}): number[] {
		const normalized = normalizePixels(pixels);
		
		// Apply weights by scaling feature groups
		const applyWeight = (features: number[], weight: number) => 
			features.map(f => f * weight);
		
		return [
			...applyWeight(colorHistogram(normalized), weights.colorHist),
			...applyWeight(colorAdjacencyMatrix(normalized), weights.adjacency),
			...applyWeight(symmetryFeatures(normalized), weights.symmetry),
			...applyWeight(structuralFeatures(normalized), weights.structure),
			...applyWeight(connectedComponentFeatures(normalized), weights.components),
			...applyWeight(downsampledSpatial(normalized), weights.spatial)
		];
	}

	interface Props {
		drawings: Drawing[];
		onCenterOnDrawing?: (fn: (drawingId: string) => void) => void;
		// Preview mode props - for showing where a new drawing would land
		previewMode?: boolean;
		previewPixels?: number[];
	}

	let { drawings, onCenterOnDrawing, previewMode = false, previewPixels = [] }: Props = $props();

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

		// Zoom in a bit for better view - must update scale BEFORE calculating offsets
		targetScale = Math.max(targetScale, 2);
		
		// Animate to center on the drawing (using the updated targetScale)
		targetOffsetX = canvas.width / 2 - pos.x * targetScale;
		targetOffsetY = canvas.height / 2 - pos.y * targetScale;
		
		// Stop any momentum
		velocityX = 0;
		velocityY = 0;
		
		startAnimation();
	}

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let container: HTMLDivElement;

	// Transform state
	let scale = $state(2.5);
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
	let targetScale = 2.5;
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
	let targetPositions: Map<string, { x: number; y: number }> = new Map();
	let isComputing = $state(false);
	let progress = $state(0);
	let worker: Worker | null = null;
	let isAnimatingPositions = $state(false);
	let positionAnimationProgress = 0;
	let oldPositions: Map<string, { x: number; y: number }> = new Map();

	// Intro animation state
	let isFirstLoad = true;
	let introComplete = $state(false);
	let drawingOpacities: Map<string, number> = $state(new Map());
	let introAnimationPhase: 'idle' | 'fadein' | 'waiting' | 'clustering' = $state('idle');
	const FADE_IN_DURATION = 800; // Total duration for all fade-ins
	const FADE_IN_STAGGER = 25; // Delay between each drawing
	const WAIT_BEFORE_CLUSTER = 600; // Pause before clustering animation
	const INTRO_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes - show intro again after this long
	const GALLERY_LAST_SEEN_KEY = 'pixelspace_gallery_last_seen';
	
	// Check if we should show the intro animation
	function shouldShowIntroAnimation(): boolean {
		if (typeof window === 'undefined') return true;
		
		try {
			const lastSeen = localStorage.getItem(GALLERY_LAST_SEEN_KEY);
			if (!lastSeen) return true; // Never seen before - show intro
			
			const lastSeenTime = parseInt(lastSeen, 10);
			const now = Date.now();
			const timeSinceLastSeen = now - lastSeenTime;
			
			// Show intro if it's been more than the cooldown period
			return timeSinceLastSeen > INTRO_COOLDOWN_MS;
		} catch {
			return true; // On error, default to showing intro
		}
	}
	
	// Mark that the user has seen the gallery
	function markGallerySeen() {
		if (typeof window === 'undefined') return;
		
		try {
			localStorage.setItem(GALLERY_LAST_SEEN_KEY, Date.now().toString());
		} catch {
			// Ignore storage errors
		}
	}

	// Preview mode state - for predicting where new drawing would land
	let previewPosition: { x: number; y: number } | null = $state(null);
	let lastPreviewFeatures: number[] | null = null;
	let previewComputeTimeout: ReturnType<typeof setTimeout> | null = null;
	let cachedDrawingFeatures: Map<string, number[]> = new Map();

	// Control panel state
	let showControlPanel = $state(false);
	
	// Visualization mode: 'cluster' (2D UMAP) or 'timeline' (X=time, Y=1D UMAP)
	type VisualizationMode = 'cluster' | 'timeline';
	let visualizationMode = $state<VisualizationMode>('cluster');
	
	// Store last UMAP embeddings to reuse when switching modes
	let lastEmbeddings: [number, number][] | null = null;
	let lastDrawingIds: string[] = [];
	
	// Timeline axis data (for rendering the time axis)
	let timelineRange: { minTime: number; maxTime: number; spreadFactor: number } | null = null;
	
	// User-friendly feature weights (0-2 range, 1 = normal)
	// These map to the technical feature groups internally
	let weightColor = $state(1);  // → color histogram
	let weightShape = $state(1);  // → structure + components + spatial
	let weightStyle = $state(1);  // → adjacency + symmetry
	
	// UMAP parameters
	let paramNeighbors = $state(15);
	let paramMinDist = $state(0.1);
	let paramEpochs = $state(150);

	// Drawing size on canvas
	const DRAWING_SIZE = 56;
	const DRAWING_PADDING = 24;
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

	// Compute cosine similarity between two feature vectors
	function cosineSimilarity(a: number[], b: number[]): number {
		let dot = 0, magA = 0, magB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			magA += a[i] * a[i];
			magB += b[i] * b[i];
		}
		if (magA === 0 || magB === 0) return 0;
		return dot / (Math.sqrt(magA) * Math.sqrt(magB));
	}

	// Compute predicted position for preview drawing using k-nearest neighbors
	function computePreviewPosition(pixels: number[]): { x: number; y: number } | null {
		if (positions.size === 0 || !pixels || pixels.length === 0) return null;
		
		// Check if the drawing has any content (non-white pixels)
		const hasContent = pixels.some(p => p !== COLOR_WHITE);
		if (!hasContent) return null;
		
		// Get current feature weights
		const weights = {
			colorHist: weightColor,
			adjacency: weightStyle,
			symmetry: weightStyle,
			structure: weightShape,
			components: weightShape,
			spatial: weightShape
		};
		
		// Extract features for preview
		const previewFeatures = extractEnhancedFeatures([...pixels], weights);
		
		// Cache features for existing drawings if not already cached
		const currentDrawings = untrack(() => drawings);
		for (const drawing of currentDrawings) {
			if (!cachedDrawingFeatures.has(drawing.id)) {
				cachedDrawingFeatures.set(drawing.id, extractEnhancedFeatures([...drawing.pixels], weights));
			}
		}
		
		// Find k nearest neighbors based on feature similarity
		const k = Math.min(5, currentDrawings.length);
		const similarities: { id: string; similarity: number }[] = [];
		
		for (const drawing of currentDrawings) {
			const features = cachedDrawingFeatures.get(drawing.id);
			if (features) {
				similarities.push({
					id: drawing.id,
					similarity: cosineSimilarity(previewFeatures, features)
				});
			}
		}
		
		// Sort by similarity (highest first)
		similarities.sort((a, b) => b.similarity - a.similarity);
		
		// Get positions of top k neighbors
		const topK = similarities.slice(0, k);
		if (topK.length === 0) return null;
		
		// Weighted average position (weighted by similarity)
		let totalWeight = 0;
		let avgX = 0, avgY = 0;
		
		for (const { id, similarity } of topK) {
			const pos = positions.get(id);
			if (pos) {
				// Use squared similarity as weight to emphasize closest matches
				const weight = similarity * similarity;
				avgX += pos.x * weight;
				avgY += pos.y * weight;
				totalWeight += weight;
			}
		}
		
		if (totalWeight === 0) return null;
		
		avgX /= totalWeight;
		avgY /= totalWeight;
		
		// Add small random offset to avoid exact overlap
		const offset = DRAWING_SIZE * 0.8;
		avgX += (Math.random() - 0.5) * offset;
		avgY += (Math.random() - 0.5) * offset;
		
		return { x: avgX, y: avgY };
	}

	// Pan to the preview position
	function panToPreview(position: { x: number; y: number }) {
		if (!canvas) return;
		
		// Animate to center on the preview position
		targetOffsetX = canvas.width / 2 - position.x * targetScale;
		targetOffsetY = canvas.height / 2 - position.y * targetScale;
		
		// Zoom in slightly for better visibility
		targetScale = Math.max(targetScale, 1.5);
		
		// Stop any momentum
		velocityX = 0;
		velocityY = 0;
		
		startAnimation();
	}

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

	// Calculate spread factor based on number of drawings for consistent density
	// This ensures the "world" size grows with more drawings to maintain spacing
	function calculateDensityBasedSpread(numDrawings: number, isMobile: boolean): number {
		// Base spacing per drawing (area each drawing "owns")
		const baseSpacing = isMobile ? MIN_SPACING * 1.2 : MIN_SPACING * 1.4;
		
		// For N drawings in 2D, we need roughly sqrt(N) * spacing per dimension
		// Add a density multiplier to control overall spread (higher = more spread out)
		const densityMultiplier = isMobile ? 1.2 : 1.5;
		
		// Calculate spread: sqrt(N) gives us the "side length" of a square grid
		// that could hold N items, multiplied by spacing and density
		const spread = Math.sqrt(Math.max(numDrawings, 1)) * baseSpacing * densityMultiplier;
		
		// Ensure a minimum spread so few drawings aren't bunched too tightly
		const minSpread = isMobile ? 400 : 800;
		
		return Math.max(spread, minSpread);
	}

	// Compute positions based on visualization mode
	function computePositionsForMode(
		currentDrawings: typeof drawings,
		embeddings: [number, number][],
		mode: VisualizationMode
	): Map<string, { x: number; y: number }> {
		const newPositions = new Map<string, { x: number; y: number }>();
		const isMobile = canvas.width < 768;
		const numDrawings = currentDrawings.length;
		
		if (mode === 'cluster') {
			// Clear timeline range when not in timeline mode
			timelineRange = null;
			
			// Standard 2D UMAP clustering
			let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
			for (const [ex, ey] of embeddings) {
				minX = Math.min(minX, ex);
				maxX = Math.max(maxX, ex);
				minY = Math.min(minY, ey);
				maxY = Math.max(maxY, ey);
			}
			
			const rangeX = maxX - minX || 1;
			const rangeY = maxY - minY || 1;
			
			// Use density-based spread that scales with number of drawings
			const spreadFactor = calculateDensityBasedSpread(numDrawings, isMobile);

			currentDrawings.forEach((drawing, i) => {
				if (embeddings[i]) {
					const normalizedX = ((embeddings[i][0] - minX) / rangeX - 0.5) * spreadFactor;
					const normalizedY = ((embeddings[i][1] - minY) / rangeY - 0.5) * spreadFactor;
					newPositions.set(drawing.id, { x: normalizedX, y: normalizedY });
				}
			});
		} else {
			// Timeline mode: X = time, Y = 1D UMAP (first component)
			
			// Parse timestamps and find range (use "now" as the max time)
			const timestamps = currentDrawings.map(d => new Date(d.created).getTime());
			const minTime = Math.min(...timestamps);
			const maxTime = Date.now(); // Use current time as the right edge
			const timeRange = maxTime - minTime || 1;
			
			// Find Y range from first UMAP component
			let minY = Infinity, maxY = -Infinity;
			for (const [, ey] of embeddings) {
				minY = Math.min(minY, ey);
				maxY = Math.max(maxY, ey);
			}
			const yRange = maxY - minY || 1;
			
			// For timeline, X spread is based on time range, Y spread is density-based
			// Use wider horizontal spread for timeline to accommodate time axis
			const baseSpread = calculateDensityBasedSpread(numDrawings, isMobile);
			const spreadFactor = baseSpread * 1.5; // Extra horizontal room for timeline
			
			// Store timeline range for axis rendering
			timelineRange = { minTime, maxTime, spreadFactor };
			
			currentDrawings.forEach((drawing, i) => {
				if (embeddings[i]) {
					const timestamp = new Date(drawing.created).getTime();
					// X = normalized time (oldest left, newest right)
					const normalizedX = ((timestamp - minTime) / timeRange - 0.5) * spreadFactor;
					// Y = first UMAP component (similarity) - use smaller vertical spread
					const normalizedY = ((embeddings[i][1] - minY) / yRange - 0.5) * baseSpread * 0.6;
					newPositions.set(drawing.id, { x: normalizedX, y: normalizedY });
				}
			});
		}

		// Push apart any overlapping drawings
		// Use larger spacing on mobile to prevent dense clustering with aliasing issues
		const mobileSpacing = isMobile ? MIN_SPACING * 1.8 : MIN_SPACING;
		resolveCollisions(newPositions, mobileSpacing);
		
		return newPositions;
	}

	// Switch visualization mode and recompute positions
	function switchVisualizationMode(mode: VisualizationMode) {
		if (mode === visualizationMode) return;
		if (!lastEmbeddings || lastEmbeddings.length === 0) return;
		
		visualizationMode = mode;
		
		// Get current drawings that match stored embeddings
		const currentDrawings = untrack(() => drawings);
		
		// Verify embeddings match current drawings
		if (lastDrawingIds.length !== currentDrawings.length) {
			// Data changed, need to recompute UMAP
			runUMAP(true);
			return;
		}
		
		// Recompute positions with new mode
		const newPositions = computePositionsForMode(currentDrawings, lastEmbeddings, mode);
		
		// Update bounds
		let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
		for (const pos of newPositions.values()) {
			bMinX = Math.min(bMinX, pos.x);
			bMaxX = Math.max(bMaxX, pos.x);
			bMinY = Math.min(bMinY, pos.y);
			bMaxY = Math.max(bMaxY, pos.y);
		}
		bounds = { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
		
		// Animate to new positions
		oldPositions = new Map(positions);
		targetPositions = newPositions;
		startPositionAnimation();
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

	// Animation for transitioning between clustering layouts
	const POSITION_ANIMATION_DURATION = 1200; // ms
	let positionAnimationStart = 0;

	function startPositionAnimation() {
		if (isAnimatingPositions) return;
		isAnimatingPositions = true;
		positionAnimationStart = performance.now();
		positionAnimationProgress = 0;
		requestAnimationFrame(animatePositions);
	}

	function easeInOutCubic(t: number): number {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	function easeOutQuad(t: number): number {
		return 1 - (1 - t) * (1 - t);
	}

	function animatePositions(timestamp: number) {
		const elapsed = timestamp - positionAnimationStart;
		const rawProgress = Math.min(elapsed / POSITION_ANIMATION_DURATION, 1);
		positionAnimationProgress = easeInOutCubic(rawProgress);

		// Interpolate positions
		const interpolated = new Map<string, { x: number; y: number }>();
		
		for (const [id, targetPos] of targetPositions) {
			const oldPos = oldPositions.get(id);
			if (oldPos) {
				// Interpolate from old to new
				interpolated.set(id, {
					x: oldPos.x + (targetPos.x - oldPos.x) * positionAnimationProgress,
					y: oldPos.y + (targetPos.y - oldPos.y) * positionAnimationProgress
				});
			} else {
				// New drawing - fade in from center or target
				interpolated.set(id, {
					x: targetPos.x * positionAnimationProgress,
					y: targetPos.y * positionAnimationProgress
				});
			}
		}

		positions = interpolated;
		scheduleRender();

		if (rawProgress < 1) {
			requestAnimationFrame(animatePositions);
		} else {
			// Animation complete
			isAnimatingPositions = false;
			introAnimationPhase = 'idle';
			positions = targetPositions;
			scheduleRender();
		}
	}

	// Generate random positions spread across the canvas
	function generateRandomPositions(drawingIds: string[]): Map<string, { x: number; y: number }> {
		const randomPositions = new Map<string, { x: number; y: number }>();
		const spreadX = canvas.width * 0.8;
		const spreadY = canvas.height * 0.8;
		
		for (const id of drawingIds) {
			randomPositions.set(id, {
				x: (Math.random() - 0.5) * spreadX,
				y: (Math.random() - 0.5) * spreadY
			});
		}
		
		// Resolve collisions so drawings don't overlap
		resolveCollisions(randomPositions, MIN_SPACING, 4);
		
		return randomPositions;
	}

	// Shuffle array using Fisher-Yates algorithm
	function shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	// Start the intro animation sequence
	function startIntroAnimation(drawingIds: string[], clusteredPositions: Map<string, { x: number; y: number }>) {
		introAnimationPhase = 'fadein';
		
		// Shuffle the order for a more organic staggered appearance
		const shuffledIds = shuffleArray(drawingIds);
		const idToOrder = new Map<string, number>();
		shuffledIds.forEach((id, i) => idToOrder.set(id, i));
		
		// Initialize all opacities to 0
		const opacities = new Map<string, number>();
		for (const id of drawingIds) {
			opacities.set(id, 0);
		}
		drawingOpacities = opacities;
		
		// Generate random starting positions
		const randomPositions = generateRandomPositions(drawingIds);
		positions = randomPositions;
		
		// Store clustered positions as target
		targetPositions = clusteredPositions;
		oldPositions = new Map(randomPositions); // Make a copy
		
		// Start the fade-in animation
		const fadeInStart = performance.now();
		const totalFadeInTime = FADE_IN_DURATION + (drawingIds.length * FADE_IN_STAGGER);
		
		function animateFadeIn(timestamp: number) {
			const elapsed = timestamp - fadeInStart;
			
			// Update opacity for each drawing with stagger (using shuffled order)
			const newOpacities = new Map<string, number>();
			for (const id of drawingIds) {
				const order = idToOrder.get(id) ?? 0;
				const startTime = order * FADE_IN_STAGGER;
				const drawingProgress = Math.max(0, Math.min(1, (elapsed - startTime) / FADE_IN_DURATION));
				newOpacities.set(id, easeOutQuad(drawingProgress));
			}
			drawingOpacities = newOpacities;
			scheduleRender();
			
			if (elapsed < totalFadeInTime) {
				requestAnimationFrame(animateFadeIn);
			} else {
				// Fade-in complete - all opacities to 1
				const fullOpacities = new Map<string, number>();
				for (const id of drawingIds) {
					fullOpacities.set(id, 1);
				}
				drawingOpacities = fullOpacities;
				scheduleRender();
				
				// Wait a beat before clustering
				introAnimationPhase = 'waiting';
				setTimeout(() => {
					// Start the clustering animation
					introAnimationPhase = 'clustering';
					isAnimatingPositions = true;
					positionAnimationStart = performance.now();
					positionAnimationProgress = 0;
					requestAnimationFrame(animatePositions);
					
					// Start animating the view to fit all positions (animated zoom out)
					setTimeout(() => {
						fitAllInView(true); // Animate the zoom
					}, POSITION_ANIMATION_DURATION * 0.2);
					
					// Mark intro complete when clustering animation ends
					setTimeout(() => {
						introComplete = true;
						markGallerySeen();
					}, POSITION_ANIMATION_DURATION + 200);
				}, WAIT_BEFORE_CLUSTER);
			}
		}
		
		// Center view for the intro
		offsetX = canvas.width / 2;
		offsetY = canvas.height / 2;
		targetOffsetX = offsetX;
		targetOffsetY = offsetY;
		scale = 1.2;
		targetScale = scale;
		
		requestAnimationFrame(animateFadeIn);
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
				// Handle async operations in an IIFE
				(async () => {
					const embeddings = data.embeddings!;
					const currentDrawings = untrack(() => drawings);
					const currentMode = untrack(() => visualizationMode);
					
					// Store embeddings for mode switching
					lastEmbeddings = embeddings;
					lastDrawingIds = currentDrawings.map(d => d.id);
					
					// Compute positions based on current visualization mode
					const newPositions = computePositionsForMode(currentDrawings, embeddings, currentMode);

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
					await cacheAllDrawingImages(currentDrawings);
					
					// Check if this is the first load
					if (isFirstLoad && positions.size === 0) {
						isFirstLoad = false;
						// Skip intro animation in preview mode - just show clustered positions
						if (previewMode) {
							positions = newPositions;
							introComplete = true;
							// Set full opacity for all drawings
							const fullOpacities = new Map<string, number>();
							for (const drawing of currentDrawings) {
								fullOpacities.set(drawing.id, 1);
							}
							drawingOpacities = fullOpacities;
							fitAllInView();
							markGallerySeen();
						} else if (shouldShowIntroAnimation()) {
							// Start intro animation: random positions → fade in → cluster
							const drawingIds = currentDrawings.map(d => d.id);
							startIntroAnimation(drawingIds, newPositions);
						} else {
							// Skip intro - show clustered positions immediately
							positions = newPositions;
							introComplete = true;
							// Set full opacity for all drawings
							const fullOpacities = new Map<string, number>();
							for (const drawing of currentDrawings) {
								fullOpacities.set(drawing.id, 1);
							}
							drawingOpacities = fullOpacities;
							fitAllInView();
							markGallerySeen();
						}
					} else if (positions.size > 0) {
						// Store old positions and start animation to new positions
						oldPositions = new Map(positions);
						targetPositions = newPositions;
						startPositionAnimation();
					} else {
						// Fallback - set positions directly and fit view
						positions = newPositions;
						fitAllInView();
						introComplete = true;
						markGallerySeen();
					}
				})();
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

	// Watch previewPixels and compute predicted position when in preview mode
	$effect(() => {
		if (!previewMode) return;
		
		// Read pixels length to track changes
		const pixelsLength = previewPixels.length;
		if (pixelsLength === 0) return;
		
		// Debounce the computation
		if (previewComputeTimeout) {
			clearTimeout(previewComputeTimeout);
		}
		
		previewComputeTimeout = setTimeout(() => {
			// Use untrack to avoid deep reactive dependencies
			const pixels = untrack(() => [...previewPixels]);
			const pos = computePreviewPosition(pixels);
			
			if (pos) {
				previewPosition = pos;
				panToPreview(pos);
			}
		}, 150); // 150ms debounce
		
		return () => {
			if (previewComputeTimeout) {
				clearTimeout(previewComputeTimeout);
			}
		};
	});

	// Re-render when transform or positions change
	$effect(() => {
		// Read reactive values to track them
		const _scale = scale;
		const _offsetX = offsetX;
		const _offsetY = offsetY;
		const _drawings = drawingsWithPositions;
		const _opacities = drawingOpacities;
		const _mode = visualizationMode; // Track mode for timeline axis
		const _previewPos = previewPosition; // Track preview position
		const _previewMode = previewMode;
		
		if (ctx && _drawings) {
			scheduleRender();
		}
	});

	function runUMAP(useCustomParams = false) {
		// Read drawings without creating reactive dependencies
		const currentDrawings = untrack(() => drawings);

		if (!worker || currentDrawings.length === 0) return;

		isComputing = true;
		progress = 0;

		// Map user-friendly weights to technical feature weights
		const weights = untrack(() => ({
			colorHist: weightColor,           // Color → color histogram
			adjacency: weightStyle,           // Style → adjacency patterns  
			symmetry: weightStyle,            // Style → symmetry scores
			structure: weightShape,           // Shape → structural metrics
			components: weightShape,          // Shape → connected regions
			spatial: weightShape              // Shape → spatial density
		}));

		// Extract enhanced feature vectors with weights applied
		const vectors = currentDrawings.map((d) => extractEnhancedFeatures([...d.pixels], weights));

		// Use custom params from control panel or auto-calculate based on dataset size
		const n = vectors.length;
		const nNeighbors = useCustomParams 
			? untrack(() => paramNeighbors)
			: Math.min(15, Math.max(5, Math.floor(n / 5)));
		const nEpochs = useCustomParams 
			? untrack(() => paramEpochs)
			: (n < 50 ? 100 : n < 200 ? 150 : 200);
		const minDist = useCustomParams 
			? untrack(() => paramMinDist)
			: 0.1;

		const message: UMAPWorkerMessage = {
			type: 'run',
			vectors,
			config: {
				nNeighbors: Math.min(nNeighbors, Math.floor((n - 1) / 2)),
				minDist,
				nEpochs
			}
		};

		worker.postMessage(message);
	}

	function handleRecluster() {
		if (isComputing || isAnimatingPositions) return;
		runUMAP(true);
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
		if (bounds.minX === bounds.maxX && bounds.minY === bounds.maxY) return 0.3;
		
		const padding = DRAWING_SIZE * 2; // Extra padding around bounds
		const boundsWidth = bounds.maxX - bounds.minX + padding;
		const boundsHeight = bounds.maxY - bounds.minY + padding;
		
		const scaleX = canvas.width / boundsWidth;
		const scaleY = canvas.height / boundsHeight;
		
		return Math.min(scaleX, scaleY, 1) * 0.9; // 0.9 to leave some margin
	}

	// Determine if we're on a mobile device (small screen)
	function isMobileView(): boolean {
		return canvas && canvas.width < 768;
	}

	// Fit all drawings in the viewport
	// animate = true: smoothly animate to the fit position
	// animate = false: snap immediately (for initial load)
	function fitAllInView(animate = false) {
		if (positions.size === 0) return;
		
		const fitScale = getMinScaleForBounds();
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;
		
		// On mobile, start more zoomed in so drawings are larger and visible
		// Use a higher minimum scale for mobile devices
		const minScale = isMobileView() ? 0.8 : 0.5;
		const finalScale = Math.max(fitScale, minScale);
		
		targetScale = finalScale;
		targetOffsetX = canvas.width / 2 - centerX * finalScale;
		targetOffsetY = canvas.height / 2 - centerY * finalScale;
		
		if (!animate) {
			// Snap immediately for initial load
			scale = finalScale;
			offsetX = targetOffsetX;
			offsetY = targetOffsetY;
		}
		
		startAnimation();
	}

	// Format date for timeline axis labels based on the tick interval
	function formatTimelineDate(timestamp: number, tickInterval: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const isCurrentYear = date.getFullYear() === now.getFullYear();
		
		const DAY_MS = 1000 * 60 * 60 * 24;
		const WEEK_MS = DAY_MS * 7;
		
		// If interval is less than a day, show time
		if (tickInterval < DAY_MS) {
			const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
			const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			return `${dateStr} ${timeStr}`;
		}
		
		// If interval is less than a week, show day of week + date
		if (tickInterval < WEEK_MS) {
			if (isCurrentYear) {
				return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
			}
			return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: '2-digit' });
		}
		
		// Otherwise just show date
		if (isCurrentYear) {
			return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		}
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
	}

	// Render the timeline axis (horizontal line with date labels)
	function renderTimelineAxis() {
		if (!ctx || !timelineRange || visualizationMode !== 'timeline') return;
		
		const { minTime, maxTime, spreadFactor } = timelineRange;
		const timeRange = maxTime - minTime || 1;
		
		// Calculate world coordinates for the axis (y = 0 is center)
		const axisWorldY = 0;
		
		// Convert to screen coordinates
		const axisScreenY = axisWorldY * scale + offsetY;
		
		// Calculate visible world X range
		const worldLeftX = (0 - offsetX) / scale;
		const worldRightX = (canvas.width - offsetX) / scale;
		
		// Draw main axis line
		ctx.save();
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, axisScreenY);
		ctx.lineTo(canvas.width, axisScreenY);
		ctx.stroke();
		
		// Calculate tick interval based on zoom level
		// We want roughly 5-8 labels visible at a time
		const visibleWorldWidth = worldRightX - worldLeftX;
		const visibleTimeSpan = (visibleWorldWidth / spreadFactor) * timeRange;
		
		// Choose appropriate interval (in milliseconds)
		const intervals = [
			1000 * 60 * 60,           // 1 hour
			1000 * 60 * 60 * 6,       // 6 hours
			1000 * 60 * 60 * 12,      // 12 hours
			1000 * 60 * 60 * 24,      // 1 day
			1000 * 60 * 60 * 24 * 7,  // 1 week
			1000 * 60 * 60 * 24 * 30, // ~1 month
			1000 * 60 * 60 * 24 * 90, // ~3 months
			1000 * 60 * 60 * 24 * 365 // ~1 year
		];
		
		let tickInterval = intervals[0];
		for (const interval of intervals) {
			if (visibleTimeSpan / interval <= 10) {
				tickInterval = interval;
				break;
			}
			tickInterval = interval;
		}
		
		// Find first tick (aligned to interval)
		const visibleMinTime = minTime + ((worldLeftX / spreadFactor) + 0.5) * timeRange;
		const visibleMaxTime = minTime + ((worldRightX / spreadFactor) + 0.5) * timeRange;
		const firstTick = Math.ceil(visibleMinTime / tickInterval) * tickInterval;
		
		// Set up text rendering
		ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		ctx.font = '11px system-ui, -apple-system, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		
		// Draw ticks and labels
		for (let t = firstTick; t <= visibleMaxTime && t <= maxTime; t += tickInterval) {
			// Convert time to world X coordinate
			const worldX = ((t - minTime) / timeRange - 0.5) * spreadFactor;
			const screenX = worldX * scale + offsetX;
			
			// Skip if off screen
			if (screenX < -50 || screenX > canvas.width + 50) continue;
			
			// Draw tick mark
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
			ctx.beginPath();
			ctx.moveTo(screenX, axisScreenY - 4);
			ctx.lineTo(screenX, axisScreenY + 4);
			ctx.stroke();
			
			// Draw label with time if interval is small enough
			const label = formatTimelineDate(t, tickInterval);
			ctx.fillText(label, screenX, axisScreenY + 8);
		}
		
		// Draw "Now" label at the right edge if visible
		const nowWorldX = ((maxTime - minTime) / timeRange - 0.5) * spreadFactor;
		const nowScreenX = nowWorldX * scale + offsetX;
		if (nowScreenX >= -50 && nowScreenX <= canvas.width + 50) {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
			ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
			ctx.fillText('Now', nowScreenX, axisScreenY + 8);
			
			// Draw a slightly more prominent tick for "now"
			ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
			ctx.beginPath();
			ctx.moveTo(nowScreenX, axisScreenY - 6);
			ctx.lineTo(nowScreenX, axisScreenY + 6);
			ctx.stroke();
		}
		
		ctx.restore();
	}

	function render() {
		if (!ctx) return;

		// Clear canvas with white background
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Ensure crisp scaling
		ctx.imageSmoothingEnabled = false;

		// Draw timeline axis first (behind drawings)
		renderTimelineAxis();

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

		// Render preview drawing if in preview mode
		if (previewMode && previewPosition && previewPixels.length > 0) {
			renderPreviewDrawing();
		}
	}

	// Generate SVG for preview pixels (similar to generateSVG but inline)
	function generatePreviewSVG(pixels: number[]): string {
		let rects = '';
		
		for (let y = 0; y < GRID_SIZE; y++) {
			let x = 0;
			while (x < GRID_SIZE) {
				const pixelValue = pixels[y * GRID_SIZE + x] ?? COLOR_WHITE;
				let width = 1;
				
				while (x + width < GRID_SIZE && pixels[y * GRID_SIZE + x + width] === pixelValue) {
					width++;
				}
				
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

	// Cache for preview image
	let previewImageCache: { pixels: string; img: HTMLImageElement } | null = null;

	// Render the preview drawing with glow effect
	function renderPreviewDrawing() {
		if (!ctx || !previewPosition) return;
		
		const screenX = previewPosition.x * scale + offsetX;
		const screenY = previewPosition.y * scale + offsetY;
		const size = DRAWING_SIZE * scale;
		// Use consistent integer math to avoid sub-pixel rendering artifacts
		const drawSize = Math.round(size);
		const halfSize = (drawSize / 2) | 0;
		const x = (Math.round(screenX) - halfSize) | 0;
		const y = (Math.round(screenY) - halfSize) | 0;
		
		// Skip if off-screen
		if (x + drawSize < 0 || x > canvas.width || y + drawSize < 0 || y > canvas.height) {
			return;
		}
		
		// Create or update cached preview image
		const pixelsKey = previewPixels.join(',');
		if (!previewImageCache || previewImageCache.pixels !== pixelsKey) {
			const svg = generatePreviewSVG(previewPixels);
			const dataUrl = 'data:image/svg+xml;base64,' + btoa(svg);
			const img = new Image();
			img.src = dataUrl;
			previewImageCache = { pixels: pixelsKey, img };
			// Re-render when image loads
			img.onload = () => scheduleRender();
		}
		
		const img = previewImageCache.img;
		if (!img.complete) return;
		
		ctx.save();
		
		// Draw glow effect
		ctx.shadowColor = 'rgba(59, 130, 246, 0.6)';
		ctx.shadowBlur = 20 * scale;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
		
		// Draw a rounded rect background for the glow
		ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
		ctx.beginPath();
		ctx.roundRect(x - 4, y - 4, drawSize + 8, drawSize + 8, 4);
		ctx.fill();
		
		// Reset shadow for the actual drawing
		ctx.shadowColor = 'transparent';
		ctx.shadowBlur = 0;
		
		// Draw border
		ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.roundRect(x - 4, y - 4, drawSize + 8, drawSize + 8, 4);
		ctx.stroke();
		
		// Draw the preview image with slight transparency
		ctx.globalAlpha = 0.85;
		ctx.drawImage(img, x, y, drawSize, drawSize);
		
		// Draw "Preview" label
		ctx.globalAlpha = 1;
		ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
		ctx.font = `bold ${Math.max(10, 12 * scale)}px system-ui, -apple-system, sans-serif`;
		ctx.textAlign = 'center';
		ctx.fillText('Preview', screenX, y + drawSize + 16 * scale);
		
		ctx.restore();
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

		// Use consistent integer math to avoid sub-pixel rendering artifacts
		const drawSize = Math.round(size);
		const halfSize = (drawSize / 2) | 0; // Integer division
		const x = (Math.round(screenX) - halfSize) | 0;
		const y = (Math.round(screenY) - halfSize) | 0;
		
		// Get opacity for this drawing (default to 1 if not in intro animation)
		const opacity = drawingOpacities.get(drawing.id) ?? 1;
		
		// Skip if fully transparent
		if (opacity <= 0) return;
		
		// Apply opacity if not fully opaque
		const needsOpacity = opacity < 1;
		if (needsOpacity) {
			ctx.save();
			ctx.globalAlpha = opacity;
		}
		
		// Use cached SVG image if available
		const cached = drawingImageCache.get(drawing.id);
		if (cached) {
			ctx.drawImage(cached, x, y, drawSize, drawSize);
		} else {
			// Fallback: draw a placeholder while loading
			ctx.fillStyle = '#f0f0f0';
			ctx.fillRect(x, y, drawSize, drawSize);
			
			// Cache and re-render when ready
			getDrawingImage(drawing).then(() => {
				scheduleRender();
			});
		}
		
		if (needsOpacity) {
			ctx.restore();
		}
	}

	function handleWheel(event: WheelEvent) {
		// Disable interaction in preview mode
		if (previewMode) return;
		
		event.preventDefault();

		const rect = canvas.getBoundingClientRect();
		const mouseCanvasX = event.clientX - rect.left;
		const mouseCanvasY = event.clientY - rect.top;

		// Zoom toward cursor - set target values for smooth animation
		const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05;
		const minScale = Math.max(Math.min(getMinScaleForBounds(), 1), 0.3);
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
		// Disable interaction in preview mode
		if (previewMode) return;
		
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
		// Disable interaction in preview mode
		if (previewMode) return;
		
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
			const minScale = Math.max(Math.min(getMinScaleForBounds(), 0.5), 0.3);
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
	{#if isComputing && !previewMode}
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
		class:preview-mode={previewMode}
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

	{#if !previewMode}
		<DrawingPopup drawing={hoveredDrawing} x={mouseX} y={mouseY} visible={showPopup && introComplete} />

		{#if introComplete}
			<div class="controls" class:visible={introComplete}>
				<button onclick={() => showControlPanel = !showControlPanel} class:active={showControlPanel}>
					⚙️ Tune
				</button>
			</div>
		{/if}
	{/if}

	{#if showControlPanel && introComplete && !previewMode}
		<div class="control-panel">
			<div class="panel-header">
				<h3>Visualization Settings</h3>
				<button class="close-btn" onclick={() => showControlPanel = false}>×</button>
			</div>
			
			<div class="panel-section">
				<h4>View Mode</h4>
				<p class="section-hint">How should drawings be arranged?</p>
				<div class="mode-toggle">
					<button 
						class="mode-btn" 
						class:active={visualizationMode === 'cluster'}
						onclick={() => switchVisualizationMode('cluster')}
						disabled={isComputing || isAnimatingPositions}
					>
						🔮 Cluster
					</button>
					<button 
						class="mode-btn" 
						class:active={visualizationMode === 'timeline'}
						onclick={() => switchVisualizationMode('timeline')}
						disabled={isComputing || isAnimatingPositions}
					>
						📅 Timeline
					</button>
				</div>
				<p class="slider-hint">
					{#if visualizationMode === 'cluster'}
						Similar drawings grouped together
					{:else}
						X = time created, Y = similarity
					{/if}
				</p>
			</div>
			
			<div class="panel-section">
				<h4>Group by</h4>
				<p class="section-hint">What matters most when grouping?</p>
				
				<label class="slider-row">
					<span class="label-text">🎨 Color</span>
					<input type="range" min="0" max="2" step="0.1" bind:value={weightColor} />
					<span class="value">{weightColor.toFixed(1)}</span>
				</label>
				<p class="slider-hint">Similar colors used</p>
				
				<label class="slider-row">
					<span class="label-text">🔷 Shape</span>
					<input type="range" min="0" max="2" step="0.1" bind:value={weightShape} />
					<span class="value">{weightShape.toFixed(1)}</span>
				</label>
				<p class="slider-hint">Similar forms & silhouettes</p>
				
				<label class="slider-row">
					<span class="label-text">✨ Style</span>
					<input type="range" min="0" max="2" step="0.1" bind:value={weightStyle} />
					<span class="value">{weightStyle.toFixed(1)}</span>
				</label>
				<p class="slider-hint">Similar patterns & techniques</p>
			</div>
			
			<details class="advanced-section">
				<summary>Advanced</summary>
				<div class="panel-section">
					<label class="slider-row">
						<span class="label-text">Neighbors</span>
						<input type="range" min="2" max="50" step="1" bind:value={paramNeighbors} />
						<span class="value">{paramNeighbors}</span>
					</label>
					
					<label class="slider-row">
						<span class="label-text">Spread</span>
						<input type="range" min="0.01" max="1" step="0.01" bind:value={paramMinDist} />
						<span class="value">{paramMinDist.toFixed(2)}</span>
					</label>
					
					<label class="slider-row">
						<span class="label-text">Quality</span>
						<input type="range" min="50" max="500" step="10" bind:value={paramEpochs} />
						<span class="value">{paramEpochs}</span>
					</label>
				</div>
			</details>
			
			<button 
				class="recluster-btn" 
				onclick={handleRecluster}
				disabled={isComputing || isAnimatingPositions || drawings.length === 0}
			>
				{#if isComputing}
					Computing...
				{:else if isAnimatingPositions}
					Animating...
				{:else}
					Re-cluster
				{/if}
			</button>
		</div>
	{/if}

	{#if drawings.length === 0 && !previewMode}
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

	canvas.preview-mode {
		cursor: default;
		pointer-events: none;
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
		gap: 12px;
		animation: fadeInUp 0.4s ease-out;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.controls button {
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #e0e0e0;
		color: #000;
		padding: 10px 16px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.85rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		transition: all 0.15s ease;
		min-height: 44px; /* Touch target size */
	}

	.controls button:hover {
		background: #f0f0f0;
		border-color: #999;
	}

	.controls button.active {
		background: #000;
		color: #fff;
		border-color: #000;
	}

	/* Mobile optimizations for controls */
	@media (max-width: 768px) {
		.controls {
			bottom: 1.25rem;
			right: 1rem;
			gap: 10px;
		}

		.controls button {
			padding: 12px 16px;
			font-size: 0.9rem;
			min-height: 48px;
			border-radius: 10px;
		}
	}

	/* Control Panel */
	.control-panel {
		position: absolute;
		top: 60px;
		right: 16px;
		width: 280px;
		background: rgba(255, 255, 255, 0.98);
		border: 1px solid #e0e0e0;
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
		z-index: 50;
		max-height: calc(100vh - 140px);
		max-height: calc(100dvh - 140px);
		overflow-y: auto;
	}

	/* Smaller laptop screens */
	@media (max-height: 800px) {
		.control-panel {
			top: 50px;
			width: 240px;
			max-height: calc(100vh - 120px);
			max-height: calc(100dvh - 120px);
		}

		.panel-header {
			padding: 10px 12px;
		}

		.panel-section {
			padding: 10px 12px;
		}

		.section-hint {
			margin-bottom: 8px;
		}

		.slider-hint {
			margin: -4px 0 8px 0;
			font-size: 0.65rem;
		}

		.label-text {
			flex: 0 0 65px;
			font-size: 0.75rem;
		}

		.recluster-btn {
			margin: 10px 12px 12px;
			padding: 8px 12px;
		}
	}

	/* Very small laptop screens */
	@media (max-height: 700px) {
		.control-panel {
			top: auto;
			bottom: 70px;
			right: 12px;
			width: 220px;
			max-height: calc(100vh - 140px);
			max-height: calc(100dvh - 140px);
		}

		.panel-header {
			padding: 8px 10px;
		}

		.panel-header h3 {
			font-size: 0.8rem;
		}

		.panel-section {
			padding: 8px 10px;
		}

		.panel-section h4 {
			margin-bottom: 2px;
			font-size: 0.7rem;
		}

		.section-hint {
			margin-bottom: 6px;
			font-size: 0.65rem;
		}

		.slider-row {
			margin-bottom: 4px;
			gap: 6px;
		}

		.label-text {
			flex: 0 0 55px;
			font-size: 0.7rem;
		}

		.slider-hint {
			margin: -2px 0 6px 0;
			font-size: 0.6rem;
		}

		.slider-row .value {
			flex: 0 0 28px;
			font-size: 0.7rem;
		}

		.recluster-btn {
			margin: 8px 10px 10px;
			padding: 6px 10px;
			font-size: 0.8rem;
		}

		.advanced-section summary {
			padding: 8px 10px;
			font-size: 0.7rem;
		}
	}

	/* Mobile control panel */
	@media (max-width: 768px) {
		.control-panel {
			top: auto;
			bottom: 80px;
			right: 12px;
			left: 12px;
			width: auto;
			max-height: 60vh;
			max-height: 60dvh;
			border-radius: 16px;
		}
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px;
		border-bottom: 1px solid #eee;
		background: #fafafa;
	}

	.panel-header h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: #000;
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 1.4rem;
		color: #666;
		cursor: pointer;
		padding: 0;
		line-height: 1;
		transition: color 0.15s;
	}

	.close-btn:hover {
		color: #000;
	}

	.panel-section {
		padding: 12px 16px;
		border-bottom: 1px solid #eee;
	}

	.panel-section:last-of-type {
		border-bottom: none;
	}

	.panel-section h4 {
		margin: 0 0 4px 0;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #666;
	}

	.section-hint {
		margin: 0 0 12px 0;
		font-size: 0.75rem;
		color: #999;
	}

	.mode-toggle {
		display: flex;
		gap: 8px;
		margin-bottom: 8px;
	}

	.mode-btn {
		flex: 1;
		padding: 8px 12px;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		background: #fff;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s ease;
		color: #666;
	}

	.mode-btn:hover:not(:disabled) {
		border-color: #999;
		color: #333;
	}

	.mode-btn.active {
		background: #000;
		border-color: #000;
		color: #fff;
	}

	.mode-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.slider-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		cursor: pointer;
	}

	.slider-row:last-child {
		margin-bottom: 0;
	}

	.label-text {
		flex: 0 0 70px;
		font-size: 0.8rem;
		color: #333;
	}

	.slider-row input[type="range"] {
		flex: 1;
		min-width: 0;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: #e0e0e0;
		border-radius: 2px;
		outline: none;
	}

	.slider-row input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		background: #000;
		border-radius: 50%;
		cursor: pointer;
		transition: transform 0.1s;
	}

	.slider-row input[type="range"]::-webkit-slider-thumb:hover {
		transform: scale(1.2);
	}

	.slider-row input[type="range"]::-moz-range-thumb {
		width: 14px;
		height: 14px;
		background: #000;
		border-radius: 50%;
		cursor: pointer;
		border: none;
	}

	.slider-row .value {
		flex: 0 0 32px;
		font-size: 0.75rem;
		color: #666;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.slider-hint {
		margin: -4px 0 12px 0;
		font-size: 0.7rem;
		color: #999;
		padding-left: 2px;
	}

	.slider-hint:last-of-type {
		margin-bottom: 0;
	}

	/* Advanced section */
	.advanced-section {
		border-top: 1px solid #eee;
	}

	.advanced-section summary {
		padding: 10px 16px;
		font-size: 0.75rem;
		font-weight: 500;
		color: #666;
		cursor: pointer;
		user-select: none;
		transition: color 0.15s;
	}

	.advanced-section summary:hover {
		color: #000;
	}

	.advanced-section[open] summary {
		border-bottom: 1px solid #eee;
	}

	.advanced-section .panel-section {
		border-bottom: none;
	}

	.recluster-btn {
		display: block;
		width: calc(100% - 32px);
		margin: 12px 16px 16px;
		padding: 10px 16px;
		background: #000;
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.recluster-btn:hover:not(:disabled) {
		background: #333;
		transform: translateY(-1px);
	}

	.recluster-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
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


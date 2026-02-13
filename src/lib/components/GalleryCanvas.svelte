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
		onDrawingClick?: (drawingId: string) => void;
	// Preview mode props - for showing where a new drawing would land
	// previewMode = true: full preview mode (no interaction, uses shared positions)
	// previewMode = false but previewPixels provided: show preview while keeping interaction
	previewMode?: boolean;
	previewPixels?: number[];
	// When true, render preview at full opacity (used after saving to show the drawing persisted)
	previewSaved?: boolean;
		// Callback to get current preview position (for placing saved drawings)
		onPreviewPositionChange?: (position: { x: number; y: number } | null) => void;
		// Position to use for a newly saved drawing (bypasses UMAP recalculation)
		pendingNewDrawingPosition?: { x: number; y: number } | null;
		// Shared view position (bindable)
		viewScale?: number;
		viewOffsetX?: number;
		viewOffsetY?: number;
		onViewChange?: (scale: number, offsetX: number, offsetY: number) => void;
		// Shared positions (to avoid recomputing in preview mode)
		sharedPositions?: Map<string, { x: number; y: number }>;
		onPositionsComputed?: (positions: Map<string, { x: number; y: number }>) => void;
		// Control panel state (bindable from parent)
		showControlPanel?: boolean;
		// Highlighted drawing (for recent mode - others will be faded)
		highlightedDrawingId?: string | null;
		// Clustering controls (bindable for parent to control)
		clusterWeightColor?: boolean;
		clusterWeightShape?: boolean;
		clusterWeightStyle?: boolean;
		clusterNeighbors?: number;
		clusterSpread?: number;
		clusterQuality?: number;
		clusterMode?: 'cluster' | 'timeline';
		onModeSwitch?: (mode: 'cluster' | 'timeline') => void;
		onClusterStateChange?: (isComputing: boolean, isAnimating: boolean) => void;
		// Callback to expose recluster function to parent
		onReclusterReady?: (reclusterFn: () => void) => void;
		// Callback when intro animation completes
		onIntroComplete?: () => void;
	}

	let { 
		drawings, 
		onCenterOnDrawing,
		onDrawingClick,
		previewMode = false, 
		previewPixels = [],
		previewSaved = false,
		onPreviewPositionChange,
		pendingNewDrawingPosition = null,
		viewScale,
		viewOffsetX,
		viewOffsetY,
		onViewChange,
		sharedPositions,
		onPositionsComputed,
		showControlPanel = $bindable(false),
		highlightedDrawingId = null,
		clusterWeightColor = $bindable(true),
		clusterWeightShape = $bindable(true),
		clusterWeightStyle = $bindable(true),
		clusterNeighbors = $bindable(15),
		clusterSpread = $bindable(0.1),
		clusterQuality = $bindable(150),
		clusterMode = $bindable<'cluster' | 'timeline'>('cluster'),
		onModeSwitch,
		onClusterStateChange,
		onReclusterReady,
		onIntroComplete
	}: Props = $props();
	
	// Derived: show preview when pixels are provided OR when a saved preview is still showing
	let showPreview = $derived(
		(previewPixels.length > 0 && previewPixels.some(p => p !== COLOR_WHITE)) || previewSaved
	);

	// Expose centerOnDrawing method to parent
	$effect(() => {
		if (onCenterOnDrawing) {
			onCenterOnDrawing(centerOnDrawing);
		}
	});
	
	// Expose recluster method to parent
	$effect(() => {
		if (onReclusterReady) {
			onReclusterReady(handleRecluster);
		}
	});
	
	// Notify parent when intro animation completes
	$effect(() => {
		if (introComplete && onIntroComplete) {
			onIntroComplete();
		}
	});

	// Center the view on a specific drawing by ID
	function centerOnDrawing(drawingId: string) {
		const pos = positions.get(drawingId);
		if (!pos) return;

		// Zoom in a bit for better view - must update scale BEFORE calculating offsets
		targetScale = Math.max(targetScale, 2);
		
		// Animate to center on the drawing (using the updated targetScale)
		targetOffsetX = canvasWidth / 2 - pos.x * targetScale;
		targetOffsetY = canvasHeight / 2 - pos.y * targetScale;
		
		// Stop any momentum
		velocityX = 0;
		velocityY = 0;
		
		startAnimation();
	}

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let container: HTMLDivElement;

	// High-DPI support: track device pixel ratio and CSS dimensions separately
	let dpr = 1;
	let canvasWidth = $state(0);
	let canvasHeight = $state(0);

	// Transform state - use props if provided, otherwise defaults
	let scale = $state(viewScale ?? 2.5);
	let offsetX = $state(viewOffsetX ?? 0);
	let offsetY = $state(viewOffsetY ?? 0);
	
	// Sync external view changes to internal state
	$effect(() => {
		if (viewScale !== undefined && Math.abs(viewScale - scale) > 0.001) {
			scale = viewScale;
			targetScale = viewScale;
		}
	});
	
	$effect(() => {
		if (viewOffsetX !== undefined && Math.abs(viewOffsetX - offsetX) > 0.001) {
			offsetX = viewOffsetX;
			targetOffsetX = viewOffsetX;
		}
	});
	
	$effect(() => {
		if (viewOffsetY !== undefined && Math.abs(viewOffsetY - offsetY) > 0.001) {
			offsetY = viewOffsetY;
			targetOffsetY = viewOffsetY;
		}
	});

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
	let targetScale = viewScale ?? 2.5;
	let targetOffsetX = viewOffsetX ?? 0;
	let targetOffsetY = viewOffsetY ?? 0;
	let animating = false;
	const FRICTION = 0.92;
	const ZOOM_SMOOTHING = 0.28;
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
	
	// Snapshot of drawings sent to the UMAP worker, so the done handler can
	// correctly map embeddings back even if drawings change mid-computation.
	let umapDrawingSnapshot: Drawing[] = [];

	// Intro animation state
	let isFirstLoad = true;
	let introComplete = $state(false);
	let drawingOpacities: Map<string, number> = $state(new Map());
	let introAnimationPhase: 'idle' | 'fadein' = $state('idle');
	const TOTAL_FADE_IN_TIME = 1800; // Fixed total duration for all fade-ins (ms)
	const INDIVIDUAL_FADE_DURATION = 600; // Each drawing's own fade-in time (ms)
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
	let previewTargetPosition: { x: number; y: number } | null = null;
	let previewTweenStart: { x: number; y: number } | null = null;
	let previewTweenStartTime = 0;
	let isPreviewTweening = false;
	const PREVIEW_TWEEN_DURATION = 400; // ms for smooth position transition
	let lastPreviewFeatures: number[] | null = null;
	let previewComputeTimeout: ReturnType<typeof setTimeout> | null = null;
	let cachedDrawingFeatures: Map<string, number[]> = new Map();

	// Control panel is now a bindable prop from parent
	
	// Visualization mode synced from props
	let visualizationMode = $derived(clusterMode);
	
	// Store last UMAP embeddings to reuse when switching modes
	let lastEmbeddings: [number, number][] | null = null;
	let lastDrawingIds: string[] = [];
	
	// Timeline axis data (for rendering the time axis)
	let timelineRange: { minTime: number; maxTime: number; spreadFactor: number } | null = null;
	
	// Feature weights derived from props (1.0 if on, 0.0 if off)
	let weightColor = $derived(clusterWeightColor ? 1.0 : 0.0);
	let weightShape = $derived(clusterWeightShape ? 1.0 : 0.0);
	let weightStyle = $derived(clusterWeightStyle ? 1.0 : 0.0);
	
	// UMAP parameters derived from props
	let paramNeighbors = $derived(clusterNeighbors);
	let paramMinDist = $derived(clusterSpread);
	let paramEpochs = $derived(clusterQuality);

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
		
		// Add deterministic offset based on pixel content to avoid exact overlap
		// Uses a simple hash of pixels so the same drawing always gets the same offset
		let hash = 0;
		for (let i = 0; i < pixels.length; i += 7) {
			hash = ((hash << 5) - hash + (pixels[i] ?? 0)) | 0;
		}
		const offset = DRAWING_SIZE * 0.8;
		const hashNormX = ((hash & 0xFFFF) / 0xFFFF) - 0.5;       // -0.5 to 0.5
		const hashNormY = (((hash >> 16) & 0xFFFF) / 0xFFFF) - 0.5;
		avgX += hashNormX * offset;
		avgY += hashNormY * offset;
		
		return { x: avgX, y: avgY };
	}

	// Compute the viewport target offsets that place a world position in the top center of the screen
	function viewportTargetForPreview(worldPos: { x: number; y: number }): { ox: number; oy: number } {
		if (!canvas) return { ox: targetOffsetX, oy: targetOffsetY };
		
		// On mobile (narrow screens), shift up more to leave room for create panel
		const isMobile = canvasWidth < 768;
		// Place the preview at roughly the top third of the visible area
		const verticalBias = isMobile ? canvasHeight * 0.25 : canvasHeight * 0.15;
		
		return {
			ox: canvasWidth / 2 - worldPos.x * targetScale,
			oy: (canvasHeight / 2 - verticalBias) - worldPos.y * targetScale
		};
	}
	
	// Smoothly tween preview position from current to target,
	// and continuously update the viewport so the preview stays in the top center
	function startPreviewTween(target: { x: number; y: number }) {
		previewTargetPosition = target;
		
		if (previewPosition) {
			// Already visible - tween from current position
			previewTweenStart = { ...previewPosition };
		} else {
			// First appearance - snap directly (no flashing)
			previewPosition = { ...target };
			previewTweenStart = { ...target };
			
			// On first appearance, also ensure we're zoomed in enough
			if (targetScale < 1.2) {
				targetScale = 1.5;
			}
		}
		
		// Stop any momentum so we smoothly track
		velocityX = 0;
		velocityY = 0;
		
		previewTweenStartTime = performance.now();
		
		if (!isPreviewTweening) {
			isPreviewTweening = true;
			requestAnimationFrame(animatePreviewTween);
		}
	}
	
	function animatePreviewTween(timestamp: number) {
		if (!previewTweenStart || !previewTargetPosition) {
			isPreviewTweening = false;
			return;
		}
		
		const elapsed = timestamp - previewTweenStartTime;
		const rawProgress = Math.min(elapsed / PREVIEW_TWEEN_DURATION, 1);
		const t = easeInOutCubic(rawProgress);
		
		// Interpolate preview world position
		previewPosition = {
			x: previewTweenStart.x + (previewTargetPosition.x - previewTweenStart.x) * t,
			y: previewTweenStart.y + (previewTargetPosition.y - previewTweenStart.y) * t
		};
		
		// Continuously update viewport target to follow the preview
		const { ox, oy } = viewportTargetForPreview(previewPosition);
		targetOffsetX = ox;
		targetOffsetY = oy;
		startAnimation(); // Ensure the viewport animate loop is running
		
		scheduleRender();
		
		if (rawProgress < 1) {
			requestAnimationFrame(animatePreviewTween);
		} else {
			// Snap to final target
			previewPosition = { ...previewTargetPosition };
			const final = viewportTargetForPreview(previewPosition);
			targetOffsetX = final.ox;
			targetOffsetY = final.oy;
			isPreviewTweening = false;
			startAnimation();
			scheduleRender();
		}
	}
	
	// Reset tween state when preview fully ends (not saved, no content)
	$effect(() => {
		if (!showPreview && !previewSaved) {
			previewPosition = null;
			previewTargetPosition = null;
			previewTweenStart = null;
			isPreviewTweening = false;
		}
	});
	
	// Notify parent when preview position changes
	$effect(() => {
		// Explicitly read previewPosition to track it as a dependency
		const pos = previewPosition;
		if (onPreviewPositionChange) {
			onPreviewPositionChange(pos);
		}
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

	// Calculate spread factor based on number of drawings for consistent density.
	// World coordinates are device-independent: the viewport is just a window into
	// a fixed coordinate space. This ensures clustering precision and relative
	// positions are identical regardless of screen size.
	function calculateDensityBasedSpread(numDrawings: number): number {
		// Base spacing per drawing (area each drawing "owns")
		const baseSpacing = MIN_SPACING * 1.4;
		
		// For N drawings in 2D, we need roughly sqrt(N) * spacing per dimension
		// Add a density multiplier to control overall spread (higher = more spread out)
		const densityMultiplier = 1.5;
		
		// Calculate spread: sqrt(N) gives us the "side length" of a square grid
		// that could hold N items, multiplied by spacing and density
		const spread = Math.sqrt(Math.max(numDrawings, 1)) * baseSpacing * densityMultiplier;
		
		// Ensure a minimum spread so few drawings aren't bunched too tightly
		const minSpread = 800;
		
		return Math.max(spread, minSpread);
	}

	// Compute positions based on visualization mode.
	// All positions are in device-independent world coordinates.
	// The viewport (zoom/pan) adapts to the screen; the world does not.
	function computePositionsForMode(
		currentDrawings: typeof drawings,
		embeddings: [number, number][],
		mode: 'cluster' | 'timeline'
	): Map<string, { x: number; y: number }> {
		const newPositions = new Map<string, { x: number; y: number }>();
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
			const spreadFactor = calculateDensityBasedSpread(numDrawings);

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
			const baseSpread = calculateDensityBasedSpread(numDrawings);
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

		// Push apart any overlapping drawings with consistent spacing
		resolveCollisions(newPositions, MIN_SPACING);
		
		return newPositions;
	}

	// Watch for mode changes from props
	let lastMode: 'cluster' | 'timeline' = clusterMode;
	$effect(() => {
		const newMode = clusterMode;
		if (newMode !== lastMode && lastEmbeddings && lastEmbeddings.length > 0) {
			lastMode = newMode;
			
			// Get current drawings that match stored embeddings
			const currentDrawings = untrack(() => drawings);
			
			// Verify embeddings match current drawings
			if (lastDrawingIds.length !== currentDrawings.length) {
				// Data changed, need to recompute UMAP
				runUMAP(true);
				return;
			}
			
			// Recompute positions with new mode
			const newPositions = computePositionsForMode(currentDrawings, lastEmbeddings, newMode);
			
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
			
			// Zoom out and center to show all images after mode switch
			setTimeout(() => {
				fitAllInView(true, true); // animate=true, maxZoomOut=true
			}, POSITION_ANIMATION_DURATION * 0.2);
		}
		lastMode = newMode;
	});
	
	// Legacy function for compatibility
	function switchVisualizationMode(mode: 'cluster' | 'timeline') {
		if (mode === visualizationMode) return;
		clusterMode = mode;
		onModeSwitch?.(mode);
	}
	
	// Notify parent of computing/animating state changes
	$effect(() => {
		const computing = isComputing;
		const animating = isAnimatingPositions;
		onClusterStateChange?.(computing, animating);
	});

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

		if (Math.abs(scaleDiff) > 0.0001 || Math.abs(offsetXDiff) > 0.05 || Math.abs(offsetYDiff) > 0.05) {
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

		// Notify parent of view changes
		if (onViewChange) {
			onViewChange(scale, offsetX, offsetY);
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
	// Places drawings at their final clustered positions, fits them in view,
	// then fades them in with a staggered animation. Pan/zoom is disabled until complete.
	function startIntroAnimation(drawingIds: string[], clusteredPositions: Map<string, { x: number; y: number }>) {
		introAnimationPhase = 'fadein';
		
		// Place drawings at their final clustered positions immediately
		positions = clusteredPositions;
		
		// Fit all drawings in view (snap, no animation)
		fitAllInView(false, true);
		
		// Initialize all opacities to 0
		const opacities = new Map<string, number>();
		for (const id of drawingIds) {
			opacities.set(id, 0);
		}
		drawingOpacities = opacities;
		
		// Shuffle the order for a more organic staggered appearance
		const shuffledIds = shuffleArray(drawingIds);
		const idToOrder = new Map<string, number>();
		shuffledIds.forEach((id, i) => idToOrder.set(id, i));
		
		// Start the fade-in animation
		const fadeInStart = performance.now();
		const stagger = drawingIds.length > 1
			? (TOTAL_FADE_IN_TIME - INDIVIDUAL_FADE_DURATION) / (drawingIds.length - 1)
			: 0;
		
		function animateFadeIn(timestamp: number) {
			const elapsed = timestamp - fadeInStart;
			
			// Update opacity for each drawing with stagger (using shuffled order)
			const newOpacities = new Map<string, number>();
			for (const id of drawingIds) {
				const order = idToOrder.get(id) ?? 0;
				const startTime = order * stagger;
				const drawingProgress = Math.max(0, Math.min(1, (elapsed - startTime) / INDIVIDUAL_FADE_DURATION));
				newOpacities.set(id, easeOutQuad(drawingProgress));
			}
			drawingOpacities = newOpacities;
			scheduleRender();
			
			if (elapsed < TOTAL_FADE_IN_TIME) {
				requestAnimationFrame(animateFadeIn);
			} else {
				// Fade-in complete - all opacities to 1
				const fullOpacities = new Map<string, number>();
				for (const id of drawingIds) {
					fullOpacities.set(id, 1);
				}
				drawingOpacities = fullOpacities;
				introAnimationPhase = 'idle';
				introComplete = true;
				markGallerySeen();
				scheduleRender();
			}
		}
		
		requestAnimationFrame(animateFadeIn);
	}

	onMount(() => {
		ctx = canvas.getContext('2d');
		if (ctx) {
			// Disable image smoothing for crisp pixel art
			ctx.imageSmoothingEnabled = false;
		}
		resizeCanvas();

		// Skip worker initialization in preview mode - we use shared positions instead
		if (previewMode) {
			return;
		}

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
				perfLog('UMAP done handler start', { embeddings: data.embeddings.length });
				const embeddings = data.embeddings!;
				// Use the snapshot of drawings that were actually sent to UMAP,
				// NOT the current drawings (which may have changed during computation).
				// This prevents index mismatches between embeddings[i] and drawings[i]
				// when new drawings arrive mid-computation.
				const umapDrawings = umapDrawingSnapshot;
				const currentMode = untrack(() => visualizationMode);
				
				// Store embeddings for mode switching
				lastEmbeddings = embeddings;
				lastDrawingIds = umapDrawings.map(d => d.id);
				
				// Update tracked IDs based on UMAP snapshot, NOT current drawings.
				// This ensures any drawings that arrived during UMAP computation
				// will be detected as new and projected via k-NN when the effect re-runs.
				trackedDrawingIds = new Set(umapDrawings.map(d => d.id));
				lastDrawingsLength = umapDrawings.length;
				
				// Compute positions using UMAP drawings (matching embeddings indices)
				const newPositions = computePositionsForMode(umapDrawings, embeddings, currentMode);

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
				
				// Notify parent of computed positions (for sharing with preview mode)
				if (onPositionsComputed) {
					onPositionsComputed(newPositions);
				}
				
				// Pre-cache drawing images (fire-and-forget to avoid race conditions
				// where the reactive effect fires during the await and starts a
				// duplicate UMAP run or misses new drawings)
				cacheAllDrawingImages(umapDrawings).then(() => scheduleRender());
				
				// Check if this is the first load
				if (isFirstLoad && positions.size === 0) {
					isFirstLoad = false;
					// Skip intro animation in preview mode - just show clustered positions
					if (previewMode) {
						positions = newPositions;
						introComplete = true;
						// Set full opacity for all drawings
						const fullOpacities = new Map<string, number>();
						for (const drawing of umapDrawings) {
							fullOpacities.set(drawing.id, 1);
						}
						drawingOpacities = fullOpacities;
						fitAllInView(false, true);
						markGallerySeen();
					} else if (shouldShowIntroAnimation()) {
						// Start intro animation: fade in drawings at final positions
						const drawingIds = umapDrawings.map(d => d.id);
						startIntroAnimation(drawingIds, newPositions);
					} else {
						// Skip intro - show clustered positions immediately
						positions = newPositions;
						introComplete = true;
						// Set full opacity for all drawings
						const fullOpacities = new Map<string, number>();
						for (const drawing of umapDrawings) {
							fullOpacities.set(drawing.id, 1);
						}
						drawingOpacities = fullOpacities;
						fitAllInView(false, true);
						markGallerySeen();
					}
				} else if (positions.size > 0) {
					// Store old positions and start animation to new positions (reclustering)
					oldPositions = new Map(positions);
					targetPositions = newPositions;
					startPositionAnimation();
					
					// Zoom out and center to show all images after reclustering
					// Use a slight delay so the animation starts smoothly
					setTimeout(() => {
						fitAllInView(true, true); // animate=true, maxZoomOut=true
					}, POSITION_ANIMATION_DURATION * 0.2);
				} else {
					// Fallback - set positions directly and fit view
					positions = newPositions;
					fitAllInView(false, true);
					introComplete = true;
					markGallerySeen();
				}
			}
		};

		return () => {
			worker?.terminate();
		};
	});

	// Track drawings length to trigger UMAP, but use untrack for the actual computation
	// to avoid creating deep reactive dependencies on every pixel value
	let lastDrawingsLength = 0;
	let trackedDrawingIds = new Set<string>();

	// Max realtime drawings to add via k-NN projection without full UMAP recalculation
	const MAX_REALTIME_ADDITIONS_WITHOUT_UMAP = 5;
	
	// Performance logging: enable via ?perf=1 in URL, or window.__pixelspace_perf = true in console
	const DEBUG_PERF = typeof window !== 'undefined' && (
		new URLSearchParams(globalThis.location?.search ?? '').get('perf') === '1' ||
		(window as unknown as { __pixelspace_perf?: boolean }).__pixelspace_perf
	);
	function perfLog(msg: string, extra?: Record<string, unknown>) {
		if (DEBUG_PERF) {
			console.log(`[GalleryPerf] ${msg}`, { ...extra, t: performance.now().toFixed(1) });
		}
	}
	
	$effect(() => {
		const effectStart = DEBUG_PERF ? performance.now() : 0;
		const currentLength = drawings.length;
		const currentIds = new Set(drawings.map(d => d.id));
		// Read pendingNewDrawingPosition to track it as a dependency
		const pendingPosition = pendingNewDrawingPosition;
		
		// In preview mode with shared positions, use those instead of computing
		if (previewMode && sharedPositions && sharedPositions.size > 0) {
			perfLog('path: previewMode+sharedPositions');
			if (positions.size === 0) {
				positions = new Map(sharedPositions);
				introComplete = true;
				// Set full opacity for all drawings
				const fullOpacities = new Map<string, number>();
				for (const drawing of drawings) {
					fullOpacities.set(drawing.id, 1);
				}
				drawingOpacities = fullOpacities;
				lastDrawingsLength = currentLength;
				trackedDrawingIds = currentIds;
			}
			return;
		}
		
		// Check if a new drawing was added and we have a pending position for it (user's own creation)
		if (currentLength === lastDrawingsLength + 1 && pendingPosition && positions.size > 0) {
			perfLog('path: pendingPosition (own creation)');
			// Find the new drawing (not in trackedDrawingIds)
			const newDrawing = drawings.find(d => !trackedDrawingIds.has(d.id));
			if (newDrawing) {
				// Place the new drawing at the pending position
				const newPositions = new Map(positions);
				newPositions.set(newDrawing.id, { ...pendingPosition });
				positions = newPositions;
				
				// Pre-cache the image so it renders immediately (no gray placeholder)
				getDrawingImage(newDrawing);
				
				// Set full opacity for the new drawing immediately
				const newOpacities = new Map(drawingOpacities);
				newOpacities.set(newDrawing.id, 1);
				drawingOpacities = newOpacities;
				
				// Update tracking
				lastDrawingsLength = currentLength;
				trackedDrawingIds = currentIds;
				
				// Notify parent of updated positions
				if (onPositionsComputed) {
					onPositionsComputed(positions);
				}
				
				scheduleRender();
				return; // Skip UMAP recalculation
			}
		}

		// Realtime drawings: project into existing space via k-NN (no UMAP recalculation)
		// Limited batch size to avoid layout drift; beyond limit we fall through to full UMAP
		// Defer k-NN to queueMicrotask to avoid blocking the main thread (feature extraction is CPU-heavy)
		const newCount = currentLength - lastDrawingsLength;
		if (newCount > 0 && newCount <= MAX_REALTIME_ADDITIONS_WITHOUT_UMAP && positions.size > 0 && !previewMode) {
			const newDrawings = drawings.filter(d => !trackedDrawingIds.has(d.id));
			if (newDrawings.length === newCount) {
				perfLog('path: k-NN projection (deferred)', { newCount, totalDrawings: currentLength });
				queueMicrotask(() => {
					const knnStart = DEBUG_PERF ? performance.now() : 0;
					try {
						let allProjected = true;
						const newPositions = new Map(positions);
						const newOpacities = new Map(drawingOpacities);

						for (const drawing of newDrawings) {
							if (!drawing?.pixels || !Array.isArray(drawing.pixels)) {
								allProjected = false;
								break;
							}
							const pos = computePreviewPosition([...drawing.pixels]);
							if (!pos) {
								allProjected = false;
								break;
							}
							newPositions.set(drawing.id, { ...pos });
							newOpacities.set(drawing.id, 1);
							getDrawingImage(drawing);
						}

						if (allProjected) {
							positions = newPositions;
							drawingOpacities = newOpacities;
							lastDrawingsLength = currentLength;
							trackedDrawingIds = currentIds;
							if (onPositionsComputed) {
								onPositionsComputed(positions);
							}
							scheduleRender();
							if (DEBUG_PERF) {
								perfLog('k-NN done', { ms: (performance.now() - knnStart).toFixed(1) });
							}
						} else {
							// Some drawings couldn't be projected - fall back to full UMAP
							lastDrawingsLength = currentLength;
							trackedDrawingIds = currentIds;
							untrack(() => runUMAP());
						}
					} catch (e) {
						console.warn('[GalleryCanvas] Realtime k-NN projection failed, falling through to UMAP:', e);
						lastDrawingsLength = currentLength;
						trackedDrawingIds = currentIds;
						untrack(() => runUMAP());
					}
				});
				return; // Skip UMAP - k-NN will run in microtask
			}
		}
		
		// Only run UMAP if:
		// 1. We have drawings
		// 2. Worker is ready
		// 3. Not already computing
		// 4. Drawings count has changed (prevents re-running on same data)
		// 5. Not in preview mode (preview should use shared positions)
		if (currentLength > 0 && worker && !isComputing && currentLength !== lastDrawingsLength && !previewMode) {
			perfLog('path: UMAP run', { currentLength, lastDrawingsLength });
			lastDrawingsLength = currentLength;
			trackedDrawingIds = currentIds;
			// Use untrack to read drawings without creating deep dependencies
			untrack(() => runUMAP());
		}
		
		if (DEBUG_PERF) {
			perfLog('effect exit (no-op or UMAP scheduled)', { ms: (performance.now() - effectStart).toFixed(1) });
		}
	});

	// Watch previewPixels and compute predicted position when preview is shown
	$effect(() => {
		// Read pixels to track changes - compute preview when pixels have content
		const pixelsLength = previewPixels.length;
		if (pixelsLength === 0) return;
		
		// Don't recompute position for saved preview - keep it where it was placed
		if (previewSaved) return;
		
		// Check if there's any non-white content
		const hasContent = previewPixels.some(p => p !== COLOR_WHITE);
		if (!hasContent) {
			// Clear preview position when canvas is empty
			previewPosition = null;
			previewTargetPosition = null;
			previewTweenStart = null;
			isPreviewTweening = false;
			return;
		}
		
		// Debounce the computation
		if (previewComputeTimeout) {
			clearTimeout(previewComputeTimeout);
		}
		
		// Compute immediately for the first preview (no position yet),
		// debounce subsequent updates during rapid drawing
		const needsImmediateCompute = untrack(() => previewPosition === null);
		
		previewComputeTimeout = setTimeout(() => {
			// Use untrack to avoid deep reactive dependencies
			const pixels = untrack(() => [...previewPixels]);
			const pos = computePreviewPosition(pixels);
			
			if (pos) {
				// Tween to the new position (viewport follows automatically)
				startPreviewTween(pos);
			}
		}, needsImmediateCompute ? 0 : 150);
		
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
		const _showPreview = showPreview; // Track preview state
		const _previewSaved = previewSaved; // Track preview saved state for opacity change
		const _highlighted = highlightedDrawingId; // Track highlighted drawing for recent mode
		const _previewPixels = previewPixels; // Track preview pixel changes for immediate re-render
		
		if (ctx && _drawings) {
			scheduleRender();
		}
	});

	function runUMAP(useCustomParams = false) {
		const umapStart = DEBUG_PERF ? performance.now() : 0;
		// Read drawings without creating reactive dependencies
		const currentDrawings = untrack(() => drawings);

		if (!worker || currentDrawings.length === 0) return;

		perfLog('runUMAP start', { count: currentDrawings.length });

		// Save snapshot so the done handler can map embeddings to the correct
		// drawings, even if the drawings array changes during computation.
		umapDrawingSnapshot = currentDrawings;

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
		
		// High-DPI: scale canvas buffer by devicePixelRatio for crisp rendering
		dpr = window.devicePixelRatio || 1;
		canvasWidth = rect.width;
		canvasHeight = rect.height;
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);
		
		// Re-apply image smoothing setting after resize (resize resets context state)
		if (ctx) {
			ctx.imageSmoothingEnabled = false;
		}
		// If we have positions, re-fit the view to show all drawings
		if (positions.size > 0) {
			fitAllInView(false, true);
		} else {
			offsetX = canvasWidth / 2;
			offsetY = canvasHeight / 2;
			targetOffsetX = offsetX;
			targetOffsetY = offsetY;
			targetScale = scale;
		}
		scheduleRender();
	}

	// Calculate the scale needed to fit all drawings in view
	function getMinScaleForBounds(): number {
		if (bounds.minX === bounds.maxX && bounds.minY === bounds.maxY) return 0.3;
		
		const padding = DRAWING_SIZE * 2; // Extra padding around bounds
		const boundsWidth = bounds.maxX - bounds.minX + padding;
		const boundsHeight = bounds.maxY - bounds.minY + padding;
		
		const scaleX = canvasWidth / boundsWidth;
		const scaleY = canvasHeight / boundsHeight;
		
		return Math.min(scaleX, scaleY, 1) * 0.9; // 0.9 to leave some margin
	}

	// Determine if we're on a mobile device (small screen)
	function isMobileView(): boolean {
		return canvas && canvasWidth < 768;
	}

	// Fit all drawings in the viewport
	// animate = true: smoothly animate to the fit position
	// animate = false: snap immediately (for initial load)
	// maxZoomOut = true: zoom out as far as needed to show all drawings (no minimum scale)
	function fitAllInView(animate = false, maxZoomOut = false) {
		if (positions.size === 0) return;
		
		const fitScale = getMinScaleForBounds();
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;
		
		let finalScale: number;
		if (maxZoomOut) {
			// Zoom out as far as needed to show all drawings
			finalScale = fitScale;
		} else {
			// On mobile, start more zoomed in so drawings are larger and visible
			// Use a higher minimum scale for mobile devices
			const minScale = isMobileView() ? 0.8 : 0.5;
			finalScale = Math.max(fitScale, minScale);
		}
		
		targetScale = finalScale;
		targetOffsetX = canvasWidth / 2 - centerX * finalScale;
		targetOffsetY = canvasHeight / 2 - centerY * finalScale;
		
		if (!animate) {
			// Snap immediately for initial load
			scale = finalScale;
			offsetX = targetOffsetX;
			offsetY = targetOffsetY;
			// Immediately notify parent to prevent sync effects from overriding
			if (onViewChange) {
				onViewChange(scale, offsetX, offsetY);
			}
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
		const worldRightX = (canvasWidth - offsetX) / scale;
		
		// Draw main axis line
		ctx.save();
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, axisScreenY);
		ctx.lineTo(canvasWidth, axisScreenY);
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
			if (screenX < -50 || screenX > canvasWidth + 50) continue;
			
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
		if (nowScreenX >= -50 && nowScreenX <= canvasWidth + 50) {
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

		// Apply DPR scaling so all coordinates work in CSS pixels
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;

		// Clear canvas with white background
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

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
				screenX - size > canvasWidth ||
				screenY + size < 0 ||
				screenY - size > canvasHeight
			) {
				continue;
			}

			renderDrawing(drawing, screenX, screenY, size);
		}

		// Render preview drawing if showing preview (works with or without full previewMode)
		if (showPreview && previewPosition) {
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

	// Render the preview drawing as a ghost
	function renderPreviewDrawing() {
		if (!ctx || !previewPosition) return;
		
		const screenX = previewPosition.x * scale + offsetX;
		const screenY = previewPosition.y * scale + offsetY;
		const size = DRAWING_SIZE * scale;
		const drawSize = size;
		const halfSize = drawSize / 2;
		const x = screenX - halfSize;
		const y = screenY - halfSize;
		
		// Skip if off-screen
		if (x + drawSize < 0 || x > canvasWidth || y + drawSize < 0 || y > canvasHeight) {
			return;
		}
		
		// When in saved state, keep using the cached image (don't regenerate from
		// previewPixels which may have been cleared by the parent)
		const hasPixelContent = previewPixels.length > 0 && previewPixels.some(p => p !== COLOR_WHITE);
		if (hasPixelContent) {
			// Create or update cached preview image from current pixels
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
		}
		// If no pixel content but previewSaved, we just reuse the last cached image
		
		if (!previewImageCache) return;
		const img = previewImageCache.img;
		if (!img.complete) return;
		
		ctx.save();
		
		// Draw the preview image: full opacity if saved, semi-transparent if still drafting
		ctx.globalAlpha = previewSaved ? 1.0 : 0.5;
		ctx.drawImage(img, x, y, drawSize, drawSize);
		
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

		// Use floating-point positions for smooth panning/zooming.
		// The DPR-scaled canvas buffer provides enough physical pixels
		// for sub-pixel CSS coordinates to render without visible artifacts.
		const drawSize = size;
		const halfSize = drawSize / 2;
		const x = screenX - halfSize;
		const y = screenY - halfSize;
		
		// Get opacity for this drawing (default to 1 if not in intro animation)
		let opacity = drawingOpacities.get(drawing.id) ?? 1;
		
		// Apply highlight mode fading - fade non-highlighted drawings
		if (highlightedDrawingId && drawing.id !== highlightedDrawingId) {
			opacity *= 0.15; // Fade to 15% opacity
		}
		
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
		// Disable interaction in preview mode or during intro animation
		if (previewMode || !introComplete) return;
		
		event.preventDefault();

		const rect = canvas.getBoundingClientRect();
		const mouseCanvasX = event.clientX - rect.left;
		const mouseCanvasY = event.clientY - rect.top;

		// Zoom toward cursor - deltaY-proportional so trackpads (many tiny deltas)
		// and mouse wheels (fewer large deltas) both feel natural.
		// deltaMode 1 = line units (some mice), convert to ~pixel equivalent.
		let normalizedDelta = event.deltaY;
		if (event.deltaMode === 1) normalizedDelta *= 30;
		// pow(0.998, delta): small trackpad scrolls → subtle zoom, mouse clicks → snappy zoom
		// Clamped to ±12% per event to prevent huge jumps from momentum scrolling.
		const rawFactor = Math.pow(0.998, normalizedDelta);
		const zoomFactor = Math.max(0.88, Math.min(1.12, rawFactor));
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
		// Disable interaction in preview mode or during intro animation
		if (previewMode || !introComplete) return;
		
		// Skip if pinching (touch events handle this)
		if (isPinching || event.pointerType === 'touch') return;
		
		if (event.button === 0) {
			isDragging = true;
			lastMouseX = event.clientX;
			lastMouseY = event.clientY;
			// Record for click detection
			mouseDownX = event.clientX;
			mouseDownY = event.clientY;
			mouseDownTime = Date.now();
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
			
			// Notify parent of view changes
			if (onViewChange) {
				onViewChange(scale, offsetX, offsetY);
			}
			
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

	// Track mouse down position for click detection
	let mouseDownX = 0;
	let mouseDownY = 0;
	let mouseDownTime = 0;
	const CLICK_THRESHOLD = 5; // max movement in pixels for click
	const CLICK_DURATION = 300; // max duration in ms for click

	function handlePointerUp(event: PointerEvent) {
		// Skip if touch (touch events handle this)
		if (event.pointerType === 'touch') return;
		
		isDragging = false;
		canvas.releasePointerCapture(event.pointerId);
		
		// Check if this was a click (minimal movement, short duration)
		const dx = event.clientX - mouseDownX;
		const dy = event.clientY - mouseDownY;
		const distance = Math.sqrt(dx * dx + dy * dy);
		const duration = Date.now() - mouseDownTime;
		
		if (distance < CLICK_THRESHOLD && duration < CLICK_DURATION) {
			// This was a click - check if we clicked on a drawing
			const clickedDrawing = findDrawingAtPoint(event.clientX, event.clientY);
			if (clickedDrawing && onDrawingClick) {
				onDrawingClick(clickedDrawing.id);
				return; // Don't start momentum after click
			}
		}
		
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
		// Disable interaction in preview mode or during intro animation
		if (previewMode || !introComplete) return;
		
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
			const minScale = Math.min(getMinScaleForBounds(), 1);
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

			// Notify parent of view changes
			if (onViewChange) {
				onViewChange(scale, offsetX, offsetY);
			}

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
			
			// Notify parent of view changes
			if (onViewChange) {
				onViewChange(scale, offsetX, offsetY);
			}
			
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
						// Call click handler if provided
						if (onDrawingClick) {
							onDrawingClick(tappedDrawing.id);
						} else {
							// Fallback: show popup for tapped drawing
							hoveredDrawing = tappedDrawing;
							mouseX = endedTouch.clientX;
							mouseY = endedTouch.clientY;
							showPopup = true;
						}
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
	{#if isComputing && !previewMode && positions.size === 0}
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
		class:hovering-drawing={hoveredDrawing !== null && !isDragging}
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
		<DrawingPopup drawing={hoveredDrawing} x={mouseX} y={mouseY} visible={showPopup && introComplete && !highlightedDrawingId} />
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

	canvas.hovering-drawing {
		cursor: pointer;
	}

	canvas.preview-mode {
		cursor: default;
		pointer-events: none;
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		background: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.loading-content {
		text-align: center;
		color: #000;
	}

	.loading-title {
		margin: 0 0 8px 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: #000;
	}

	.progress-bar {
		width: 200px;
		height: 2px;
		background: #ccc;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #000;
		transition: width 0.15s ease-out;
	}

	.progress-text {
		margin: 6px 0 0 0;
		font-size: 0.7rem;
		font-weight: 400;
		color: #fff;
		font-variant-numeric: tabular-nums;
	}


	.empty-state {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #fff;
		pointer-events: none;
	}

	.empty-state p {
		margin: 0;
		font-size: 0.75rem;
	}

	.empty-state .hint {
		font-size: 0.7rem;
		margin-top: 4px;
		color: #fff;
	}
</style>


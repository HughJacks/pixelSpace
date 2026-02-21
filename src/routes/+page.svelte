<script lang="ts">
	import { onMount } from 'svelte';
	import GalleryCanvas from '$lib/components/GalleryCanvas.svelte';
	import { getAllDrawings, subscribeToDrawings, subscribeToPresence, createDrawing } from '$lib/supabase';
	import { type Drawing, DRAWING_NAME_MAX_LENGTH } from '$lib/types';
	import { PALETTE, GRID_SIZE, COLOR_WHITE, colorToHex, getDefaultPixels } from '$lib/palette';
	import { setFaviconFromPixels, resetFavicon } from '$lib/drawing-svg';

	let username = $state('');
	let showUsernameModal = $state(false);
	let usernameInput = $state('');
	let drawings: Drawing[] = $state([]);
	let isLoading = $state(true);
	let introAnimationDone = $state(false);
	let showCreate = $state(false);
	let pendingCreate = $state(false); // Track if user wants to create after setting username

	// Inline create panel state
	let createPixels: number[] = $state(getDefaultPixels());
	let createName = $state('');
	let createSelectedColor = $state(0);
	let isCreating = $state(false);
	let createError = $state('');
	let createGridContainer: HTMLDivElement;
	let isDrawingOnCanvas = $state(false);
	let lastPixelX = -1;
	let lastPixelY = -1;

	// Saved preview state: keeps the drawing visible at full opacity after save
	// until the real drawing arrives via subscription
	let savedPreviewPixels: number[] = $state([]);
	let savedPreviewActive = $state(false);

	// Shared view state between gallery and create mode
	// Start as undefined so GalleryCanvas can fitAllInView without the sync effect overriding it
	let viewScale: number | undefined = $state(undefined);
	let viewOffsetX: number | undefined = $state(undefined);
	let viewOffsetY: number | undefined = $state(undefined);

	function handleViewChange(scale: number, offsetX: number, offsetY: number) {
		viewScale = scale;
		viewOffsetX = offsetX;
		viewOffsetY = offsetY;
	}

	// Shared positions (computed once by main canvas, reused by preview)
	let sharedPositions: Map<string, { x: number; y: number }> = $state(new Map());

	function handlePositionsComputed(positions: Map<string, { x: number; y: number }>) {
		sharedPositions = positions;
	}
	
	// Track preview position for placing saved drawings
	let currentPreviewPosition: { x: number; y: number } | null = $state(null);
	let pendingNewDrawingPosition: { x: number; y: number } | null = $state(null);
	
	function handlePreviewPositionChange(position: { x: number; y: number } | null) {
		currentPreviewPosition = position;
	}

	// Recent mode state
	let recentMode = $state(false);
	let recentIndex = $state(0); // Current index in sorted drawings (0 = most recent)
	let showTunePanel = $state(false);
	let centerOnDrawingFn: ((drawingId: string) => void) | null = $state(null);
	
	// Clustering UI state (bound to gallery via props)
	let clusterWeightColor = $state(true);
	let clusterWeightShape = $state(true);
	let clusterWeightStyle = $state(true);
	let clusterNeighbors = $state(15);
	let clusterSpread = $state(0.1);
	let clusterQuality = $state(150);
	let clusterMode = $state<'cluster' | 'timeline'>('cluster');
	let isComputing = $state(false);
	let isAnimating = $state(false);
	let reclusterFn: (() => void) | null = $state(null);
	
	// Radial dial dragging state
	let activeDial: 'neighbors' | 'spread' | 'quality' | null = $state(null);
	let dialStartY = 0;
	let dialStartValue = 0;
	
	function handleClusterStateChange(computing: boolean, animating: boolean) {
		isComputing = computing;
		isAnimating = animating;
	}
	
	function handleReclusterReady(fn: () => void) {
		reclusterFn = fn;
	}
	
	function handleRecluster() {
		reclusterFn?.();
	}
	
	// Mobile: randomize all cluster params and trigger recluster
	function handleRandomRecluster() {
		// Randomly toggle each weight (ensure at least one is on)
		const c = Math.random() > 0.4;
		const s = Math.random() > 0.4;
		const t = Math.random() > 0.4;
		// If all ended up off, pick one at random
		if (!c && !s && !t) {
			const pick = Math.floor(Math.random() * 3);
			clusterWeightColor = pick === 0;
			clusterWeightShape = pick === 1;
			clusterWeightStyle = pick === 2;
		} else {
			clusterWeightColor = c;
			clusterWeightShape = s;
			clusterWeightStyle = t;
		}
		// Random params
		clusterNeighbors = Math.round(2 + Math.random() * 48); // 2-50
		clusterSpread = 0.01 + Math.random() * 0.99; // 0.01-1.0
		clusterQuality = Math.round(50 + Math.random() * 450); // 50-500
		// Force cluster mode (no timeline on mobile)
		clusterMode = 'cluster';
		// Trigger recluster
		reclusterFn?.();
	}
	
	function toggleWeight(weight: 'color' | 'shape' | 'style') {
		if (weight === 'color') {
			clusterWeightColor = !clusterWeightColor;
		} else if (weight === 'shape') {
			clusterWeightShape = !clusterWeightShape;
		} else {
			clusterWeightStyle = !clusterWeightStyle;
		}
	}
	
	function switchMode(mode: 'cluster' | 'timeline') {
		clusterMode = mode;
	}
	
	function handleDialPointerDown(dial: 'neighbors' | 'spread' | 'quality', event: PointerEvent) {
		activeDial = dial;
		dialStartY = event.clientY;
		if (dial === 'neighbors') dialStartValue = clusterNeighbors;
		else if (dial === 'spread') dialStartValue = clusterSpread;
		else dialStartValue = clusterQuality;
		
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
	}
	
	function handleDialPointerMove(event: PointerEvent) {
		if (!activeDial) return;
		
		const deltaY = dialStartY - event.clientY;
		const sensitivity = 0.5;
		
		if (activeDial === 'neighbors') {
			clusterNeighbors = Math.round(Math.max(2, Math.min(50, dialStartValue + deltaY * sensitivity)));
		} else if (activeDial === 'spread') {
			clusterSpread = Math.max(0.01, Math.min(1, dialStartValue + deltaY * 0.005));
		} else {
			clusterQuality = Math.round(Math.max(50, Math.min(500, dialStartValue + deltaY * 2)));
		}
	}
	
	function handleDialPointerUp(event: PointerEvent) {
		if (activeDial) {
			(event.target as HTMLElement).releasePointerCapture(event.pointerId);
			activeDial = null;
		}
	}
	
	// Calculate dial rotation based on value
	function getDialRotation(dial: 'neighbors' | 'spread' | 'quality'): number {
		if (dial === 'neighbors') {
			return ((clusterNeighbors - 2) / 48) * 270 - 135; // 2-50 range, -135 to 135 degrees
		} else if (dial === 'spread') {
			return ((clusterSpread - 0.01) / 0.99) * 270 - 135; // 0.01-1 range
		} else {
			return ((clusterQuality - 50) / 450) * 270 - 135; // 50-500 range
		}
	}

	// All drawings sorted by creation date (newest first)
	let sortedDrawings = $derived.by(() => {
		return [...drawings].sort((a, b) => b.created.localeCompare(a.created));
	});

	// Currently highlighted drawing in recent mode
	let highlightedDrawing = $derived.by(() => {
		if (!recentMode || sortedDrawings.length === 0) return null;
		return sortedDrawings[recentIndex] ?? null;
	});

	// Navigation state
	let canGoNewer = $derived(recentMode && recentIndex > 0);
	let canGoOlder = $derived(recentMode && recentIndex < sortedDrawings.length - 1);

	// Count unique users
	let uniqueUserCount = $derived(new Set(drawings.map(d => d.creator)).size);

	// Favicon: pick a random drawing on each page load/refresh
	$effect(() => {
		if (typeof document === 'undefined') return;
		if (isLoading || sortedDrawings.length === 0) {
			resetFavicon();
			return;
		}
		const list = [...sortedDrawings];
		const chosen = list[Math.floor(Math.random() * list.length)];
		setFaviconFromPixels(chosen.pixels);
		return () => resetFavicon();
	});

	// Online now (from Supabase Presence)
	let onlineCount = $state<number | null>(null);

	// +1 popup when new drawing or user added in realtime
	let plusOneCount = $state(0);
	let plusOneTimeout: ReturnType<typeof setTimeout> | null = null;
	function triggerPlusOne() {
		plusOneCount++;
		if (plusOneTimeout) clearTimeout(plusOneTimeout);
		plusOneTimeout = setTimeout(() => {
			plusOneCount = 0;
			plusOneTimeout = null;
		}, 2500);
	}

	// Format relative time
	function formatRelativeTime(dateString: string): string {
		const date = new Date(dateString);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	function handleCenterOnDrawing(fn: (drawingId: string) => void) {
		centerOnDrawingFn = fn;
	}

	// Enter recent mode at a specific drawing (when clicking an image)
	function enterRecentModeAtDrawing(drawingId: string) {
		// Find the index of this drawing in sortedDrawings
		const index = sortedDrawings.findIndex(d => d.id === drawingId);
		if (index === -1) return;
		
		recentMode = true;
		recentIndex = index;
		// Zoom to the drawing
		if (centerOnDrawingFn) {
			centerOnDrawingFn(drawingId);
		}
	}

	// Enter recent mode and zoom to most recent drawing
	function enterRecentMode() {
		if (sortedDrawings.length === 0) return;
		recentMode = true;
		recentIndex = 0;
		zoomToCurrentRecent();
	}

	// Exit recent mode
	function exitRecentMode() {
		recentMode = false;
	}

	// Zoom to the currently selected recent drawing
	function zoomToCurrentRecent() {
		const drawing = sortedDrawings[recentIndex];
		if (drawing && centerOnDrawingFn) {
			centerOnDrawingFn(drawing.id);
		}
	}

	// Navigate to newer drawing (left arrow)
	function goNewer() {
		if (!canGoNewer) return;
		recentIndex--;
		zoomToCurrentRecent();
	}

	// Navigate to older drawing (right arrow)
	function goOlder() {
		if (!canGoOlder) return;
		recentIndex++;
		zoomToCurrentRecent();
	}

	// Handle keyboard navigation in recent mode
	function handleKeydown(event: KeyboardEvent) {
		if (recentMode && !showCreate) {
			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				goOlder();
			} else if (event.key === 'ArrowRight') {
				event.preventDefault();
				goNewer();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				exitRecentMode();
			}
		}
	}

	onMount(() => {
		// Check for stored username (but don't require it)
		const storedUsername = localStorage.getItem('pixelspace_username');
		if (storedUsername) {
			username = storedUsername;
		}

		// Fetch drawings - show cached data instantly, then merge server data
		// IMPORTANT: Merge (don't replace) so realtime additions aren't lost when fetch resolves
		getAllDrawings((cachedData) => {
				// Cache is ready - show drawings immediately
				drawings = cachedData;
				isLoading = false;
			})
			.then((data) => {
				// Merge server data with current drawings - preserve any added via realtime
				const byId = new Map(data.map((d) => [d.id, d]));
				for (const d of drawings) {
					if (!byId.has(d.id)) byId.set(d.id, d);
				}
				drawings = [...byId.values()].sort((a, b) => b.created.localeCompare(a.created));
			})
			.catch((error) => {
				console.error('Failed to load drawings:', error);
			})
			.finally(() => {
				isLoading = false;
			});

		// Subscribe to real-time updates
		const unsubscribe = subscribeToDrawings((newDrawing) => {
			try {
				const isNew = !drawings.some((d) => d.id === newDrawing.id);
				if (isNew) {
					drawings = [newDrawing, ...drawings];
					triggerPlusOne(); // New drawing from another user (or realtime before optimistic add)
				}

				// Clear saved preview after a short delay to let GalleryCanvas
				// place the real drawing first (avoiding a flash of empty space)
				if (savedPreviewActive) {
					setTimeout(() => {
						savedPreviewActive = false;
						savedPreviewPixels = [];
						pendingNewDrawingPosition = null;
					}, 300);
				}
			} catch (e) {
				console.error('[Realtime] Error in drawings callback:', e);
			}
		});

		// Subscribe to presence for online count (use stored username or anonymous id)
		const presenceId = storedUsername || 'guest-' + crypto.randomUUID().slice(0, 8);
		let prevOnlineCount: number | null = null;
		const unsubscribePresence = subscribeToPresence(presenceId, (count) => {
			try {
				if (prevOnlineCount !== null && count > prevOnlineCount) {
					triggerPlusOne(); // New user came online
				}
				prevOnlineCount = count;
				onlineCount = count;
			} catch (e) {
				console.error('[Realtime] Error in presence callback:', e);
			}
		});

	// Add keyboard listener
	window.addEventListener('keydown', handleKeydown);

	// Close tune panel when resizing to mobile (it's hidden on mobile via CSS,
	// but showTunePanel being true also hides the main buttons, causing an empty toolbar)
	function handleResize() {
		if (window.innerWidth <= 768 && showTunePanel) {
			showTunePanel = false;
		}
	}
	window.addEventListener('resize', handleResize);

	return () => {
		unsubscribe();
		unsubscribePresence();
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('resize', handleResize);
	};
	});

	function handleSetUsername() {
		if (usernameInput.trim()) {
			username = usernameInput.trim();
			localStorage.setItem('pixelspace_username', username);
			showUsernameModal = false;
			
			// If user was trying to create, open the create view now
			if (pendingCreate) {
				pendingCreate = false;
				showCreate = true;
			}
		}
	}

	function handleUsernameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSetUsername();
		}
	}

	function handleCreateNew() {
		// If no username is set, show the username modal first
		if (!username) {
			pendingCreate = true;
			showUsernameModal = true;
			return;
		}
		// Exit recent mode if active
		recentMode = false;
		showCreate = true;
	}

	function handleChangeUsername() {
		usernameInput = username;
		showUsernameModal = true;
	}

	// Create panel drawing functions
	function getPixelFromPoint(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!createGridContainer) return null;
		
		const rect = createGridContainer.getBoundingClientRect();
		const relX = clientX - rect.left;
		const relY = clientY - rect.top;
		
		const cellWidth = rect.width / GRID_SIZE;
		const cellHeight = rect.height / GRID_SIZE;
		
		const x = Math.floor(relX / cellWidth);
		const y = Math.floor(relY / cellHeight);
		
		if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
			return { x, y };
		}
		return null;
	}

	function setPixel(x: number, y: number, colorIndex: number) {
		if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
		const idx = y * GRID_SIZE + x;
		if (createPixels[idx] !== colorIndex) {
			createPixels[idx] = colorIndex;
			createPixels = [...createPixels];
		}
	}

	function drawAtPoint(clientX: number, clientY: number, isErasing: boolean) {
		const pixel = getPixelFromPoint(clientX, clientY);
		if (!pixel) return;
		
		if (pixel.x === lastPixelX && pixel.y === lastPixelY) return;
		
		lastPixelX = pixel.x;
		lastPixelY = pixel.y;
		
		setPixel(pixel.x, pixel.y, isErasing ? COLOR_WHITE : createSelectedColor);
	}

	let isErasingCreate = false;

	function handleCreatePointerDown(event: PointerEvent) {
		event.preventDefault();
		isDrawingOnCanvas = true;
		isErasingCreate = event.button === 2;
		lastPixelX = -1;
		lastPixelY = -1;
		
		createGridContainer.setPointerCapture(event.pointerId);
		drawAtPoint(event.clientX, event.clientY, isErasingCreate);
	}

	function handleCreatePointerMove(event: PointerEvent) {
		if (!isDrawingOnCanvas) return;
		event.preventDefault();
		drawAtPoint(event.clientX, event.clientY, isErasingCreate);
	}

	function handleCreatePointerUp(event: PointerEvent) {
		if (isDrawingOnCanvas) {
			createGridContainer.releasePointerCapture(event.pointerId);
		}
		isDrawingOnCanvas = false;
		isErasingCreate = false;
		lastPixelX = -1;
		lastPixelY = -1;
	}

	function clearCreateCanvas() {
		createPixels = getDefaultPixels();
	}

	function handleCreateContextMenu(event: MouseEvent) {
		event.preventDefault();
	}

	async function handleSaveDrawing() {
		if (!createName.trim()) {
			createError = 'Please give your drawing a name';
			return;
		}

		if (!username) {
			pendingCreate = true;
			showUsernameModal = true;
			return;
		}

		isCreating = true;
		createError = '';

		// Store the current preview position to use when the drawing arrives
		if (currentPreviewPosition) {
			pendingNewDrawingPosition = { ...currentPreviewPosition };
		}

		try {
			const result = await createDrawing({
				name: createName.trim(),
				creator: username,
				pixels: createPixels
			});

			if (result) {
				// Add our drawing immediately so it appears without refresh
				// (realtime subscription will dedupe if it fires later)
				drawings = [result, ...drawings];
				// Keep the drawing visible at full opacity by storing it as saved preview
				savedPreviewPixels = [...createPixels];
				savedPreviewActive = true;

				// Show +1 when user creates their own drawing
				triggerPlusOne();

				// Close create panel and reset for next time
				showCreate = false;
				createPixels = getDefaultPixels();
				createName = '';
				
				// Clear pending position after a generous delay (allow time for realtime subscription to deliver the drawing)
				setTimeout(() => {
					pendingNewDrawingPosition = null;
				}, 30000);
				
				// Safety fallback: clear saved preview after 5s if subscription hasn't fired
				setTimeout(() => {
					if (savedPreviewActive) {
						savedPreviewActive = false;
						savedPreviewPixels = [];
					}
				}, 5000);
			} else {
				createError = 'Failed to save. Please try again.';
				pendingNewDrawingPosition = null;
			}
		} catch (err) {
			console.error('Save error:', err);
			createError = 'Failed to save. Please try again.';
			pendingNewDrawingPosition = null;
		} finally {
			isCreating = false;
		}
	}

	function cancelCreate() {
		showCreate = false;
		createPixels = getDefaultPixels();
		createName = '';
		createError = '';
	}

	// Convert flat array to 2D grid for rendering
	let createGrid = $derived.by(() => {
		const result: number[][] = [];
		for (let y = 0; y < GRID_SIZE; y++) {
			const row: number[] = [];
			for (let x = 0; x < GRID_SIZE; x++) {
				const idx = y * GRID_SIZE + x;
				row.push(createPixels[idx] ?? COLOR_WHITE);
			}
			result.push(row);
		}
		return result;
	});
</script>

<div class="page">
	{#if isLoading}
		<div class="loading" role="status" data-testid="page-loading">
			<p class="loading-title">Loading drawings</p>
			<div class="progress-bar">
				<div class="progress-fill indeterminate"></div>
			</div>
		</div>
	{:else}
		<GalleryCanvas 
			{drawings} 
			onCenterOnDrawing={handleCenterOnDrawing}
			onDrawingClick={enterRecentModeAtDrawing}
			previewPixels={showCreate ? createPixels : savedPreviewPixels}
			previewSaved={savedPreviewActive}
			onPreviewPositionChange={handlePreviewPositionChange}
			{pendingNewDrawingPosition}
			{viewScale}
			{viewOffsetX}
			{viewOffsetY}
			onViewChange={handleViewChange}
			onPositionsComputed={handlePositionsComputed}
			bind:showControlPanel={showTunePanel}
			highlightedDrawingId={highlightedDrawing?.id ?? null}
			bind:clusterWeightColor
			bind:clusterWeightShape
			bind:clusterWeightStyle
			bind:clusterNeighbors
			bind:clusterSpread
			bind:clusterQuality
			bind:clusterMode
			onClusterStateChange={handleClusterStateChange}
			onReclusterReady={handleReclusterReady}
			onIntroComplete={() => { introAnimationDone = true; }}
		/>
	{/if}

	<!-- Unified bottom toolbar -->
	<div class="toolbar" class:fade-in={introAnimationDone} class:recent-mode={recentMode} class:tune-mode={showTunePanel} class:create-mode={showCreate} data-testid="toolbar" data-mode={showCreate ? 'create' : recentMode ? 'recent' : showTunePanel ? 'tune' : 'main'}>
		<!-- Main mode buttons -->
		<div class="toolbar-group main-buttons" class:active={!recentMode && !showTunePanel && !showCreate}>
			<button
				class="toolbar-btn"
				onclick={enterRecentMode}
				aria-label="Browse drawings"
				disabled={sortedDrawings.length === 0}
				data-testid="browse-btn"
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5"/>
					<path d="M13 13l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>

			<button class="toolbar-btn primary" onclick={handleCreateNew} data-testid="create-btn" aria-label="Create new drawing">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
				<span>Create</span>
			</button>

			<!-- Desktop: open tune panel -->
			<button
				class="toolbar-btn desktop-only"
				class:active={showTunePanel}
				onclick={() => (showTunePanel = !showTunePanel)}
				aria-label="Tune visualization"
				aria-pressed={showTunePanel}
				data-testid="tune-btn"
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<circle cx="6" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
					<circle cx="14" cy="10" r="2" stroke="currentColor" stroke-width="1.5"/>
					<circle cx="6" cy="15" r="2" stroke="currentColor" stroke-width="1.5"/>
					<path d="M8 5h9M3 5h1M16 10h1M3 10h9M8 15h9M3 15h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>
			<!-- Mobile: random recluster -->
			<button
				class="toolbar-btn mobile-only"
				onclick={handleRandomRecluster}
				disabled={isComputing || isAnimating || drawings.length === 0}
				aria-label="Shuffle clustering"
				data-testid="shuffle-btn"
			>
				{#if isComputing || isAnimating}
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" class="spinning">
						<path d="M10 3v3M10 14v3M3 10h3M14 10h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
				{:else}
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path d="M3 7h2.5a2 2 0 0 1 1.8 1.1L8 10l.7 1.9A2 2 0 0 0 10.5 13H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						<path d="M3 13h2.5a2 2 0 0 0 1.8-1.1L8 10l.7-1.9A2 2 0 0 1 10.5 7H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						<path d="M14 5l2 2-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M14 11l2 2-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				{/if}
			</button>
			</div>

		<!-- Create mode panel -->
		<div class="toolbar-group create-panel" class:active={showCreate} data-testid="create-panel">
			<!-- Top area: palette + grid (palette left, grid right) -->
			<div class="create-top-area">
				<div class="create-palette-col">
					<div class="create-palette" role="radiogroup" aria-label="Color palette" data-testid="create-color-palette">
						{#each PALETTE as color, index}
							<button
								class="create-color-swatch"
								class:active={createSelectedColor === index}
								style="background-color: {colorToHex(color)}"
								onclick={() => (createSelectedColor = index)}
								title={color.name}
								role="radio"
								aria-checked={createSelectedColor === index}
								aria-label="Select {color.name} color"
								data-testid="create-swatch-{color.name.toLowerCase()}"
								data-color-index={index}
							></button>
						{/each}
					</div>
				</div>
				<div class="create-grid-wrapper">
					<div
						class="create-grid"
						bind:this={createGridContainer}
						onpointerdown={handleCreatePointerDown}
						onpointermove={handleCreatePointerMove}
						onpointerup={handleCreatePointerUp}
						onpointercancel={handleCreatePointerUp}
						onpointerleave={handleCreatePointerUp}
						oncontextmenu={handleCreateContextMenu}
						role="grid"
						aria-label="Pixel drawing canvas, {GRID_SIZE}x{GRID_SIZE}"
						data-testid="create-pixel-grid"
						data-grid-size={GRID_SIZE}
					>
						{#each createGrid as row, y}
							{#each row as colorIndex, x}
								<div
									class="create-pixel"
									style="background-color: {colorToHex(PALETTE[colorIndex] ?? PALETTE[COLOR_WHITE])}"
									data-testid="create-pixel-{x}-{y}"
									data-x={x}
									data-y={y}
									data-color-index={colorIndex}
								></div>
							{/each}
						{/each}
					</div>
				</div>
			</div>

			<!-- Name input and buttons row -->
			<div class="create-bottom-row">
				<input
					type="text"
					class="create-name-input"
					placeholder="Name..."
					bind:value={createName}
					maxlength={DRAWING_NAME_MAX_LENGTH}
					class:has-error={createError && !createName.trim()}
					aria-label="Drawing name"
					data-testid="create-name-input"
				/>
				<button class="toolbar-btn" onclick={cancelCreate} aria-label="Cancel drawing" data-testid="create-cancel-btn">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
						<path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
				</button>
				<button class="toolbar-btn primary" onclick={handleSaveDrawing} disabled={isCreating} aria-label="Save drawing" data-testid="create-save-btn">
					<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
						<path d="M5 10l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			</div>

			{#if createError}
				<p class="create-error" role="alert" data-testid="create-error">{createError}</p>
			{/if}
		</div>

			<!-- Clustering mode buttons -->
			<div class="toolbar-group tune-buttons" class:active={showTunePanel && !recentMode} data-testid="tune-panel">
			<!-- Feature toggles -->
			<div class="toggle-group" data-testid="feature-toggles">
				<button 
					class="toggle-btn"
					class:active={clusterWeightColor}
					onclick={() => toggleWeight('color')}
					data-tooltip="Color similarity"
					aria-pressed={clusterWeightColor}
					aria-label="Toggle color similarity"
					data-testid="toggle-color"
				>C</button>
				<button 
					class="toggle-btn"
					class:active={clusterWeightShape}
					onclick={() => toggleWeight('shape')}
					data-tooltip="Shape similarity"
					aria-pressed={clusterWeightShape}
					aria-label="Toggle shape similarity"
					data-testid="toggle-shape"
				>S</button>
				<button 
					class="toggle-btn"
					class:active={clusterWeightStyle}
					onclick={() => toggleWeight('style')}
					data-tooltip="Style similarity"
					aria-pressed={clusterWeightStyle}
					aria-label="Toggle style similarity"
					data-testid="toggle-style"
				>T</button>
			</div>
			
			<div class="toolbar-divider"></div>
			
			<!-- Radial dials -->
			<div class="dial-group">
				<div 
					class="radial-dial"
					class:dragging={activeDial === 'neighbors'}
					role="slider"
					aria-label="Neighbors"
					aria-valuenow={clusterNeighbors}
					aria-valuemin={2}
					aria-valuemax={50}
					tabindex="0"
					onpointerdown={(e) => handleDialPointerDown('neighbors', e)}
					onpointermove={handleDialPointerMove}
					onpointerup={handleDialPointerUp}
					data-tooltip="Neighbors: {clusterNeighbors}"
				>
					<div class="dial-knob" style="transform: rotate({getDialRotation('neighbors')}deg)">
						<div class="dial-indicator"></div>
					</div>
					<span class="dial-label">N</span>
				</div>
				<div 
					class="radial-dial"
					class:dragging={activeDial === 'spread'}
					role="slider"
					aria-label="Spread"
					aria-valuenow={clusterSpread}
					aria-valuemin={0.01}
					aria-valuemax={1}
					tabindex="0"
					onpointerdown={(e) => handleDialPointerDown('spread', e)}
					onpointermove={handleDialPointerMove}
					onpointerup={handleDialPointerUp}
					data-tooltip="Spread: {clusterSpread.toFixed(2)}"
				>
					<div class="dial-knob" style="transform: rotate({getDialRotation('spread')}deg)">
						<div class="dial-indicator"></div>
					</div>
					<span class="dial-label">S</span>
				</div>
				<div 
					class="radial-dial"
					class:dragging={activeDial === 'quality'}
					role="slider"
					aria-label="Quality"
					aria-valuenow={clusterQuality}
					aria-valuemin={50}
					aria-valuemax={500}
					tabindex="0"
					onpointerdown={(e) => handleDialPointerDown('quality', e)}
					onpointermove={handleDialPointerMove}
					onpointerup={handleDialPointerUp}
					data-tooltip="Quality: {clusterQuality}"
				>
					<div class="dial-knob" style="transform: rotate({getDialRotation('quality')}deg)">
						<div class="dial-indicator"></div>
					</div>
					<span class="dial-label">Q</span>
				</div>
			</div>
			
			<div class="toolbar-divider"></div>
			
			<!-- Mode toggle -->
			<div class="mode-toggle-group" role="radiogroup" aria-label="Visualization mode" data-testid="mode-toggle">
				<button 
					class="mode-btn"
					class:active={clusterMode === 'cluster'}
					onclick={() => switchMode('cluster')}
					disabled={isComputing || isAnimating}
					data-tooltip="Cluster view"
					role="radio"
					aria-checked={clusterMode === 'cluster'}
					aria-label="Cluster view"
					data-testid="mode-cluster"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<circle cx="5" cy="5" r="2" fill="currentColor"/>
						<circle cx="11" cy="5" r="2" fill="currentColor"/>
						<circle cx="8" cy="11" r="2" fill="currentColor"/>
					</svg>
				</button>
				<button 
					class="mode-btn"
					class:active={clusterMode === 'timeline'}
					onclick={() => switchMode('timeline')}
					disabled={isComputing || isAnimating}
					data-tooltip="Timeline view"
					role="radio"
					aria-checked={clusterMode === 'timeline'}
					aria-label="Timeline view"
					data-testid="mode-timeline"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<path d="M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						<circle cx="4" cy="8" r="1.5" fill="currentColor"/>
						<circle cx="8" cy="8" r="1.5" fill="currentColor"/>
						<circle cx="12" cy="8" r="1.5" fill="currentColor"/>
					</svg>
				</button>
			</div>
			
			<div class="toolbar-divider"></div>
			
			<!-- Recalc button -->
			<button 
				class="toolbar-btn recalc-btn"
				onclick={handleRecluster}
				disabled={isComputing || isAnimating || drawings.length === 0}
				data-tooltip="Recalculate"
				aria-label="Recalculate clustering"
				data-testid="recluster-btn"
			>
				{#if isComputing || isAnimating}
					<svg width="18" height="18" viewBox="0 0 18 18" fill="none" class="spinning">
						<path d="M9 2v3M9 13v3M2 9h3M13 9h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
				{:else}
					<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path d="M1.90321 7.29677C1.90321 10.341 4.11041 12.4147 6.58893 12.8439C6.87255 12.893 7.06266 13.1627 7.01355 13.4464C6.96444 13.73 6.69471 13.9201 6.41109 13.871C3.49942 13.3668 0.86084 10.9127 0.86084 7.29677C0.860839 5.76009 1.55996 4.55245 2.37639 3.63377C2.96124 2.97568 3.63034 2.44135 4.16846 2.03202L2.53205 2.03202C2.25591 2.03202 2.03205 1.80816 2.03205 1.53202C2.03205 1.25588 2.25591 1.03202 2.53205 1.03202L5.53205 1.03202C5.80819 1.03202 6.03205 1.25588 6.03205 1.53202L6.03205 4.53202C6.03205 4.80816 5.80819 5.03202 5.53205 5.03202C5.25591 5.03202 5.03205 4.80816 5.03205 4.53202L5.03205 2.68645L5.03054 2.68759L5.03045 2.68766L5.03044 2.68767L5.03043 2.68767C4.45896 3.11868 3.76059 3.64538 3.15554 4.3262C2.44102 5.13021 1.90321 6.10154 1.90321 7.29677ZM13.0109 7.70321C13.0109 4.69115 10.8505 2.6296 8.40384 2.17029C8.12093 2.11718 7.93465 1.84479 7.98776 1.56188C8.04087 1.27898 8.31326 1.0927 8.59616 1.14581C11.4704 1.68541 14.0532 4.12605 14.0532 7.70321C14.0532 9.23988 13.3541 10.4475 12.5377 11.3662C11.9528 12.0243 11.2837 12.5586 10.7456 12.968L12.3821 12.968C12.6582 12.968 12.8821 13.1918 12.8821 13.468C12.8821 13.7441 12.6582 13.968 12.3821 13.968L9.38205 13.968C9.10591 13.968 8.88205 13.7441 8.88205 13.468L8.88205 10.468C8.88205 10.1918 9.10591 9.96796 9.38205 9.96796C9.65819 9.96796 9.88205 10.1918 9.88205 10.468L9.88205 12.3135L9.88362 12.3123C10.4551 11.8813 11.1535 11.3546 11.7585 10.6738C12.4731 9.86976 13.0109 8.89844 13.0109 7.70321Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/>
					</svg>
				{/if}
			</button>
			
			<!-- Close button -->
			<button 
				class="toolbar-btn"
				onclick={() => (showTunePanel = false)}
				aria-label="Close clustering panel"
				data-tooltip="Close"
				data-testid="tune-close-btn"
			>
				<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
					<path d="M13 5L5 13M5 5L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>
		</div>

		<!-- Recent mode buttons -->
		<div class="toolbar-group recent-buttons" class:active={recentMode} data-testid="recent-panel">
			<button 
				class="toolbar-btn highlight"
				onclick={() => {}}
				aria-label="Recent drawings"
				title="Recent"
				data-testid="recent-indicator"
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/>
					<path d="M10 6v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</button>

			<button 
				class="toolbar-btn"
				onclick={exitRecentMode}
				aria-label="Exit browse mode"
				title="Exit"
				data-testid="recent-exit-btn"
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
	</div>

	<!-- Recent mode navigation arrows -->
	<button 
		class="nav-arrow nav-arrow-left"
		class:visible={recentMode && !showCreate && canGoOlder}
		onclick={goOlder}
		aria-label="View older drawing"
		data-testid="nav-older"
	>
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
			<path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
	</button>

	<button 
		class="nav-arrow nav-arrow-right"
		class:visible={recentMode && !showCreate && canGoNewer}
		onclick={goNewer}
		aria-label="View newer drawing"
		data-testid="nav-newer"
	>
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
			<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
	</button>

	<div class="stats-bar" class:fade-in={introAnimationDone} class:recent-info={recentMode} data-testid="stats-bar" data-drawing-count={drawings.length} data-recent-mode={recentMode}>
		{#if plusOneCount > 0}
			<span class="plus-one" data-testid="plus-one">+{plusOneCount}</span>
		{/if}
		{#if recentMode && highlightedDrawing}
			<span class="drawing-title" data-testid="recent-drawing-name">{highlightedDrawing.name}</span>
			<span class="stat-dot"></span>
			<span class="stat" data-testid="recent-drawing-creator">by {highlightedDrawing.creator}</span>
			<span class="stat-dot"></span>
			<span class="stat" data-testid="recent-drawing-time">{formatRelativeTime(highlightedDrawing.created)}</span>
			<span class="stat-dot"></span>
			<span class="stat counter" data-testid="recent-counter">{sortedDrawings.length - recentIndex} / {sortedDrawings.length}</span>
		{:else}
			<span class="stat" data-testid="stat-drawings">{drawings.length} drawing{drawings.length !== 1 ? 's' : ''}</span>
			<span class="stat-dot"></span>
			<span class="stat" data-testid="stat-users">{uniqueUserCount} user{uniqueUserCount !== 1 ? 's' : ''}</span>
			{#if onlineCount !== null}
				<span class="stat-dot"></span>
				<span class="stat" data-testid="stat-online">{onlineCount} online now</span>
			{/if}
		{/if}
	</div>

</div>

{#if showUsernameModal}
	<div class="modal-overlay" onclick={() => username && (showUsernameModal = false)} data-testid="username-modal-overlay" role="dialog" aria-label="Set username">
		<div class="modal" onclick={(e) => e.stopPropagation()} data-testid="username-modal">
			<h2>Welcome to PixelSpace</h2>
			<p>Enter a username to get started</p>
			<input
				type="text"
				placeholder="Your username"
				bind:value={usernameInput}
				onkeydown={handleUsernameKeydown}
				maxlength={20}
				aria-label="Username"
				data-testid="username-input"
			/>
			<button class="btn-primary" onclick={handleSetUsername} disabled={!usernameInput.trim()} data-testid="username-submit-btn">
				Enter the Space
			</button>
		</div>
	</div>
{/if}

<style>
	.page {
		position: relative;
		width: 100vw;
		height: 100vh;
		height: 100dvh; /* Dynamic viewport height for mobile */
		overflow: hidden;
		background: #fff;
	}

	/* Hidden state for elements when in create mode */
	.hidden {
		opacity: 0 !important;
		pointer-events: none !important;
	}

	/* Unified toolbar at bottom center */
	.toolbar {
		position: fixed;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: stretch;
		background: #000;
		border: 1px solid #333;
		padding: 0.125rem;
		z-index: 200;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}

	.toolbar.fade-in {
		opacity: 1;
		pointer-events: auto;
	}

	.toolbar.fade-in.hidden {
		opacity: 0;
		pointer-events: none;
	}

	/* Button groups - animate width via max-width */
	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		overflow: hidden;
		transition: max-width 0.25s ease, opacity 0.15s ease, max-height 0.25s ease;
	}

	.toolbar-group.main-buttons {
		max-width: 0;
		opacity: 0;
		pointer-events: none;
	}

	.toolbar-group.main-buttons.active {
		max-width: 200px;
		opacity: 1;
		pointer-events: auto;
	}

	.toolbar-group.recent-buttons {
		max-width: 0;
		opacity: 0;
		pointer-events: none;
	}

	.toolbar-group.recent-buttons.active {
		max-width: 100px;
		opacity: 1;
		pointer-events: auto;
	}

	.toolbar-group.tune-buttons {
		max-width: 0;
		opacity: 0;
		pointer-events: none;
	}

	.toolbar-group.tune-buttons.active {
		max-width: 500px;
		opacity: 1;
		pointer-events: auto;
	}

	/* Compact tooltips for tune panel buttons */
	.toolbar-group.tune-buttons [data-tooltip] {
		position: relative;
	}
	.toolbar-group.tune-buttons [data-tooltip]::after {
		content: attr(data-tooltip);
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		padding: 3px 6px;
		font-size: 10px;
		line-height: 1.2;
		white-space: nowrap;
		background: #222;
		color: #fff;
		border-radius: 4px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
		z-index: 1000;
	}
	.toolbar-group.tune-buttons [data-tooltip]:hover::after,
	.toolbar-group.tune-buttons [data-tooltip]:focus-visible::after {
		opacity: 1;
	}

	/* Create panel - column layout with canvas */
	.toolbar-group.create-panel {
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		max-width: 0;
		max-height: 0;
		opacity: 0;
		pointer-events: none;
		padding: 0;
	}

	.toolbar-group.create-panel.active {
		max-width: min(240px, calc(100vw - 1rem));
		max-height: 360px;
		opacity: 1;
		pointer-events: auto;
		padding: 0.25rem;
	}

	.toolbar-divider {
		width: 1px;
		height: 24px;
		background: #333;
		margin: 0 0.25rem;
	}

	/* Toggle buttons for C/S/T */
	.toggle-group {
		display: flex;
		gap: 0.125rem;
	}

	.toggle-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid #333;
		color: #666;
		font-weight: 600;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.toggle-btn:hover {
		border-color: #666;
		color: #999;
	}

	.toggle-btn.active {
		background: #fff;
		border-color: #fff;
		color: #000;
	}

	/* Radial dials */
	.dial-group {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}

	.radial-dial {
		width: 32px;
		height: 32px;
		position: relative;
		cursor: ns-resize;
		touch-action: none;
	}

	.dial-knob {
		width: 28px;
		height: 28px;
		border: 2px solid #444;
		border-radius: 50%;
		position: absolute;
		top: 2px;
		left: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s ease;
	}

	.radial-dial:hover .dial-knob,
	.radial-dial.dragging .dial-knob {
		border-color: #fff;
	}

	.dial-indicator {
		width: 2px;
		height: 8px;
		background: #fff;
		border-radius: 1px;
		position: absolute;
		top: 3px;
	}

	.dial-label {
		position: absolute;
		bottom: -12px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.55rem;
		color: #666;
		font-weight: 500;
	}

	/* Mode toggle buttons */
	.mode-toggle-group {
		display: flex;
		gap: 0.125rem;
	}

	.mode-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid #333;
		color: #666;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mode-btn:hover:not(:disabled) {
		border-color: #666;
		color: #999;
	}

	.mode-btn.active {
		background: #fff;
		border-color: #fff;
		color: #000;
	}

	.mode-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Recalc button */
	.recalc-btn {
		min-width: 32px;
	}

	.recalc-btn svg.spinning {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem;
		background: transparent;
		border: none;
		color: #fff;
		cursor: pointer;
		transition: background 0.15s ease;
		min-width: 36px;
		min-height: 36px;
		flex-shrink: 0;
	}

	.toolbar-btn:hover {
		background: #222;
	}

	.toolbar-btn.active {
		background: #fff;
		color: #000;
	}

	.toolbar-btn.highlight {
		background: #fff;
		color: #000;
	}

	.toolbar-btn.highlight:hover {
		background: #ccc;
	}

	.toolbar-btn.primary {
		background: #fff;
		color: #000;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		font-size: 0.75rem;
	}

	.toolbar-btn.primary:hover {
		background: #ccc;
	}

	.toolbar-btn.primary span {
		display: none;
	}

	.toolbar-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Desktop/mobile visibility toggles */
	.desktop-only {
		display: flex;
	}
	.mobile-only {
		display: none;
	}

	/* Spinning animation for mobile shuffle button loading state */
	.toolbar-btn svg.spinning {
		animation: spin 1s linear infinite;
	}

	@media (max-width: 768px) {
		.desktop-only {
			display: none !important;
		}
		.mobile-only {
			display: flex !important;
		}

		/* Hide tune panel entirely on mobile */
		.toolbar-group.tune-buttons {
			display: none !important;
		}
		.toolbar {
			bottom: 0.375rem;
			left: 50%;
			transform: translateX(-50%);
			width: fit-content;
			min-width: 0;
			max-width: calc(100vw - 1.5rem);
			padding-bottom: calc(0.25rem + env(safe-area-inset-bottom, 0));
			transition: min-width 0.3s ease, bottom 0.25s ease, padding 0.25s ease;
		}

		.toolbar.create-mode {
			bottom: 0.75rem;
			min-width: calc(100vw - 1.5rem);
			padding: 0.25rem;
			padding-bottom: calc(0.25rem + env(safe-area-inset-bottom, 0));
			justify-content: center;
		}

		.toolbar-group {
			gap: 0.375rem;
		}
		
		/* Mobile create panel - full width, ~half viewport height */
		.toolbar-group.create-panel {
			gap: 0.5rem;
			width: 100%;
		}
		
		.toolbar-group.create-panel.active {
			max-width: 100%;
			max-height: none;
			padding: 0.25rem;
			gap: 0.375rem;
		}

		.toolbar-btn {
			padding: 0.625rem;
		}

		.toolbar-btn.primary {
			padding: 0.625rem 1rem;
			font-size: 0.8rem;
		}

		.toolbar-btn.primary span {
			display: none;
		}

		/* Mobile tune toolbar - keep compact to fit screen */
		.toolbar-group.tune-buttons.active {
			max-width: calc(100vw - 1.5rem);
		}

		.toggle-group {
			gap: 1px;
		}

		.toggle-btn {
			width: 30px;
			height: 30px;
			font-size: 0.75rem;
		}

		.dial-group {
			gap: 0.25rem;
		}

		.radial-dial {
			width: 30px;
			height: 30px;
		}

		.dial-knob {
			width: 26px;
			height: 26px;
		}

		.dial-indicator {
			height: 7px;
		}

		.dial-label {
			font-size: 0.5rem;
			bottom: -11px;
		}

		.mode-toggle-group {
			gap: 1px;
		}

		.mode-btn {
			width: 30px;
			height: 30px;
		}

		.toolbar-divider {
			height: 24px;
			margin: 0 0.125rem;
		}

		.toolbar.tune-mode .toolbar-btn {
			padding: 0.375rem;
			min-width: 30px;
			min-height: 30px;
		}
	}

	/* Navigation arrows for recent mode */
	.nav-arrow {
		position: fixed;
		top: 50%;
		transform: translateY(-50%);
		width: 36px;
		height: 36px;
		background: #000;
		border: 1px solid #333;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 200;
		transition: opacity 0.2s ease, border-color 0.15s ease, background 0.15s ease;
		color: #fff;
		opacity: 0;
		pointer-events: none;
	}

	.nav-arrow.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.nav-arrow:hover:not(:disabled) {
		background: #111;
		border-color: #fff;
	}

	.nav-arrow:active:not(:disabled) {
		background: #222;
	}


	.nav-arrow-left {
		left: 0.5rem;
	}

	.nav-arrow-right {
		right: 0.5rem;
	}

	@media (max-width: 768px) {
		.nav-arrow {
			width: 32px;
			height: 32px;
		}

		.nav-arrow-left {
			left: 0.375rem;
		}

		.nav-arrow-right {
			right: 0.375rem;
		}
	}

	.stats-bar {
		position: fixed;
		top: 0.5rem;
		left: 0;
		right: 0;
		margin-inline: auto;
		width: max-content;
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.5rem;
		color: #fff;
		font-size: 0.7rem;
		z-index: 100;
		opacity: 0;
		background: #000;
		padding: 0.25rem 0.5rem;
		border: 1px solid #333;
		overflow: hidden;
		white-space: nowrap;
		transition: max-width 0.3s ease, opacity 0.2s ease, padding 0.2s ease;
	}

	.stats-bar.fade-in {
		animation: fadeInDown 0.4s ease-out forwards;
		animation-delay: 0.1s;
		max-width: min(90vw, 320px);
	}

	.stats-bar.recent-info {
		padding: 0.375rem 0.625rem;
		background: #000;
		border: 1px solid #444;
		max-width: min(90vw, 520px);
	}

	.stat {
		font-weight: 500;
		flex-shrink: 0;
	}

	.drawing-title {
		font-weight: 600;
		color: #fff;
		/* On larger screens, only truncate when name would make bar absurdly long */
		max-width: 280px;
		min-width: 0;
		flex-shrink: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.stat.counter {
		font-variant-numeric: tabular-nums;
		color: #fff;
	}

	.stat-dot {
		width: 3px;
		height: 3px;
		background: #fff;
		flex-shrink: 0;
	}

	.plus-one {
		font-size: 0.65rem;
		font-weight: 600;
		color: #4ade80;
		animation: plusOnePop 0.25s ease-out;
		margin-right: 0.25rem;
		flex-shrink: 0;
	}

	@keyframes plusOnePop {
		from {
			opacity: 0;
			transform: scale(0.8) translateY(2px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	@keyframes fadeInDown {
		from {
			opacity: 0;
			max-width: 0;
			transform: translateY(-5px);
		}
		to {
			opacity: 1;
			max-width: min(90vw, 320px);
			transform: translateY(0);
		}
	}

	@media (min-width: 769px) {
		/* Desktop: show full name unless it would make the bar ridiculously long */
		.stats-bar.recent-info .drawing-title {
			max-width: 360px;
		}
	}

	@media (max-width: 768px) {
		.stats-bar {
			font-size: 0.65rem;
			padding: 0.1875rem 0.375rem;
			gap: 0.375rem;
			max-width: calc(100% - 1rem);
		}

		.stats-bar.recent-info {
			padding: 0.25rem 0.5rem;
			max-width: calc(100% - 0.75rem);
			white-space: nowrap;
		}

		.stats-bar.recent-info .drawing-title {
			max-width: 140px;
			flex-shrink: 1;
			min-width: 0;
		}

		.drawing-title {
			max-width: 100px;
		}

		.stat-dot {
			width: 2px;
			height: 2px;
		}
	}

	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
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
	}

	.progress-fill.indeterminate {
		width: 40%;
		animation: indeterminate 1.2s ease-in-out infinite;
	}

	@keyframes indeterminate {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(350%);
		}
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: #000;
		border: 1px solid #333;
		padding: 1.25rem;
		max-width: 320px;
		width: 90%;
		text-align: center;
		animation: modalIn 0.15s ease-out;
	}

	@keyframes modalIn {
		from {
			opacity: 0;
			transform: scale(0.98) translateY(-5px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.modal h2 {
		margin: 0 0 0.25rem 0;
		color: #fff;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.modal p {
		margin: 0 0 0.75rem 0;
		color: #fff;
		font-size: 0.7rem;
	}

	.modal input {
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: #000;
		border: 1px solid #333;
		color: #fff;
		font-size: 0.75rem;
		margin-bottom: 0.625rem;
		transition: border-color 0.15s ease;
	}

	.modal input:focus {
		outline: none;
		border-color: #fff;
	}

	.modal input::placeholder {
		color: #fff;
		opacity: 0.5;
	}

	.btn-primary {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: #fff;
		border: none;
		color: #000;
		font-weight: 600;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-primary:hover:not(:disabled) {
		background: #ccc;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Top area: palette left, grid right (same layout on all sizes) */
	.create-top-area {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 0.25rem;
		width: 100%;
	}

	/* Palette column wrapper - always on the left */
	.create-palette-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
		width: auto;
		justify-content: center;
		order: 0;
		align-self: stretch;
	}

	/* Create panel bottom row with name input and buttons */
	.create-bottom-row {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		width: 100%;
	}

	.create-name-input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.375rem;
		background: #111;
		border: 1px solid #333;
		color: #fff;
		font-size: 0.7rem;
		transition: border-color 0.15s ease;
	}

	.create-name-input:focus {
		outline: none;
		border-color: #fff;
	}

	.create-name-input::placeholder {
		color: #fff;
		opacity: 0.6;
	}

	.create-name-input.has-error {
		border-color: #dc2626;
	}

	.create-grid-wrapper {
		padding: 1px;
		background: #333;
		order: 1;
		flex: 1 1 0;
		min-width: 0;
		width: auto;
		height: auto;
		aspect-ratio: 1;
	}

	.create-grid {
		display: grid;
		grid-template-columns: repeat(16, 1fr);
		gap: 1px;
		background: #333;
		width: 100%;
		height: 100%;
		touch-action: none;
		user-select: none;
		cursor: crosshair;
	}

	.create-pixel {
		aspect-ratio: 1;
		width: 100%;
		pointer-events: none;
	}

	.create-palette {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
		gap: 0;
	}

	.create-color-swatch {
		width: 24px;
		flex: 1;
		height: auto;
		border: 1px solid #333;
		cursor: pointer;
		transition: all 0.15s ease;
		padding: 0;
		flex-shrink: 0;
	}

	.create-color-swatch:hover {
		border-color: #666;
	}

	.create-color-swatch.active {
		border-color: #fff;
		outline: 2px solid #fff;
		outline-offset: 1px;
		z-index: 1;
	}

	
	/* Create panel action buttons - smaller on mobile */
	.create-bottom-row .toolbar-btn {
		padding: 0.375rem;
		min-width: 32px;
		min-height: 32px;
	}
	
	.create-bottom-row .toolbar-btn svg {
		width: 16px;
		height: 16px;
	}

	.create-error {
		color: #ff6b6b;
		font-size: 0.65rem;
		margin: 0;
		padding: 0.25rem 0.375rem;
		background: #1a0000;
		border: 1px solid #330000;
	}

	/* Mobile create panel overrides - larger touch targets */
	@media (max-width: 768px) {
		.create-color-swatch {
			width: 30px;
		}

		.create-name-input {
			padding: 0.5rem 0.625rem;
			font-size: 0.875rem;
			min-height: 44px;
		}

		.create-bottom-row .toolbar-btn {
			padding: 0.5rem;
			min-width: 44px;
			min-height: 44px;
		}

		.create-bottom-row .toolbar-btn svg {
			width: 20px;
			height: 20px;
		}

		.create-bottom-row .toolbar-btn.primary {
			padding: 0.5rem 1rem;
		}

		.create-bottom-row {
			gap: 0.375rem;
		}
	}

	@media (min-width: 768px) {
		.toolbar-group.create-panel.active {
			max-width: 280px;
			gap: 0.5rem;
			padding: 0.375rem;
		}

		.create-name-input {
			padding: 0.375rem 0.5rem;
			font-size: 0.7rem;
		}

		.create-color-swatch {
			width: 22px;
		}
	}
</style>


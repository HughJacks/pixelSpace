<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import GalleryCanvas from '$lib/components/GalleryCanvas.svelte';
	import { getAllDrawings, subscribeToDrawings } from '$lib/supabase';
	import type { Drawing } from '$lib/types';
	import { PALETTE, GRID_SIZE, COLOR_WHITE, colorToHex } from '$lib/palette';

	let username = $state('');
	let showUsernameModal = $state(false);
	let usernameInput = $state('');
	let drawings: Drawing[] = $state([]);
	let isLoading = $state(true);

	// Sidebar state
	let sidebarOpen = $state(false);
	let centerOnDrawingFn: ((drawingId: string) => void) | null = $state(null);

	// Recent drawings sorted by creation date (newest first)
	let recentDrawings = $derived.by(() => {
		return [...drawings].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 50);
	});

	// Count unique users
	let uniqueUserCount = $derived(new Set(drawings.map(d => d.creator)).size);

	// Generate SVG data URL for a drawing thumbnail
	function getDrawingSvgUrl(pixels: number[]): string {
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
					let hexColor: string;
					if (pixelValue > 7) {
						hexColor = pixelValue <= 127 ? '#000000' : '#ffffff';
					} else {
						const color = PALETTE[pixelValue] ?? PALETTE[COLOR_WHITE];
						hexColor = colorToHex(color);
					}
					rects += `<rect x="${x}" y="${y}" width="${width}" height="1" fill="${hexColor}"/>`;
				}
				x += width;
			}
		}
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_SIZE} ${GRID_SIZE}" shape-rendering="crispEdges"><rect width="${GRID_SIZE}" height="${GRID_SIZE}" fill="#fff"/>${rects}</svg>`;
		return 'data:image/svg+xml;base64,' + btoa(svg);
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

	function handleDrawingClick(drawingId: string) {
		if (centerOnDrawingFn) {
			centerOnDrawingFn(drawingId);
			// Close sidebar on mobile after clicking
			if (window.innerWidth < 768) {
				sidebarOpen = false;
			}
		}
	}

	function handleCenterOnDrawing(fn: (drawingId: string) => void) {
		centerOnDrawingFn = fn;
	}

	onMount(async () => {
		// Check for stored username (but don't require it)
		const storedUsername = localStorage.getItem('pixelspace_username');
		if (storedUsername) {
			username = storedUsername;
		}

		// Fetch drawings
		try {
			drawings = await getAllDrawings();
		} catch (error) {
			console.error('Failed to load drawings:', error);
		}
		isLoading = false;

		// Subscribe to real-time updates
		const unsubscribe = subscribeToDrawings((newDrawing) => {
			drawings = [newDrawing, ...drawings];
		});

		return () => {
			unsubscribe();
		};
	});

	function handleSetUsername() {
		if (usernameInput.trim()) {
			username = usernameInput.trim();
			localStorage.setItem('pixelspace_username', username);
			showUsernameModal = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSetUsername();
		}
	}

	function handleCreateNew() {
		goto('/create');
	}

	function handleChangeUsername() {
		usernameInput = username;
		showUsernameModal = true;
	}
</script>

<div class="page">
	{#if isLoading}
		<div class="loading">
			<p class="loading-title">Loading drawings</p>
			<div class="progress-bar">
				<div class="progress-fill indeterminate"></div>
			</div>
		</div>
	{:else}
		<GalleryCanvas {drawings} onCenterOnDrawing={handleCenterOnDrawing} />
	{/if}

	<!-- Sidebar toggle button -->
	<button
		class="sidebar-toggle"
		class:open={sidebarOpen}
		class:fade-in={!isLoading}
		onclick={() => (sidebarOpen = !sidebarOpen)}
		aria-label={sidebarOpen ? 'Close sidebar' : 'Open recent drawings'}
	>
		<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
			{#if sidebarOpen}
				<path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
			{:else}
				<path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
			{/if}
		</svg>
	</button>

	<!-- Collapsible sidebar -->
	<aside class="sidebar" class:open={sidebarOpen}>
		<div class="sidebar-header">
			<h2>Recent Drawings</h2>
			<span class="count">{recentDrawings.length}</span>
		</div>
		<div class="sidebar-content">
			{#each recentDrawings as drawing (drawing.id)}
				<button class="drawing-item" onclick={() => handleDrawingClick(drawing.id)}>
					<img
						src={getDrawingSvgUrl(drawing.pixels)}
						alt={drawing.name}
						class="drawing-thumbnail"
					/>
					<div class="drawing-info">
						<span class="drawing-name">{drawing.name}</span>
						<span class="drawing-meta">
							<span class="creator">by {drawing.creator}</span>
							<span class="time">{formatRelativeTime(drawing.created)}</span>
						</span>
					</div>
				</button>
			{/each}
			{#if recentDrawings.length === 0}
				<div class="no-drawings">
					<p>No drawings yet</p>
				</div>
			{/if}
		</div>
	</aside>

	<!-- Sidebar backdrop for mobile -->
	{#if sidebarOpen}
		<button class="sidebar-backdrop" onclick={() => (sidebarOpen = false)} aria-label="Close sidebar"></button>
	{/if}

	<div class="overlay-controls" class:fade-in={!isLoading}>
		<button class="btn-create" onclick={handleCreateNew}>
			<span>+</span> Create
		</button>
	</div>

	<div class="drawing-count" class:fade-in={!isLoading}>
		<span class="count-drawings">{drawings.length} drawing{drawings.length !== 1 ? 's' : ''}</span>
		<span class="count-separator"> from </span>
		<span class="count-users">{uniqueUserCount} user{uniqueUserCount !== 1 ? 's' : ''}</span>
	</div>

	<div class="top-right-controls" class:fade-in={!isLoading}>
		{#if username}
			<button class="user-badge" onclick={handleChangeUsername}>
				<span class="avatar">{username[0].toUpperCase()}</span>
			</button>
		{/if}
	</div>
</div>

{#if showUsernameModal}
	<div class="modal-overlay" onclick={() => username && (showUsernameModal = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>Welcome to PixelSpace</h2>
			<p>Enter a username to get started</p>
			<input
				type="text"
				placeholder="Your username"
				bind:value={usernameInput}
				onkeydown={handleKeydown}
				maxlength={20}
			/>
			<button class="btn-primary" onclick={handleSetUsername} disabled={!usernameInput.trim()}>
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

	/* Sidebar toggle button */
	.sidebar-toggle {
		position: fixed;
		top: 1rem;
		left: 1rem;
		width: 42px;
		height: 42px;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #e0e0e0;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 200;
		transition: all 0.2s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		color: #333;
		opacity: 0;
	}

	.sidebar-toggle.fade-in {
		animation: fadeInUp 0.4s ease-out forwards;
		animation-delay: 0.1s;
	}

	.sidebar-toggle:hover {
		background: #f5f5f5;
		border-color: #ccc;
		transform: scale(1.05);
	}

	.sidebar-toggle.open {
		background: #000;
		border-color: #000;
		color: #fff;
	}

	/* Sidebar */
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		width: 320px;
		height: 100vh;
		background: rgba(255, 255, 255, 0.98);
		backdrop-filter: blur(20px);
		border-right: 1px solid #e0e0e0;
		transform: translateX(-100%);
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		z-index: 150;
		display: flex;
		flex-direction: column;
		box-shadow: 4px 0 24px rgba(0, 0, 0, 0.1);
	}

	.sidebar.open {
		transform: translateX(0);
	}

	.sidebar-header {
		padding: 1.25rem 1.25rem 1rem;
		padding-top: calc(1.25rem + 48px);
		border-bottom: 1px solid #eee;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.sidebar-header h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
		color: #000;
		letter-spacing: -0.02em;
	}

	.sidebar-header .count {
		background: #f0f0f0;
		color: #666;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.2rem 0.5rem;
		border-radius: 20px;
	}

	.sidebar-content {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
	}

	.sidebar-content::-webkit-scrollbar {
		width: 6px;
	}

	.sidebar-content::-webkit-scrollbar-track {
		background: transparent;
	}

	.sidebar-content::-webkit-scrollbar-thumb {
		background: #ddd;
		border-radius: 3px;
	}

	.sidebar-content::-webkit-scrollbar-thumb:hover {
		background: #ccc;
	}

	/* Drawing item in sidebar */
	.drawing-item {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		width: 100%;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: left;
	}

	.drawing-item:hover {
		background: #f5f5f5;
	}

	.drawing-item:active {
		background: #eee;
		transform: scale(0.98);
	}

	.drawing-thumbnail {
		width: 48px;
		height: 48px;
		border-radius: 6px;
		background: #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
		image-rendering: pixelated;
		image-rendering: crisp-edges;
		flex-shrink: 0;
	}

	.drawing-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.drawing-name {
		font-weight: 600;
		font-size: 0.9rem;
		color: #000;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.drawing-meta {
		display: flex;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: #888;
	}

	.drawing-meta .creator {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100px;
	}

	.drawing-meta .time {
		white-space: nowrap;
		color: #aaa;
	}

	.no-drawings {
		padding: 2rem;
		text-align: center;
		color: #999;
	}

	/* Sidebar backdrop for mobile */
	.sidebar-backdrop {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 140;
		border: none;
		cursor: pointer;
	}

	@media (max-width: 768px) {
		.sidebar {
			width: 280px;
		}

		.sidebar-backdrop {
			display: block;
		}
	}

	.overlay-controls {
		position: fixed;
		bottom: 2rem;
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		z-index: 100;
		opacity: 0;
		pointer-events: none;
	}

	.overlay-controls .btn-create {
		pointer-events: auto;
	}

	.overlay-controls.fade-in {
		animation: fadeInUp 0.4s ease-out forwards;
		animation-delay: 0.2s;
	}

	.btn-create {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: #000;
		border: none;
		border-radius: 8px;
		color: #fff;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		min-height: 48px; /* Touch target */
	}

	.btn-create:hover {
		background: #333;
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
	}

	.btn-create span {
		font-size: 1.2rem;
		font-weight: 400;
	}

	@media (max-width: 768px) {
		.overlay-controls {
			bottom: 1.25rem;
		}

		.btn-create {
			padding: 0.875rem 1.75rem;
			font-size: 1.05rem;
			border-radius: 12px;
		}
	}

	.drawing-count {
		position: fixed;
		bottom: 2rem;
		left: 1.5rem;
		color: #999;
		font-size: 0.85rem;
		z-index: 100;
		opacity: 0;
	}

	.drawing-count.fade-in {
		animation: fadeInUp 0.4s ease-out forwards;
		animation-delay: 0.15s;
	}

	@media (max-width: 768px) {
		.drawing-count {
			bottom: 1.25rem;
			left: 1rem;
			font-size: 0.75rem;
			display: flex;
			flex-direction: column;
			line-height: 1.4;
		}

		.drawing-count .count-separator {
			display: none;
		}
	}

	.top-right-controls {
		position: fixed;
		top: 1rem;
		right: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		z-index: 100;
		opacity: 0;
	}

	.top-right-controls.fade-in {
		animation: fadeInUp 0.4s ease-out forwards;
		animation-delay: 0.1s;
	}

	.user-badge {
		display: flex;
		align-items: center;
		padding: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.user-badge:hover {
		transform: scale(1.1);
	}

	.avatar {
		width: 36px;
		height: 36px;
		background: #000;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.95rem;
		color: #fff;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #666;
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
		border-radius: 6px;
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
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 16px;
		padding: 2.5rem;
		max-width: 400px;
		width: 90%;
		text-align: center;
		animation: modalIn 0.2s ease-out;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
	}

	@keyframes modalIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.modal h2 {
		margin: 0 0 0.5rem 0;
		color: #000;
		font-size: 1.5rem;
	}

	.modal p {
		margin: 0 0 1.5rem 0;
		color: #666;
	}

	.modal input {
		width: 100%;
		padding: 0.875rem 1rem;
		background: #fff;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		color: #000;
		font-size: 1rem;
		margin-bottom: 1rem;
		transition: border-color 0.15s ease;
	}

	.modal input:focus {
		outline: none;
		border-color: #000;
	}

	.modal input::placeholder {
		color: #999;
	}

	.btn-primary {
		width: 100%;
		padding: 0.875rem 1.5rem;
		background: #000;
		border: none;
		border-radius: 8px;
		color: #fff;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-primary:hover:not(:disabled) {
		background: #333;
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Fade-in animation for controls */
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
</style>

<script lang="ts">
	import PixelEditor from './PixelEditor.svelte';
	import GalleryCanvas from './GalleryCanvas.svelte';
	import { createDrawing } from '$lib/supabase';
	import { type Drawing, DRAWING_NAME_MAX_LENGTH } from '$lib/types';

	interface Props {
		drawings: Drawing[];
		username: string;
		onSave: () => void;
		onCancel: () => void;
		onNeedUsername: () => void;
		// Shared view state
		viewScale?: number;
		viewOffsetX?: number;
		viewOffsetY?: number;
		onViewChange?: (scale: number, offsetX: number, offsetY: number) => void;
		// Shared positions (to avoid recomputing clustering)
		sharedPositions?: Map<string, { x: number; y: number }>;
	}

	let { 
		drawings, 
		username, 
		onSave, 
		onCancel, 
		onNeedUsername,
		viewScale,
		viewOffsetX,
		viewOffsetY,
		onViewChange,
		sharedPositions
	}: Props = $props();

	let drawingName = $state('');
	let isSaving = $state(false);
	let error = $state('');
	let currentPixels: number[] = $state([]);
	let isDrawing = $state(false);

	async function handleSaveClick() {
		if (!drawingName.trim()) {
			error = 'Please give your drawing a name';
			return;
		}

		if (!username) {
			onNeedUsername();
			return;
		}

		isSaving = true;
		error = '';

		try {
			const result = await createDrawing({
				name: drawingName.trim(),
				creator: username,
				pixels: currentPixels
			});

			if (result) {
				onSave();
			} else {
				error = 'Failed to save drawing. Please try again.';
			}
		} catch (err) {
			console.error('Save error:', err);
			error = 'Failed to save drawing. Please try again.';
		} finally {
			isSaving = false;
		}
	}
</script>

<div class="create-overlay" data-testid="create-overlay">
	<!-- Background canvas showing existing drawings -->
	<div class="canvas-background" class:active={isDrawing}>
		{#if drawings.length > 0}
			<GalleryCanvas 
				{drawings} 
				previewPixels={currentPixels}
				previewMode={true}
				{viewScale}
				{viewOffsetX}
				{viewOffsetY}
				{onViewChange}
				{sharedPositions}
			/>
		{/if}
	</div>

	<button class="btn-back" onclick={onCancel} aria-label="Back to gallery" data-testid="back-to-gallery">
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M19 12H5M12 19l-7-7 7-7" />
		</svg>
	</button>

	<main class:drawing={isDrawing}>
		<div class="editor-section">
			<div class="name-input-wrapper">
				<input
					type="text"
					placeholder="Name your creation..."
					bind:value={drawingName}
					maxlength={DRAWING_NAME_MAX_LENGTH}
					class:has-error={error && !drawingName.trim()}
					aria-label="Drawing name"
					data-testid="drawing-name-input"
				/>
			</div>

			<PixelEditor 
				bind:pixels={currentPixels} 
				onDrawStart={() => isDrawing = true}
				onDrawEnd={() => isDrawing = false}
			/>

			{#if error}
				<p class="error" role="alert" data-testid="create-error">{error}</p>
			{/if}
		</div>

		<div class="footer-row">
			{#if username}
				<div class="creator-badge" data-testid="creator-badge">
					<span class="avatar">{username[0].toUpperCase()}</span>
					<span class="username">{username}</span>
				</div>
			{/if}
			<button class="btn-save" onclick={handleSaveClick} aria-label="Save drawing" data-testid="save-drawing">Save Drawing</button>
		</div>
	</main>

	{#if isSaving}
		<div class="saving-overlay" role="status" data-testid="saving-overlay">
			<div class="saving-content">
				<div class="spinner"></div>
				<p>Saving your masterpiece...</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.create-overlay {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: 500;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		/* Prevent browser pinch-zoom on this page */
		touch-action: pan-x pan-y;
	}

	/* Background canvas layer - shows immediately at full opacity since view is shared */
	.canvas-background {
		position: absolute;
		inset: 0;
		z-index: 0;
		opacity: 1;
		transition: opacity 0.3s ease;
		pointer-events: auto;
	}

	.canvas-background.active {
		opacity: 1;
		pointer-events: auto;
	}

	main {
		animation: fadeInUp 0.2s ease-out;
	}

	main.drawing {
		background: rgba(255, 255, 255, 0.7);
		backdrop-filter: blur(1px);
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

	.btn-back {
		position: fixed;
		top: 0.75rem;
		left: 0.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: #000;
		border: 1px solid #333;
		color: #fff;
		cursor: pointer;
		transition: all 0.15s ease;
		z-index: 100;
		animation: fadeInUp 0.2s ease-out;
		animation-delay: 0.05s;
		animation-fill-mode: backwards;
	}

	.btn-back:hover {
		background: #111;
		border-color: #fff;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		gap: 0.5rem;
		min-height: 0;
		overflow: hidden;
		position: relative;
		z-index: 10;
		transition: background 0.3s ease;
	}

	@media (min-width: 768px) {
		main {
			padding: 1rem;
			gap: 0.75rem;
		}
	}

	.editor-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		max-height: 100%;
		min-height: 0;
	}

	@media (min-width: 768px) {
		.editor-section {
			gap: 0.75rem;
		}
	}

	.name-input-wrapper {
		width: 100%;
		max-width: 450px;
		flex-shrink: 0;
	}

	.name-input-wrapper input {
		width: 100%;
		padding: 0.375rem 0.625rem;
		background: #000;
		border: 1px solid #333;
		color: #fff;
		font-size: 0.75rem;
		text-align: center;
		transition: all 0.15s ease;
	}

	@media (min-width: 768px) {
		.name-input-wrapper input {
			padding: 0.5rem 0.75rem;
			font-size: 0.8rem;
		}
	}

	.name-input-wrapper input:focus {
		outline: none;
		border-color: #fff;
	}

	.name-input-wrapper input::placeholder {
		color: #fff;
		opacity: 0.5;
	}

	.name-input-wrapper input.has-error {
		border-color: #dc2626;
	}

	.error {
		color: #ff6b6b;
		font-size: 0.7rem;
		margin: 0;
		padding: 0.25rem 0.5rem;
		background: #1a0000;
		border: 1px solid #330000;
	}

	.footer-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.creator-badge {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem 0.25rem 0.25rem;
		background: #000;
		border: 1px solid #333;
	}

	.avatar {
		width: 20px;
		height: 20px;
		background: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 0.65rem;
		color: #000;
	}

	.username {
		font-weight: 500;
		color: #fff;
		font-size: 0.7rem;
	}

	.btn-save {
		padding: 0.375rem 0.75rem;
		background: #fff;
		border: none;
		color: #000;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-save:hover {
		background: #ccc;
	}

	.btn-save:active {
		background: #aaa;
	}

	.saving-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.95);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.saving-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 2px solid #333;
		border-top-color: #fff;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.saving-content p {
		color: #fff;
		margin: 0;
		font-size: 0.75rem;
	}
</style>

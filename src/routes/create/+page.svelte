<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import PixelEditor from '$lib/components/PixelEditor.svelte';
	import { createDrawing } from '$lib/supabase';

	let username = $state('');
	let drawingName = $state('');
	let isSaving = $state(false);
	let error = $state('');

	onMount(() => {
		const storedUsername = localStorage.getItem('pixelspace_username');
		if (storedUsername) {
			username = storedUsername;
		} else {
			goto('/');
		}
	});

	async function handleSave(savedPixels: number[]) {
		if (!drawingName.trim()) {
			error = 'Please give your drawing a name';
			return;
		}

		if (!username) {
			error = 'No username set';
			return;
		}

		isSaving = true;
		error = '';

		try {
			const result = await createDrawing({
				name: drawingName.trim(),
				creator: username,
				pixels: savedPixels
			});

			if (result) {
				goto('/');
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

	function handleBack() {
		goto('/');
	}
</script>

<div class="page">
	<button class="btn-back" onclick={handleBack} aria-label="Back to gallery">
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M19 12H5M12 19l-7-7 7-7" />
		</svg>
	</button>

	<main>
		<div class="editor-section">
			<div class="name-input-wrapper">
				<input
					type="text"
					placeholder="Name your creation..."
					bind:value={drawingName}
					maxlength={50}
					class:has-error={error && !drawingName.trim()}
				/>
			</div>

			<PixelEditor onSave={handleSave} />

			{#if error}
				<p class="error">{error}</p>
			{/if}
		</div>

		<div class="creator-badge">
			<span class="avatar">{username[0]?.toUpperCase() ?? '?'}</span>
			<span class="username">{username}</span>
		</div>
	</main>

	{#if isSaving}
		<div class="saving-overlay">
			<div class="saving-content">
				<div class="spinner"></div>
				<p>Saving your masterpiece...</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.page {
		min-height: 100vh;
		min-height: 100dvh;
		background: #f5f5f5;
		display: flex;
		flex-direction: column;
		position: relative;
		/* Prevent browser pinch-zoom on this page */
		touch-action: pan-x pan-y;
	}

	.btn-back {
		position: fixed;
		top: 1.25rem;
		left: 1.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 12px;
		color: #666;
		cursor: pointer;
		transition: all 0.15s ease;
		z-index: 100;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.btn-back:hover {
		background: #fff;
		color: #000;
		border-color: #ccc;
		transform: translateX(-2px);
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		gap: 1.5rem;
	}

	.editor-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}

	.name-input-wrapper {
		width: 100%;
		max-width: 500px;
	}

	.name-input-wrapper input {
		width: 100%;
		padding: 1rem 1.25rem;
		background: #fff;
		border: 2px solid #e0e0e0;
		border-radius: 12px;
		color: #000;
		font-size: 1.1rem;
		text-align: center;
		transition: all 0.15s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}

	.name-input-wrapper input:focus {
		outline: none;
		border-color: #000;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
	}

	.name-input-wrapper input::placeholder {
		color: #999;
	}

	.name-input-wrapper input.has-error {
		border-color: #dc2626;
	}

	.error {
		color: #dc2626;
		font-size: 0.9rem;
		margin: 0;
		padding: 0.5rem 1rem;
		background: #fef2f2;
		border-radius: 8px;
	}

	.creator-badge {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 1rem 0.5rem 0.5rem;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 100px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}

	.avatar {
		width: 32px;
		height: 32px;
		background: #000;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.85rem;
		color: #fff;
	}

	.username {
		font-weight: 500;
		color: #333;
		font-size: 0.9rem;
	}

	.saving-overlay {
		position: fixed;
		inset: 0;
		background: rgba(245, 245, 245, 0.95);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.saving-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.spinner {
		width: 48px;
		height: 48px;
		border: 3px solid #e0e0e0;
		border-top-color: #000;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.saving-content p {
		color: #666;
		margin: 0;
		font-size: 1rem;
	}
</style>

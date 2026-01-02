<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import PixelEditor from '$lib/components/PixelEditor.svelte';
	import { createDrawing } from '$lib/supabase';

	let username = $state('');
	let usernameInput = $state('');
	let showUsernameModal = $state(false);
	let drawingName = $state('');
	let isSaving = $state(false);
	let error = $state('');
	let currentPixels: number[] = $state([]);

	onMount(() => {
		const storedUsername = localStorage.getItem('pixelspace_username');
		if (storedUsername) {
			username = storedUsername;
		} else {
			// Show username modal if not set
			showUsernameModal = true;
		}
	});

	function handleSetUsername() {
		if (usernameInput.trim()) {
			username = usernameInput.trim();
			localStorage.setItem('pixelspace_username', username);
			showUsernameModal = false;
		}
	}

	function handleUsernameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSetUsername();
		}
	}

	async function handleSaveClick() {
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
				pixels: currentPixels
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

			<PixelEditor bind:pixels={currentPixels} />

			{#if error}
				<p class="error">{error}</p>
			{/if}
		</div>

		<div class="footer-row">
			{#if username}
				<div class="creator-badge">
					<span class="avatar">{username[0].toUpperCase()}</span>
					<span class="username">{username}</span>
				</div>
			{/if}
			<button class="btn-save" onclick={handleSaveClick}>Save Drawing</button>
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

	{#if showUsernameModal}
		<div class="modal-overlay">
			<div class="modal">
				<h2>Before you create</h2>
				<p>Enter a username to sign your artwork</p>
				<input
					type="text"
					placeholder="Your username"
					bind:value={usernameInput}
					onkeydown={handleUsernameKeydown}
					maxlength={20}
				/>
				<div class="modal-buttons">
					<button class="btn-secondary" onclick={() => goto('/')}>
						Back to Gallery
					</button>
					<button class="btn-primary" onclick={handleSetUsername} disabled={!usernameInput.trim()}>
						Start Creating
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.page {
		height: 100vh;
		height: 100dvh;
		background: #f5f5f5;
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
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
		padding: 1rem;
		gap: 0.75rem;
		min-height: 0; /* Allow flex shrinking */
		overflow: hidden;
	}

	@media (min-width: 768px) {
		main {
			padding: 2rem;
			gap: 1.5rem;
		}
	}

	.editor-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		max-height: 100%;
		min-height: 0;
	}

	@media (min-width: 768px) {
		.editor-section {
			gap: 1.5rem;
		}
	}

	.name-input-wrapper {
		width: 100%;
		max-width: 500px;
		flex-shrink: 0;
	}

	.name-input-wrapper input {
		width: 100%;
		padding: 0.75rem 1rem;
		background: #fff;
		border: 2px solid #e0e0e0;
		border-radius: 10px;
		color: #000;
		font-size: 1rem;
		text-align: center;
		transition: all 0.15s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}

	@media (min-width: 768px) {
		.name-input-wrapper input {
			padding: 1rem 1.25rem;
			border-radius: 12px;
			font-size: 1.1rem;
		}
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

	.footer-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		flex-shrink: 0;
	}

	.creator-badge {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem 0.375rem 0.375rem;
		background: #fff;
		border: 1px solid #e0e0e0;
		border-radius: 100px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}

	.avatar {
		width: 28px;
		height: 28px;
		background: #000;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.8rem;
		color: #fff;
	}

	.username {
		font-weight: 500;
		color: #333;
		font-size: 0.85rem;
	}

	.btn-save {
		padding: 0.75rem 1.5rem;
		background: #000;
		border: none;
		border-radius: 10px;
		color: #fff;
		font-size: 0.95rem;
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

	.modal-buttons {
		display: flex;
		gap: 0.75rem;
	}

	.btn-secondary {
		flex: 1;
		padding: 0.875rem 1rem;
		background: #fff;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		color: #333;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-secondary:hover {
		background: #f5f5f5;
		border-color: #ccc;
	}

	.btn-primary {
		flex: 1;
		padding: 0.875rem 1rem;
		background: #000;
		border: none;
		border-radius: 8px;
		color: #fff;
		font-weight: 600;
		font-size: 0.95rem;
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
</style>

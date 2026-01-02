<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import GalleryCanvas from '$lib/components/GalleryCanvas.svelte';
	import { getAllDrawings, subscribeToDrawings } from '$lib/supabase';
	import type { Drawing } from '$lib/types';

	let username = $state('');
	let showUsernameModal = $state(false);
	let usernameInput = $state('');
	let drawings: Drawing[] = $state([]);
	let isLoading = $state(true);

	onMount(async () => {
		// Check for stored username
		const storedUsername = localStorage.getItem('pixelspace_username');
		if (storedUsername) {
			username = storedUsername;
		} else {
			showUsernameModal = true;
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
		<GalleryCanvas {drawings} />
	{/if}

	<div class="overlay-controls">
		<button class="btn-create" onclick={handleCreateNew}>
			<span>+</span> Create
		</button>
	</div>

	<div class="drawing-count">
		{drawings.length} drawing{drawings.length !== 1 ? 's' : ''}
	</div>

	{#if username}
		<button class="user-badge" onclick={handleChangeUsername}>
			<span class="avatar">{username[0].toUpperCase()}</span>
		</button>
	{/if}
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
		overflow: hidden;
		background: #fff;
	}

	.overlay-controls {
		position: fixed;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
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

	.drawing-count {
		position: fixed;
		bottom: 2rem;
		left: 1.5rem;
		color: #999;
		font-size: 0.85rem;
		z-index: 100;
	}

	.user-badge {
		position: fixed;
		top: 1rem;
		right: 1rem;
		display: flex;
		align-items: center;
		padding: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s ease;
		z-index: 100;
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
</style>

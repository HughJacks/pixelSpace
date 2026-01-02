<script lang="ts">
	import { goto } from '$app/navigation';

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
		<header>
			<div class="logo">
				<div class="logo-grid">
					{#each Array(16) as _, i}
						<div class="logo-pixel" style="animation-delay: {i * 50}ms"></div>
					{/each}
				</div>
			</div>
			<h1>PixelSpace</h1>
			<p class="tagline">A collaborative pixel art gallery</p>
		</header>

		<section class="card">
			<div class="card-icon">✨</div>
			<h2>Create</h2>
			<p>
				Draw 16×16 pixel art using 8 colors. Tap or drag to paint, 
				and right-click (or long-press) to erase. Give your creation 
				a name and share it with everyone.
			</p>
		</section>

		<section class="card">
			<div class="card-icon">🗺️</div>
			<h2>Explore</h2>
			<p>
				All drawings live in an infinite canvas. Similar drawings cluster 
				together using t-SNE, a machine learning algorithm that groups 
				art by visual similarity. Pan and zoom to explore!
			</p>
		</section>

		<section class="card">
			<div class="card-icon">🔍</div>
			<h2>Navigate</h2>
			<p>
				<strong>Desktop:</strong> Scroll to zoom, drag to pan.<br>
				<strong>Mobile:</strong> Pinch to zoom, drag with one finger to pan.<br>
				Use the sidebar to jump to recent drawings.
			</p>
		</section>

		<section class="card">
			<div class="card-icon">🌐</div>
			<h2>Real-time</h2>
			<p>
				New drawings appear instantly for everyone. Watch the gallery 
				grow and evolve as artists from around the world contribute 
				their creations.
			</p>
		</section>

		<div class="cta">
			<button class="btn-primary" onclick={handleBack}>
				Start Exploring
			</button>
		</div>

		<footer>
			<p>Made with pixels and love</p>
		</footer>
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		min-height: 100dvh;
		background: linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%);
		position: relative;
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
		max-width: 540px;
		margin: 0 auto;
		padding: 3rem 1.5rem 2rem;
	}

	header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.logo {
		display: flex;
		justify-content: center;
		margin-bottom: 1.25rem;
	}

	.logo-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 3px;
		padding: 8px;
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
	}

	.logo-pixel {
		width: 14px;
		height: 14px;
		background: #e0e0e0;
		border-radius: 2px;
		animation: pixelPop 2s ease-in-out infinite;
	}

	.logo-pixel:nth-child(1) { background: #000; }
	.logo-pixel:nth-child(2) { background: #0000FF; }
	.logo-pixel:nth-child(3) { background: #FF0000; }
	.logo-pixel:nth-child(4) { background: #00FF00; }
	.logo-pixel:nth-child(5) { background: #88AAFF; }
	.logo-pixel:nth-child(6) { background: #000; }
	.logo-pixel:nth-child(7) { background: #000; }
	.logo-pixel:nth-child(8) { background: #FF8888; }
	.logo-pixel:nth-child(9) { background: #FF0000; }
	.logo-pixel:nth-child(10) { background: #000; }
	.logo-pixel:nth-child(11) { background: #000; }
	.logo-pixel:nth-child(12) { background: #0000FF; }
	.logo-pixel:nth-child(13) { background: #00FF00; }
	.logo-pixel:nth-child(14) { background: #88FF88; }
	.logo-pixel:nth-child(15) { background: #FF8888; }
	.logo-pixel:nth-child(16) { background: #000; }

	@keyframes pixelPop {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.1); }
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: 2.25rem;
		font-weight: 800;
		color: #000;
		letter-spacing: -0.03em;
	}

	.tagline {
		margin: 0;
		font-size: 1.1rem;
		color: #666;
	}

	.card {
		background: #fff;
		border: 1px solid #e8e8e8;
		border-radius: 16px;
		padding: 1.5rem;
		margin-bottom: 1rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
	}

	.card-icon {
		font-size: 1.75rem;
		margin-bottom: 0.5rem;
	}

	.card h2 {
		margin: 0 0 0.5rem;
		font-size: 1.15rem;
		font-weight: 700;
		color: #000;
	}

	.card p {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.6;
		color: #555;
	}

	.card p strong {
		color: #333;
	}

	.cta {
		text-align: center;
		margin: 2rem 0;
	}

	.btn-primary {
		padding: 1rem 2.5rem;
		background: #000;
		border: none;
		border-radius: 12px;
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}

	.btn-primary:hover {
		background: #222;
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
	}

	.btn-primary:active {
		transform: translateY(0);
	}

	footer {
		text-align: center;
		padding: 1rem 0 2rem;
	}

	footer p {
		margin: 0;
		font-size: 0.85rem;
		color: #999;
	}
</style>


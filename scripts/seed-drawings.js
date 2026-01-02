// Quick script to seed 100 random drawings into PocketBase

const POCKETBASE_URL = 'http://127.0.0.1:8090';
const NUM_DRAWINGS = 100;

function generateRandomPixels() {
	// 16x16 grayscale image = 256 values (0=black, 255=white)
	const pixels = [];
	for (let i = 0; i < 256; i++) {
		// Random black or white for 1-bit style
		pixels.push(Math.random() > 0.5 ? 255 : 0);
	}
	return pixels;
}

function generateRandomName() {
	const adjectives = ['Happy', 'Sad', 'Funky', 'Wild', 'Calm', 'Bright', 'Dark', 'Fuzzy', 'Sharp', 'Soft'];
	const nouns = ['Blob', 'Square', 'Pattern', 'Chaos', 'Dream', 'Noise', 'Mess', 'Art', 'Thing', 'Pixels'];
	const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	return `${adj} ${noun} ${Math.floor(Math.random() * 1000)}`;
}

async function seedDrawings() {
	console.log(`Seeding ${NUM_DRAWINGS} random drawings...`);
	const startTime = Date.now();

	for (let i = 0; i < NUM_DRAWINGS; i++) {
		const drawing = {
			name: generateRandomName(),
			creator: 'seed-script',
			pixels: generateRandomPixels()
		};

		try {
			const response = await fetch(`${POCKETBASE_URL}/api/collections/drawings/records`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(drawing)
			});

			if (!response.ok) {
				const error = await response.text();
				console.error(`Failed to create drawing ${i + 1}:`, error);
			} else {
				process.stdout.write(`\rCreated ${i + 1}/${NUM_DRAWINGS} drawings`);
			}
		} catch (error) {
			console.error(`\nError creating drawing ${i + 1}:`, error.message);
		}
	}

	const elapsed = Date.now() - startTime;
	console.log(`\n\nDone! Created ${NUM_DRAWINGS} drawings in ${elapsed}ms`);
}

seedDrawings();


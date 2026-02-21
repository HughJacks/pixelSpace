import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { GRID_SIZE, NUM_COLORS, COLOR_WHITE, PALETTE } from '$lib/palette';
import { DRAWING_NAME_MAX_LENGTH } from '$lib/types';
import type { Drawing } from '$lib/types';

const TOTAL_PIXELS = GRID_SIZE * GRID_SIZE;

// Single-char codes for the pixel_grid format
// Designed so '.' = empty (white) and '#' = filled (black) — the intuitive convention
const GRID_CHAR_MAP: Record<string, number> = {
	'.': COLOR_WHITE,    // dot = white (empty)
	'#': 0,              // hash = black (filled)
	'b': 2,              // blue
	's': 3,              // sky
	'r': 4,              // red
	'p': 5,              // pink
	'g': 6,              // green
	'm': 7,              // mint
	' ': COLOR_WHITE,    // space = white
	'_': COLOR_WHITE,    // underscore = white
	'X': 0,              // X = black
	'B': 2,              // uppercase variants
	'S': 3,
	'R': 4,
	'P': 5,
	'G': 6,
	'M': 7,
};
const GRID_CHARS_DISPLAY = "'.'=White, '#'=Black, 'b'=Blue, 's'=Sky, 'r'=Red, 'p'=Pink, 'g'=Green, 'm'=Mint";

interface DrawingRow {
	id: string;
	name: string;
	creator: string;
	pixels: number[];
	created_at: string;
}

function rowToDrawing(row: DrawingRow): Drawing {
	return {
		id: row.id,
		name: row.name,
		creator: row.creator,
		pixels: row.pixels,
		created: row.created_at
	};
}

function parsePixelGrid(grid: string[]): number[] | string {
	if (grid.length !== GRID_SIZE) {
		return `pixel_grid must have exactly ${GRID_SIZE} rows, got ${grid.length}`;
	}
	const pixels: number[] = [];
	for (let y = 0; y < GRID_SIZE; y++) {
		const row = grid[y];
		if (row.length !== GRID_SIZE) {
			return `pixel_grid row ${y} must have exactly ${GRID_SIZE} characters, got ${row.length}`;
		}
		for (let x = 0; x < GRID_SIZE; x++) {
			const ch = row[x];
			const colorIndex = GRID_CHAR_MAP[ch];
			if (colorIndex === undefined) {
				return `pixel_grid row ${y} col ${x}: unknown character '${ch}'. Valid chars: ${GRID_CHARS_DISPLAY}`;
			}
			pixels.push(colorIndex);
		}
	}
	return pixels;
}

function parsePixelString(str: string): number[] | string {
	if (str.length !== TOTAL_PIXELS) {
		return `pixel_string must be exactly ${TOTAL_PIXELS} characters, got ${str.length}`;
	}
	const pixels: number[] = [];
	for (let i = 0; i < str.length; i++) {
		const val = parseInt(str[i], 10);
		if (isNaN(val) || val < 0 || val >= NUM_COLORS) {
			return `pixel_string char ${i}: '${str[i]}' is not a valid color index (0-${NUM_COLORS - 1})`;
		}
		pixels.push(val);
	}
	return pixels;
}

function validatePixelArray(pixels: number[]): string | null {
	if (pixels.length !== TOTAL_PIXELS) {
		return `pixels array must have exactly ${TOTAL_PIXELS} elements, got ${pixels.length}`;
	}
	for (let i = 0; i < pixels.length; i++) {
		const v = pixels[i];
		if (!Number.isInteger(v) || v < 0 || v >= NUM_COLORS) {
			return `pixels[${i}]: ${v} is not a valid color index (0-${NUM_COLORS - 1})`;
		}
	}
	return null;
}

const USAGE = {
	description: 'PixelSpace Drawing API',
	grid: `${GRID_SIZE}x${GRID_SIZE}`,
	total_pixels: TOTAL_PIXELS,
	colors: PALETTE.map((c, i) => ({
		index: i,
		name: c.name,
		hex: `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`,
		grid_char: i === 0 ? '#' : i === 1 ? '.' : c.name[0].toLowerCase()
	})),
	endpoints: {
		'GET /api/drawings': 'List all drawings (add ?limit=N to limit results)',
		'POST /api/drawings': 'Create a new drawing'
	},
	post_body: {
		name: `string (required, max ${DRAWING_NAME_MAX_LENGTH} chars)`,
		creator: 'string (required)',
		pixels: `number[] — ${TOTAL_PIXELS} color indices (0-${NUM_COLORS - 1}), row-major order`,
		pixel_string: `string — ${TOTAL_PIXELS} digit chars ('0'-'${NUM_COLORS - 1}'), alternative to pixels`,
		pixel_grid: `string[${GRID_SIZE}] — ${GRID_SIZE} strings of ${GRID_SIZE} chars each. Char map: ${GRID_CHARS_DISPLAY}. Also accepts uppercase, space/underscore=white, X=black.`
	},
	example_post: {
		name: 'Bot Drawing',
		creator: 'my-bot',
		pixel_grid: [
			'................',
			'..##......##....',
			'.#..#....#..#...',
			'.#..#....#..#...',
			'..##......##....',
			'................',
			'................',
			'....#......#....',
			'....#......#....',
			'.....#....#.....',
			'......####......',
			'................',
			'................',
			'................',
			'................',
			'................'
		]
	},
	example_curl: "curl -X POST /api/drawings -H 'Content-Type: application/json' -d '{\"name\":\"test\",\"creator\":\"bot\",\"pixel_grid\":[\"................\",\"..##......##....\",\".#..#....#..#...\",\".#..#....#..#...\",\"..##......##....\",\"................\",\"................\",\"....#......#....\",\"....#......#....\",\".....#....#.....\",\"......####......\",\"................\",\"................\",\"................\",\"................\",\"................\"]}'",
};

export const GET: RequestHandler = async ({ url }) => {
	const limitParam = url.searchParams.get('limit');
	const info = url.searchParams.get('info');

	if (info !== null) {
		return json(USAGE);
	}

	const limit = limitParam ? parseInt(limitParam, 10) : 100;

	const { data, error } = await supabase
		.from('drawings')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(limit);

	if (error) {
		return json({ error: 'Failed to fetch drawings', detail: error.message }, { status: 500 });
	}

	const drawings = (data ?? []).map((row: DrawingRow) => rowToDrawing(row));

	return json({
		count: drawings.length,
		drawings,
		_hint: 'GET /api/drawings?info for API docs and color reference'
	});
};

export const POST: RequestHandler = async ({ request }) => {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const { name, creator, pixels, pixel_string, pixel_grid } = body as {
		name?: string;
		creator?: string;
		pixels?: number[];
		pixel_string?: string;
		pixel_grid?: string[];
	};

	if (!name || typeof name !== 'string' || !name.trim()) {
		return json({ error: 'name is required (string, non-empty)' }, { status: 400 });
	}
	if (name.trim().length > DRAWING_NAME_MAX_LENGTH) {
		return json({ error: `name must be at most ${DRAWING_NAME_MAX_LENGTH} characters` }, { status: 400 });
	}
	if (!creator || typeof creator !== 'string' || !creator.trim()) {
		return json({ error: 'creator is required (string, non-empty)' }, { status: 400 });
	}

	// Parse pixels from one of three formats (exactly one must be provided)
	const formatCount = [pixels, pixel_string, pixel_grid].filter(Boolean).length;
	if (formatCount === 0) {
		return json({
			error: 'Must provide pixels in one of: pixels (number[]), pixel_string (string), pixel_grid (string[])',
			_hint: 'GET /api/drawings?info for full docs'
		}, { status: 400 });
	}
	if (formatCount > 1) {
		return json({ error: 'Provide only one of: pixels, pixel_string, pixel_grid' }, { status: 400 });
	}

	let resolvedPixels: number[];

	if (pixels) {
		if (!Array.isArray(pixels)) {
			return json({ error: 'pixels must be an array of numbers' }, { status: 400 });
		}
		const err = validatePixelArray(pixels);
		if (err) return json({ error: err }, { status: 400 });
		resolvedPixels = pixels;
	} else if (pixel_string) {
		if (typeof pixel_string !== 'string') {
			return json({ error: 'pixel_string must be a string' }, { status: 400 });
		}
		const result = parsePixelString(pixel_string);
		if (typeof result === 'string') return json({ error: result }, { status: 400 });
		resolvedPixels = result;
	} else if (pixel_grid) {
		if (!Array.isArray(pixel_grid) || !pixel_grid.every(r => typeof r === 'string')) {
			return json({ error: 'pixel_grid must be an array of strings' }, { status: 400 });
		}
		const result = parsePixelGrid(pixel_grid);
		if (typeof result === 'string') return json({ error: result }, { status: 400 });
		resolvedPixels = result;
	} else {
		return json({ error: 'No pixel data provided' }, { status: 400 });
	}

	const { data: record, error } = await supabase
		.from('drawings')
		.insert({
			name: name.trim(),
			creator: creator.trim(),
			pixels: resolvedPixels
		})
		.select()
		.single();

	if (error) {
		return json({ error: 'Failed to save drawing', detail: error.message }, { status: 500 });
	}

	return json(rowToDrawing(record), { status: 201 });
};

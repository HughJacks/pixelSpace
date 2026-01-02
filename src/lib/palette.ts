// 8-color palette: Black, White + Blue, Red, Green in solid and pale variants
import type { Color } from './types';

export const PALETTE: Color[] = [
	{ name: 'Black', r: 0, g: 0, b: 0 },            // #000000
	{ name: 'White', r: 255, g: 255, b: 255 },      // #FFFFFF
	{ name: 'Blue', r: 0, g: 0, b: 255 },           // #0000FF - solid blue
	{ name: 'Sky', r: 136, g: 170, b: 255 },        // #88AAFF - pale blue
	{ name: 'Red', r: 255, g: 0, b: 0 },            // #FF0000 - solid red
	{ name: 'Pink', r: 255, g: 136, b: 136 },       // #FF8888 - pale red
	{ name: 'Green', r: 0, g: 255, b: 0 },          // #00FF00 - solid green
	{ name: 'Mint', r: 136, g: 255, b: 136 }        // #88FF88 - pale green
];

export const NUM_COLORS = PALETTE.length;
export const GRID_SIZE = 16;

// Color index constants
export const COLOR_BLACK = 0;
export const COLOR_WHITE = 1;

// Single-value encoding for each color (0-255 range)
// Based on perceptual luminance
export const COLOR_ENCODING: number[] = [
	0,    // Black: 0   (darkest)
	255,  // White: 255 (brightest)
	29,   // Blue:  29  (dark)
	145,  // Sky:   145 (mid-light)
	76,   // Red:   76  (medium-dark)
	178,  // Pink:  178 (light)
	150,  // Green: 150 (medium-bright)
	200   // Mint:  200 (bright)
];

// Pre-calculated Euclidean distance matrix between colors in LAB space
// colorDistance[i][j] = perceptual distance between color i and color j (0-100 scale)
function calculateColorDistances(): number[][] {
	const distances: number[][] = [];
	
	// Convert RGB to LAB for perceptual distance
	function rgbToLab(r: number, g: number, b: number): [number, number, number] {
		// RGB to XYZ
		let rn = r / 255, gn = g / 255, bn = b / 255;
		rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92;
		gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92;
		bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92;
		
		const x = (rn * 0.4124 + gn * 0.3576 + bn * 0.1805) / 0.95047;
		const y = (rn * 0.2126 + gn * 0.7152 + bn * 0.0722) / 1.0;
		const z = (rn * 0.0193 + gn * 0.1192 + bn * 0.9505) / 1.08883;
		
		// XYZ to LAB
		const fx = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
		const fy = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
		const fz = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
		
		return [
			(116 * fy) - 16,  // L
			500 * (fx - fy),  // a
			200 * (fy - fz)   // b
		];
	}
	
	// Calculate LAB values for all colors
	const labs = PALETTE.map(c => rgbToLab(c.r, c.g, c.b));
	
	// Calculate distance matrix
	for (let i = 0; i < NUM_COLORS; i++) {
		distances[i] = [];
		for (let j = 0; j < NUM_COLORS; j++) {
			if (i === j) {
				distances[i][j] = 0;
			} else {
				const [L1, a1, b1] = labs[i];
				const [L2, a2, b2] = labs[j];
				// Delta E (CIE76) - Euclidean distance in LAB space
				const deltaE = Math.sqrt(
					Math.pow(L2 - L1, 2) + 
					Math.pow(a2 - a1, 2) + 
					Math.pow(b2 - b1, 2)
				);
				distances[i][j] = deltaE;
			}
		}
	}
	
	return distances;
}

export const COLOR_DISTANCES = calculateColorDistances();

// Get the encoding value for a color index
export function getColorEncoding(colorIndex: number): number {
	return COLOR_ENCODING[colorIndex] ?? COLOR_ENCODING[COLOR_WHITE];
}

export function colorToHex(color: Color): string {
	return `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;
}

export function colorToCss(color: Color): string {
	return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function getDefaultPixels(): number[] {
	// Initialize with white (color index 1)
	return new Array(GRID_SIZE * GRID_SIZE).fill(COLOR_WHITE);
}

// Convert legacy grayscale value to color index
// Legacy data: 0 = black, 255 = white, values in between threshold to nearest
export function legacyGrayscaleToColorIndex(value: number): number {
	if (value <= 127) return COLOR_BLACK;
	return COLOR_WHITE;
}

// Check if a pixel array is legacy BW format (values are 0 or 255 grayscale)
export function isLegacyBWFormat(pixels: number[]): boolean {
	return pixels.some(v => v > 7); // Color indices are 0-7, legacy uses 0 and 255
}

// Convert legacy BW pixels to color index format
export function convertLegacyPixels(pixels: number[]): number[] {
	if (!isLegacyBWFormat(pixels)) return pixels;
	return pixels.map(legacyGrayscaleToColorIndex);
}

// Convert pixel indices to encoding values for feature extraction
export function pixelsToEncodedValues(pixels: number[]): number[] {
	const normalized = isLegacyBWFormat(pixels) ? convertLegacyPixels(pixels) : pixels;
	return normalized.map(idx => getColorEncoding(idx));
}


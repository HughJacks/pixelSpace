// Classic 1-bit black & white palette (Susan Kare style)
import type { Color } from './types';

export const PALETTE: Color[] = [
	{ name: 'Black', r: 0, g: 0, b: 0 },
	{ name: 'White', r: 255, g: 255, b: 255 }
];

export const GRID_SIZE = 16;

export function colorToHex(color: Color): string {
	return `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;
}

export function colorToCss(color: Color): string {
	return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

export function getDefaultPixels(): number[] {
	// Initialize with white (255 = white, 0 = black)
	return new Array(GRID_SIZE * GRID_SIZE).fill(255);
}


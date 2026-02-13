// Shared SVG generation for drawings (used by favicon and gallery)
import {
	GRID_SIZE,
	PALETTE,
	colorToHex,
	COLOR_WHITE,
	COLOR_BLACK,
	isLegacyBWFormat,
	convertLegacyPixels
} from '$lib/palette';

function getPixelHexColor(pixelValue: number): string {
	if (pixelValue > 7) {
		const colorIdx = pixelValue <= 127 ? COLOR_BLACK : COLOR_WHITE;
		return colorToHex(PALETTE[colorIdx]);
	}
	const color = PALETTE[pixelValue] ?? PALETTE[COLOR_WHITE];
	return colorToHex(color);
}

export function pixelsToFaviconSVG(pixels: number[]): string {
	const normalized = isLegacyBWFormat(pixels) ? convertLegacyPixels(pixels) : pixels;
	let rects = '';
	for (let y = 0; y < GRID_SIZE; y++) {
		let x = 0;
		while (x < GRID_SIZE) {
			const pixelValue = normalized[y * GRID_SIZE + x] ?? COLOR_WHITE;
			let width = 1;
			while (x + width < GRID_SIZE && normalized[y * GRID_SIZE + x + width] === pixelValue) {
				width++;
			}
			const isWhite = pixelValue === COLOR_WHITE || pixelValue === 255;
			if (!isWhite) {
				rects += `<rect x="${x}" y="${y}" width="${width}" height="1" fill="${getPixelHexColor(pixelValue)}"/>`;
			}
			x += width;
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID_SIZE} ${GRID_SIZE}" shape-rendering="crispEdges"><rect width="${GRID_SIZE}" height="${GRID_SIZE}" fill="#fff"/>${rects}</svg>`;
}

const CHECKERBOARD_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><defs><pattern id="cb" width="2" height="2"><rect width="1" height="1" fill="#000"/><rect x="1" width="1" height="1" fill="#fff"/><rect y="1" width="1" height="1" fill="#fff"/><rect x="1" y="1" width="1" height="1" fill="#000"/></pattern></defs><rect width="16" height="16" fill="url(#cb)"/></svg>`;

export const CHECKERBOARD_FAVICON_HREF =
	'data:image/svg+xml;base64,' + btoa(CHECKERBOARD_FAVICON_SVG);

export function setFaviconFromPixels(pixels: number[]): void {
	if (typeof document === 'undefined') return;
	const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (!link) return;
	const svg = pixelsToFaviconSVG(pixels);
	link.href = 'data:image/svg+xml;base64,' + btoa(svg);
}

export function resetFavicon(): void {
	if (typeof document === 'undefined') return;
	const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (link) link.href = CHECKERBOARD_FAVICON_HREF;
}

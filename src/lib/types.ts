// TypeScript types for PixelSpace

export interface Drawing {
	id: string;
	name: string;
	creator: string;
	pixels: number[]; // 256 values (16x16 grayscale, 0=black, 255=white)
	created: string;
}

export interface DrawingWithPosition extends Drawing {
	x: number;
	y: number;
}

export interface TSNEConfig {
	perplexity: number;
	iterations: number;
	learningRate: number;
}

export interface TSNEWorkerMessage {
	type: 'run';
	vectors: number[][];
	config: TSNEConfig;
}

export interface TSNEWorkerResponse {
	type: 'progress' | 'done';
	iteration?: number;
	totalIterations?: number;
	embeddings?: [number, number][];
}

// UMAP types
export interface UMAPConfig {
	nNeighbors: number;
	minDist: number;
	nEpochs: number;
}

export interface UMAPWorkerMessage {
	type: 'run';
	vectors: number[][];
	config: UMAPConfig;
}

export interface UMAPWorkerResponse {
	type: 'progress' | 'done' | 'log';
	iteration?: number;
	totalIterations?: number;
	embeddings?: [number, number][];
	message?: string;
}

export interface Color {
	name: string;
	r: number;
	g: number;
	b: number;
}


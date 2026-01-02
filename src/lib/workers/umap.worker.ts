// UMAP Web Worker - Optimized Implementation
import type { UMAPWorkerMessage, UMAPWorkerResponse } from '../types';

/**
 * UMAP (Uniform Manifold Approximation and Projection)
 * Optimized implementation with random projection for speed
 */

// Helper to send log messages to main thread
function log(message: string) {
	self.postMessage({ type: 'log', message } as UMAPWorkerResponse);
}

// Random projection matrix to reduce dimensionality
function createRandomProjection(fromDim: number, toDim: number): number[][] {
	const matrix: number[][] = [];
	const scale = 1 / Math.sqrt(toDim);
	for (let i = 0; i < toDim; i++) {
		const row: number[] = [];
		for (let j = 0; j < fromDim; j++) {
			// Sparse random projection (faster)
			const r = Math.random();
			if (r < 1/6) row.push(scale * Math.sqrt(3));
			else if (r < 2/6) row.push(-scale * Math.sqrt(3));
			else row.push(0);
		}
		matrix.push(row);
	}
	return matrix;
}

// Apply random projection to reduce dimensionality
function projectData(data: number[][], projMatrix: number[][]): number[][] {
	const toDim = projMatrix.length;
	return data.map(vec => {
		const projected: number[] = [];
		for (let i = 0; i < toDim; i++) {
			let sum = 0;
			const row = projMatrix[i];
			for (let j = 0; j < vec.length; j++) {
				if (row[j] !== 0) sum += row[j] * vec[j];
			}
			projected.push(sum);
		}
		return projected;
	});
}

// Compute squared Euclidean distance
function squaredDistance(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const diff = a[i] - b[i];
		sum += diff * diff;
	}
	return sum;
}

// Find k-nearest neighbors using optimized approach
function findKNearestNeighbors(data: number[][], k: number): { indices: number[][]; distances: number[][] } {
	const n = data.length;
	const indices: number[][] = [];
	const distances: number[][] = [];

	for (let i = 0; i < n; i++) {
		// Use a simple array with partial sort instead of full sort
		const dists: { idx: number; dist: number }[] = [];
		for (let j = 0; j < n; j++) {
			if (i !== j) {
				dists.push({ idx: j, dist: squaredDistance(data[i], data[j]) });
			}
		}
		
		// Partial sort - just get top k (much faster than full sort for small k)
		const kNeighbors: { idx: number; dist: number }[] = [];
		for (let m = 0; m < k && dists.length > 0; m++) {
			let minIdx = 0;
			for (let p = 1; p < dists.length; p++) {
				if (dists[p].dist < dists[minIdx].dist) minIdx = p;
			}
			kNeighbors.push(dists[minIdx]);
			dists.splice(minIdx, 1);
		}
		
		indices.push(kNeighbors.map(d => d.idx));
		distances.push(kNeighbors.map(d => Math.sqrt(d.dist)));
	}

	return { indices, distances };
}

// Compute membership strengths
function computeMembershipStrengths(
	indices: number[][],
	distances: number[][]
): { head: number[]; tail: number[]; weights: number[] } {
	const n = indices.length;
	const head: number[] = [];
	const tail: number[] = [];
	const weights: number[] = [];
	
	// Build symmetric graph
	const seen = new Set<string>();
	
	for (let i = 0; i < n; i++) {
		const localDists = distances[i];
		const rho = localDists.length > 0 ? localDists[0] : 0; // distance to nearest neighbor
		
		// Find sigma using simplified approach
		let sigma = 1;
		if (localDists.length > 1) {
			sigma = localDists[localDists.length - 1] - rho;
			if (sigma <= 0) sigma = 1;
		}
		
		for (let k = 0; k < indices[i].length; k++) {
			const j = indices[i][k];
			const d = Math.max(0, localDists[k] - rho);
			const w = Math.exp(-d / sigma);
			
			const key = i < j ? `${i},${j}` : `${j},${i}`;
			if (!seen.has(key)) {
				seen.add(key);
				head.push(i);
				tail.push(j);
				weights.push(w);
			}
		}
	}
	
	return { head, tail, weights };
}

// Initialize embeddings with small random values
function initializeEmbeddings(n: number): number[][] {
	const embeddings: number[][] = [];
	for (let i = 0; i < n; i++) {
		embeddings.push([
			(Math.random() - 0.5) * 10,
			(Math.random() - 0.5) * 10
		]);
	}
	return embeddings;
}

// Optimized layout with SGD
function optimizeLayout(
	embeddings: number[][],
	head: number[],
	tail: number[],
	weights: number[],
	nEpochs: number,
	minDist: number
): number[][] {
	const n = embeddings.length;
	const nEdges = head.length;
	
	// Precompute a, b for the curve
	const a = 1.929 - 3.52 * minDist + 5.73 * minDist * minDist;
	const b = 0.7915 + 0.2045 * minDist;
	
	// Sort edges by weight for importance sampling
	const edgeOrder = Array.from({ length: nEdges }, (_, i) => i);
	edgeOrder.sort((x, y) => weights[y] - weights[x]);
	
	const alpha0 = 1.0;
	const negativeSampleRate = 5;
	
	for (let epoch = 0; epoch < nEpochs; epoch++) {
		const alpha = alpha0 * (1 - epoch / nEpochs);
		
		// Process edges
		for (let e = 0; e < nEdges; e++) {
			const edgeIdx = edgeOrder[e];
			const i = head[edgeIdx];
			const j = tail[edgeIdx];
			
			const yi = embeddings[i];
			const yj = embeddings[j];
			
			const dx = yi[0] - yj[0];
			const dy = yi[1] - yj[1];
			const distSq = dx * dx + dy * dy + 0.001;
			
			// Attractive force
			const gradCoef = (-2 * a * b * Math.pow(distSq, b - 1)) / (1 + a * Math.pow(distSq, b));
			const grad = Math.max(-4, Math.min(4, gradCoef));
			
			yi[0] += alpha * grad * dx;
			yi[1] += alpha * grad * dy;
			yj[0] -= alpha * grad * dx;
			yj[1] -= alpha * grad * dy;
			
			// Negative samples
			for (let p = 0; p < negativeSampleRate; p++) {
				const k = Math.floor(Math.random() * n);
				if (k === i || k === j) continue;
				
				const yk = embeddings[k];
				const dxN = yi[0] - yk[0];
				const dyN = yi[1] - yk[1];
				const distSqN = dxN * dxN + dyN * dyN + 0.001;
				
				// Repulsive force
				const gradCoefN = (2 * b) / ((0.001 + distSqN) * (1 + a * Math.pow(distSqN, b)));
				const gradN = Math.max(-4, Math.min(4, gradCoefN));
				
				yi[0] += alpha * gradN * dxN;
				yi[1] += alpha * gradN * dyN;
			}
		}
		
		// Report progress less frequently for speed
		if (epoch % 10 === 0 || epoch === nEpochs - 1) {
			log(`Optimization epoch ${epoch + 1}/${nEpochs} (α=${alpha.toFixed(3)})`);
			const response: UMAPWorkerResponse = {
				type: 'progress',
				iteration: epoch + 1,
				totalIterations: nEpochs
			};
			self.postMessage(response);
		}
	}
	
	return embeddings;
}

// Main UMAP function
function runUMAP(
	data: number[][],
	config: { nNeighbors: number; minDist: number; nEpochs: number }
): [number, number][] {
	const n = data.length;
	const startTime = performance.now();
	
	log(`Starting with ${n} vectors, ${data[0]?.length || 0} dimensions`);
	log(`Config: nNeighbors=${config.nNeighbors}, minDist=${config.minDist}, nEpochs=${config.nEpochs}`);
	
	if (n === 0) {
		log('Empty dataset, returning []');
		return [];
	}
	if (n === 1) {
		log('Single point, returning [[0, 0]]');
		return [[0, 0]];
	}
	if (n === 2) {
		log('Two points, returning fixed positions');
		return [[-5, 0], [5, 0]];
	}
	
	// For very small datasets, just use random layout
	if (n <= 5) {
		log('Small dataset (<=5), using random layout');
		return data.map(() => [
			(Math.random() - 0.5) * 20,
			(Math.random() - 0.5) * 20
		] as [number, number]);
	}
	
	// Step 1: Reduce dimensionality with random projection
	const targetDim = Math.min(32, data[0].length);
	let projectedData = data;
	if (data[0].length > targetDim) {
		log(`Step 1: Random projection ${data[0].length}D -> ${targetDim}D...`);
		const t1 = performance.now();
		const projMatrix = createRandomProjection(data[0].length, targetDim);
		projectedData = projectData(data, projMatrix);
		log(`Step 1 complete in ${(performance.now() - t1).toFixed(1)}ms`);
	} else {
		log(`Step 1: Skipping projection (already ${data[0].length}D)`);
	}
	
	// Step 2: Find k-nearest neighbors
	const k = Math.min(config.nNeighbors, Math.floor((n - 1) / 2), 15);
	log(`Step 2: Finding ${k}-nearest neighbors for ${n} points...`);
	const t2 = performance.now();
	const { indices, distances } = findKNearestNeighbors(projectedData, k);
	log(`Step 2 complete in ${(performance.now() - t2).toFixed(1)}ms`);
	
	// Step 3: Build fuzzy graph
	log('Step 3: Building fuzzy graph...');
	const t3 = performance.now();
	const { head, tail, weights } = computeMembershipStrengths(indices, distances);
	log(`Step 3 complete in ${(performance.now() - t3).toFixed(1)}ms (${head.length} edges)`);
	
	// Step 4: Initialize low-dimensional embeddings
	log('Step 4: Initializing 2D embeddings...');
	let embeddings = initializeEmbeddings(n);
	
	// Step 5: Optimize layout
	const epochs = Math.min(config.nEpochs, 50);
	log(`Step 5: Optimizing layout (${epochs} epochs)...`);
	const t5 = performance.now();
	embeddings = optimizeLayout(embeddings, head, tail, weights, epochs, config.minDist);
	log(`Step 5 complete in ${(performance.now() - t5).toFixed(1)}ms`);
	
	const totalTime = performance.now() - startTime;
	log(`Done! Total time: ${totalTime.toFixed(1)}ms`);
	
	return embeddings.map(e => [e[0], e[1]] as [number, number]);
}

// Handle messages
self.onmessage = (event: MessageEvent<UMAPWorkerMessage>) => {
	const { vectors, config } = event.data;
	
	log(`Received ${vectors.length} vectors`);

	if (vectors.length === 0) {
		log('Empty input, returning immediately');
		const response: UMAPWorkerResponse = { type: 'done', embeddings: [] };
		self.postMessage(response);
		return;
	}

	if (vectors.length === 1) {
		log('Single vector, returning [[0,0]]');
		const response: UMAPWorkerResponse = { type: 'done', embeddings: [[0, 0]] };
		self.postMessage(response);
		return;
	}

	try {
		const embeddings = runUMAP(vectors, config);
		log('Sending results back to main thread');
		self.postMessage({ type: 'done', embeddings } as UMAPWorkerResponse);
	} catch (error) {
		log(`Error: ${error}`);
		// Random fallback
		const fallback: [number, number][] = vectors.map(() => [
			Math.random() * 100 - 50,
			Math.random() * 100 - 50
		]);
		self.postMessage({ type: 'done', embeddings: fallback } as UMAPWorkerResponse);
	}
};

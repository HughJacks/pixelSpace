// t-SNE Web Worker - Custom Implementation
import type { TSNEWorkerMessage, TSNEWorkerResponse } from '../types';

/**
 * t-SNE (t-Distributed Stochastic Neighbor Embedding)
 * Custom implementation for dimensionality reduction
 */

// Compute squared Euclidean distance between two vectors
function squaredDistance(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) {
		const diff = a[i] - b[i];
		sum += diff * diff;
	}
	return sum;
}

// ============================================================================
// PCA (Principal Component Analysis) - Dimensionality reduction preprocessing
// ============================================================================

// Center data by subtracting mean from each dimension
function centerData(data: number[][]): { centered: number[][]; means: number[] } {
	const n = data.length;
	const dims = data[0].length;
	const means = new Array(dims).fill(0);

	// Compute means
	for (let i = 0; i < n; i++) {
		for (let d = 0; d < dims; d++) {
			means[d] += data[i][d];
		}
	}
	for (let d = 0; d < dims; d++) {
		means[d] /= n;
	}

	// Center the data
	const centered = data.map((row) => row.map((val, d) => val - means[d]));

	return { centered, means };
}

// Compute covariance matrix (dims x dims)
function computeCovarianceMatrix(centered: number[][]): number[][] {
	const n = centered.length;
	const dims = centered[0].length;
	const cov: number[][] = Array(dims)
		.fill(null)
		.map(() => Array(dims).fill(0));

	for (let i = 0; i < dims; i++) {
		for (let j = i; j < dims; j++) {
			let sum = 0;
			for (let k = 0; k < n; k++) {
				sum += centered[k][i] * centered[k][j];
			}
			cov[i][j] = sum / (n - 1);
			cov[j][i] = cov[i][j]; // Symmetric
		}
	}

	return cov;
}

// Power iteration to find top eigenvector
function powerIteration(matrix: number[][], iterations = 100): number[] {
	const dims = matrix.length;
	let vec = Array(dims)
		.fill(0)
		.map(() => Math.random() - 0.5);

	for (let iter = 0; iter < iterations; iter++) {
		// Multiply matrix by vector
		const newVec = Array(dims).fill(0);
		for (let i = 0; i < dims; i++) {
			for (let j = 0; j < dims; j++) {
				newVec[i] += matrix[i][j] * vec[j];
			}
		}

		// Normalize
		let norm = 0;
		for (let i = 0; i < dims; i++) {
			norm += newVec[i] * newVec[i];
		}
		norm = Math.sqrt(norm);

		if (norm > 0) {
			for (let i = 0; i < dims; i++) {
				vec[i] = newVec[i] / norm;
			}
		}
	}

	return vec;
}

// Compute eigenvalue for an eigenvector
function computeEigenvalue(matrix: number[][], eigenvector: number[]): number {
	const dims = matrix.length;
	let numerator = 0;
	let denominator = 0;

	for (let i = 0; i < dims; i++) {
		let sum = 0;
		for (let j = 0; j < dims; j++) {
			sum += matrix[i][j] * eigenvector[j];
		}
		numerator += sum * eigenvector[i];
		denominator += eigenvector[i] * eigenvector[i];
	}

	return numerator / denominator;
}

// Deflate matrix by removing component along eigenvector
function deflateMatrix(matrix: number[][], eigenvector: number[], eigenvalue: number): number[][] {
	const dims = matrix.length;
	const deflated = matrix.map((row) => [...row]);

	for (let i = 0; i < dims; i++) {
		for (let j = 0; j < dims; j++) {
			deflated[i][j] -= eigenvalue * eigenvector[i] * eigenvector[j];
		}
	}

	return deflated;
}

// Main PCA function - reduces dimensionality while preserving variance
function applyPCA(data: number[][], targetDims: number): number[][] {
	if (data.length === 0) return [];
	if (data[0].length <= targetDims) return data; // Already small enough

	const { centered } = centerData(data);
	let cov = computeCovarianceMatrix(centered);

	// Find top k eigenvectors using deflation
	const eigenvectors: number[][] = [];

	for (let k = 0; k < targetDims; k++) {
		const eigenvector = powerIteration(cov);
		const eigenvalue = computeEigenvalue(cov, eigenvector);
		eigenvectors.push(eigenvector);
		cov = deflateMatrix(cov, eigenvector, eigenvalue);
	}

	// Project data onto eigenvectors
	const projected = centered.map((row) => {
		return eigenvectors.map((ev) => {
			let dot = 0;
			for (let i = 0; i < row.length; i++) {
				dot += row[i] * ev[i];
			}
			return dot;
		});
	});

	return projected;
}

// ============================================================================
// t-SNE Core Algorithm
// ============================================================================

// Compute pairwise distances matrix
function computeDistances(data: number[][]): number[][] {
	const n = data.length;
	const distances: number[][] = Array(n)
		.fill(null)
		.map(() => Array(n).fill(0));

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const d = squaredDistance(data[i], data[j]);
			distances[i][j] = d;
			distances[j][i] = d;
		}
	}
	return distances;
}

// Compute conditional probabilities P(j|i) using binary search for perplexity
function computeProbabilities(distances: number[][], perplexity: number): number[][] {
	const n = distances.length;
	const P: number[][] = Array(n)
		.fill(null)
		.map(() => Array(n).fill(0));

	const targetEntropy = Math.log(perplexity);

	for (let i = 0; i < n; i++) {
		// Binary search for sigma that gives target perplexity
		let sigmaMin = 1e-10;
		let sigmaMax = 1e10;
		let sigma = 1;

		for (let iter = 0; iter < 50; iter++) {
			// Compute probabilities with current sigma
			let sumP = 0;
			for (let j = 0; j < n; j++) {
				if (i !== j) {
					P[i][j] = Math.exp(-distances[i][j] / (2 * sigma * sigma));
					sumP += P[i][j];
				}
			}

			// Normalize
			if (sumP > 0) {
				for (let j = 0; j < n; j++) {
					P[i][j] /= sumP;
				}
			}

			// Compute entropy
			let entropy = 0;
			for (let j = 0; j < n; j++) {
				if (P[i][j] > 1e-10) {
					entropy -= P[i][j] * Math.log(P[i][j]);
				}
			}

			// Binary search update
			if (Math.abs(entropy - targetEntropy) < 1e-5) {
				break;
			}

			if (entropy > targetEntropy) {
				sigmaMax = sigma;
				sigma = (sigma + sigmaMin) / 2;
			} else {
				sigmaMin = sigma;
				sigma = (sigma + sigmaMax) / 2;
			}
		}
	}

	return P;
}

// Symmetrize and normalize P matrix
function symmetrize(P: number[][]): number[][] {
	const n = P.length;
	const Psym: number[][] = Array(n)
		.fill(null)
		.map(() => Array(n).fill(0));

	let sum = 0;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const val = (P[i][j] + P[j][i]) / (2 * n);
			Psym[i][j] = val;
			Psym[j][i] = val;
			sum += 2 * val;
		}
	}

	// Normalize
	if (sum > 0) {
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < n; j++) {
				Psym[i][j] /= sum;
			}
		}
	}

	return Psym;
}

// Initialize embeddings randomly
function initializeEmbeddings(n: number, dim: number): number[][] {
	const Y: number[][] = [];
	for (let i = 0; i < n; i++) {
		const point: number[] = [];
		for (let d = 0; d < dim; d++) {
			point.push((Math.random() - 0.5) * 0.01);
		}
		Y.push(point);
	}
	return Y;
}

// Compute Q matrix (t-distribution in low-dimensional space)
function computeQ(Y: number[][]): { Q: number[][]; sumQ: number } {
	const n = Y.length;
	const Q: number[][] = Array(n)
		.fill(null)
		.map(() => Array(n).fill(0));

	let sumQ = 0;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const dist = squaredDistance(Y[i], Y[j]);
			const val = 1 / (1 + dist);
			Q[i][j] = val;
			Q[j][i] = val;
			sumQ += 2 * val;
		}
	}

	return { Q, sumQ };
}

// Compute gradients
function computeGradients(
	P: number[][],
	Q: number[][],
	sumQ: number,
	Y: number[][],
	exaggeration: number
): number[][] {
	const n = Y.length;
	const dim = Y[0].length;
	const gradients: number[][] = Array(n)
		.fill(null)
		.map(() => Array(dim).fill(0));

	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			if (i !== j) {
				const qij = Q[i][j] / sumQ;
				const pij = P[i][j] * exaggeration;
				const mult = 4 * (pij - qij) * Q[i][j];

				for (let d = 0; d < dim; d++) {
					gradients[i][d] += mult * (Y[i][d] - Y[j][d]);
				}
			}
		}
	}

	return gradients;
}

// Run t-SNE
function runTSNE(
	data: number[][],
	config: { perplexity: number; iterations: number; learningRate: number }
): [number, number][] {
	const n = data.length;

	if (n === 0) return [];
	if (n === 1) return [[0, 0]];

	// Step 0: Apply PCA to reduce dimensions (64D -> 16D)
	// This removes noise, speeds up distance computation, and often improves results
	const targetPcaDims = Math.min(16, data[0].length, n - 1);
	const reducedData = applyPCA(data, targetPcaDims);

	// Adjust perplexity if needed
	const perplexity = Math.min(config.perplexity, Math.floor((n - 1) / 3));

	// Step 1: Compute pairwise distances (on PCA-reduced data)
	const distances = computeDistances(reducedData);

	// Step 2: Compute P matrix
	const P_cond = computeProbabilities(distances, perplexity);
	const P = symmetrize(P_cond);

	// Step 3: Initialize low-dimensional embeddings
	let Y = initializeEmbeddings(n, 2);

	// Momentum
	let velocities: number[][] = Array(n)
		.fill(null)
		.map(() => Array(2).fill(0));

	const momentum = 0.5;
	const finalMomentum = 0.8;
	const momentumSwitchIter = 250;
	const earlyExaggeration = 4;
	const earlyExaggerationEnd = 100;

	// Step 4: Gradient descent
	for (let iter = 0; iter < config.iterations; iter++) {
		// Compute Q matrix
		const { Q, sumQ } = computeQ(Y);

		// Determine exaggeration
		const exaggeration = iter < earlyExaggerationEnd ? earlyExaggeration : 1;

		// Compute gradients
		const gradients = computeGradients(P, Q, sumQ, Y, exaggeration);

		// Update momentum
		const currentMomentum = iter < momentumSwitchIter ? momentum : finalMomentum;

		// Update embeddings
		for (let i = 0; i < n; i++) {
			for (let d = 0; d < 2; d++) {
				velocities[i][d] = currentMomentum * velocities[i][d] - config.learningRate * gradients[i][d];
				Y[i][d] += velocities[i][d];
			}
		}

		// Center embeddings
		const mean = [0, 0];
		for (let i = 0; i < n; i++) {
			mean[0] += Y[i][0];
			mean[1] += Y[i][1];
		}
		mean[0] /= n;
		mean[1] /= n;

		for (let i = 0; i < n; i++) {
			Y[i][0] -= mean[0];
			Y[i][1] -= mean[1];
		}

		// Post progress
		if (iter % 25 === 0 || iter === config.iterations - 1) {
			const progressResponse: TSNEWorkerResponse = {
				type: 'progress',
				iteration: iter + 1,
				totalIterations: config.iterations
			};
			self.postMessage(progressResponse);
		}
	}

	return Y.map((point) => [point[0], point[1]] as [number, number]);
}

// Handle messages
self.onmessage = (event: MessageEvent<TSNEWorkerMessage>) => {
	const { vectors, config } = event.data;

	if (vectors.length === 0) {
		const response: TSNEWorkerResponse = {
			type: 'done',
			embeddings: []
		};
		self.postMessage(response);
		return;
	}

	if (vectors.length === 1) {
		const response: TSNEWorkerResponse = {
			type: 'done',
			embeddings: [[0, 0]]
		};
		self.postMessage(response);
		return;
	}

	try {
		const embeddings = runTSNE(vectors, config);

		const doneResponse: TSNEWorkerResponse = {
			type: 'done',
			embeddings
		};
		self.postMessage(doneResponse);
	} catch (error) {
		console.error('t-SNE error:', error);
		// Return random positions as fallback
		const fallbackEmbeddings: [number, number][] = vectors.map(() => [
			Math.random() * 100 - 50,
			Math.random() * 100 - 50
		]);
		const fallbackResponse: TSNEWorkerResponse = {
			type: 'done',
			embeddings: fallbackEmbeddings
		};
		self.postMessage(fallbackResponse);
	}
};

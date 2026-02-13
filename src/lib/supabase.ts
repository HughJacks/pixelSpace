import { createClient } from '@supabase/supabase-js';
import type { Drawing } from './types';

// Supabase client singleton
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
	console.error('Missing Supabase environment variables');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Type for creating a new drawing (without id and created_at)
export interface CreateDrawingData {
	name: string;
	creator: string;
	pixels: number[];
}

// Database row type (matches Supabase schema)
interface DrawingRow {
	id: string;
	name: string;
	creator: string;
	pixels: number[];
	created_at: string;
	updated_at: string;
}

// Convert DB row to app type
function rowToDrawing(row: DrawingRow): Drawing {
	return {
		id: row.id,
		name: row.name,
		creator: row.creator,
		pixels: row.pixels,
		created: row.created_at
	};
}

// IndexedDB cache for drawings
const DB_NAME = 'pixelspace-cache';
const DB_VERSION = 1;
const STORE_NAME = 'drawings';

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				store.createIndex('created', 'created', { unique: false });
			}
		};
	});
}

async function getCachedDrawings(): Promise<Drawing[]> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.getAll();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const drawings = request.result as Drawing[];
				// Sort by created descending
				drawings.sort((a, b) => b.created.localeCompare(a.created));
				resolve(drawings);
			};
		});
	} catch (error) {
		console.warn('[Cache] Failed to read cache:', error);
		return [];
	}
}

async function cacheDrawings(drawings: Drawing[]): Promise<void> {
	if (drawings.length === 0) return;

	try {
		const db = await openDB();
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		const store = transaction.objectStore(STORE_NAME);

		for (const drawing of drawings) {
			store.put(drawing);
		}

		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	} catch (error) {
		console.warn('[Cache] Failed to write cache:', error);
	}
}

async function getLatestCachedTimestamp(): Promise<string | null> {
	try {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const index = store.index('created');
			const request = index.openCursor(null, 'prev'); // Get latest

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const cursor = request.result;
				resolve(cursor ? cursor.value.created : null);
			};
		});
	} catch (error) {
		return null;
	}
}

// Network fetch timeout - fail fast instead of waiting for browser default (~60s)
const FETCH_TIMEOUT_MS = 10_000;

// Fetch all drawings with caching.
// If onCacheReady is provided, it will be called as soon as cached drawings are
// available (before the network request completes), so the UI can show them instantly.
export async function getAllDrawings(
	onCacheReady?: (drawings: Drawing[]) => void
): Promise<Drawing[]> {
	const totalStart = performance.now();

	// Step 1: Load from cache first
	const cacheStart = performance.now();
	const cachedDrawings = await getCachedDrawings();
	const cacheTime = performance.now() - cacheStart;
	console.log(`[Load] Cache read: ${cachedDrawings.length} drawings in ${cacheTime.toFixed(1)}ms`);

	// Deliver cached drawings immediately so the UI can render them
	if (cachedDrawings.length > 0 && onCacheReady) {
		onCacheReady(cachedDrawings);
	}

	// Step 2: Get the latest timestamp we have cached
	const latestTimestamp = await getLatestCachedTimestamp();

	// Step 3: Fetch only new drawings from server (with timeout)
	const fetchStart = performance.now();
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		let query = supabase.from('drawings').select('*').order('created_at', { ascending: false });

		if (latestTimestamp && cachedDrawings.length > 0) {
			// Fetch only drawings created after our latest cached one
			console.log(`[Load] Fetching drawings newer than ${latestTimestamp}`);
			query = query.gt('created_at', latestTimestamp);
		} else {
			console.log('[Load] No cache, fetching all drawings');
		}

		const { data: records, error } = await query.abortSignal(controller.signal);
		clearTimeout(timeoutId);

		if (error) throw error;

		const fetchTime = performance.now() - fetchStart;
		console.log(`[Load] Server fetch: ${records?.length ?? 0} new drawings in ${fetchTime.toFixed(1)}ms`);

		const newDrawings: Drawing[] = (records ?? []).map((record: DrawingRow) => rowToDrawing(record));

		// Step 4: Cache new drawings
		if (newDrawings.length > 0) {
			const cacheWriteStart = performance.now();
			await cacheDrawings(newDrawings);
			console.log(
				`[Load] Cache write: ${newDrawings.length} drawings in ${(performance.now() - cacheWriteStart).toFixed(1)}ms`
			);
		}

		// Step 5: Merge and return
		const allDrawings = [...newDrawings, ...cachedDrawings];
		// Dedupe by id (in case of any overlap)
		const seen = new Set<string>();
		const deduped = allDrawings.filter((d) => {
			if (seen.has(d.id)) return false;
			seen.add(d.id);
			return true;
		});

		const totalTime = performance.now() - totalStart;
		console.log(`[Load] Total: ${deduped.length} drawings in ${totalTime.toFixed(1)}ms`);

		return deduped;
	} catch (error) {
		console.error('Failed to fetch drawings:', error);
		// Return cached data on error
		const totalTime = performance.now() - totalStart;
		console.log(`[Load] Error, returning ${cachedDrawings.length} cached drawings (${totalTime.toFixed(1)}ms)`);
		return cachedDrawings;
	}
}

// Create a new drawing
export async function createDrawing(data: CreateDrawingData): Promise<Drawing | null> {
	try {
		const { data: record, error } = await supabase
			.from('drawings')
			.insert({
				name: data.name,
				creator: data.creator,
				pixels: data.pixels
			})
			.select()
			.single();

		if (error) throw error;

		return rowToDrawing(record);
	} catch (error) {
		console.error('Failed to create drawing:', error);
		return null;
	}
}

// Subscribe to real-time updates
export function subscribeToDrawings(callback: (drawing: Drawing) => void): () => void {
	const channel = supabase
		.channel('drawings-changes')
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: 'drawings'
			},
			(payload) => {
				try {
					console.log('[Realtime] Received INSERT event', payload?.new?.id);
					const row = payload?.new;
					if (!row || typeof row !== 'object') {
						console.warn('[Realtime] Invalid payload, skipping');
						return;
					}
					const drawing = rowToDrawing(row as DrawingRow);
					// Validate drawing has required fields
					if (!drawing.id || !Array.isArray(drawing.pixels)) {
						console.warn('[Realtime] Invalid drawing shape, skipping');
						return;
					}
					// Cache the new drawing (fire-and-forget, don't block callback)
					cacheDrawings([drawing]).catch((e) => console.warn('[Realtime] Cache write failed:', e));
					callback(drawing);
				} catch (e) {
					console.error('[Realtime] Error processing drawing:', e);
				}
			}
		)
		.subscribe((status, err) => {
			if (status === 'SUBSCRIBED') {
				console.log('[Realtime] Connected to drawings channel');
			} else if (status === 'CHANNEL_ERROR') {
				console.warn('[Realtime] Failed to subscribe to drawings:', err?.message);
			}
		});

	// Return unsubscribe function
	return () => {
		supabase.removeChannel(channel);
	};
}

// Presence payload type
interface PresencePayload {
	user_id: string;
	online_at: string;
}

// Subscribe to presence for online user count.
// Callback receives the number of users currently online.
// Debounced to avoid rapid state updates that can cause performance issues.
export function subscribeToPresence(
	userId: string,
	onOnlineCount: (count: number) => void
): () => void {
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastCount = -1;

	const channel = supabase
		.channel('pixelspace-online')
		.on('presence', { event: 'sync' }, () => {
			try {
				const state = channel.presenceState<PresencePayload>() ?? {};
				const uniqueUsers = new Set(
					Object.values(state)
						.flat()
						.filter((p): p is PresencePayload => p != null && typeof p === 'object')
						.map((p) => p.user_id)
				);
				const count = uniqueUsers.size;
				if (count === lastCount) return; // Skip redundant updates
				lastCount = count;

				// Debounce: presence sync can fire very frequently
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					debounceTimer = null;
					onOnlineCount(count);
				}, 200);
			} catch (e) {
				console.warn('[Realtime] Presence sync error:', e);
			}
		})
		.subscribe(async (status) => {
			if (status === 'SUBSCRIBED') {
				try {
					await channel.track({
						user_id: userId,
						online_at: new Date().toISOString()
					});
				} catch (e) {
					console.warn('[Realtime] Presence track error:', e);
				}
			}
		});

	// Return unsubscribe - always remove channel; untrack can fail or hang
	let cleaned = false;
	return () => {
		if (cleaned) return;
		cleaned = true;
		if (debounceTimer) clearTimeout(debounceTimer);
		channel
			.untrack()
			.catch(() => {})
			.finally(() => {
				supabase.removeChannel(channel);
			});
	};
}

// Clear the cache (useful for debugging)
export async function clearDrawingsCache(): Promise<void> {
	try {
		const db = await openDB();
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		store.clear();
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		console.log('[Cache] Cleared');
	} catch (error) {
		console.warn('[Cache] Failed to clear:', error);
	}
}


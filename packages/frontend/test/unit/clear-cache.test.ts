/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	done: vi.fn(),
	reload: vi.fn(),
	removeItem: vi.fn(),
	del: vi.fn(),
	clearTheme: vi.fn(),
}));

vi.mock('@@/js/config.js', () => ({ apiUrl: 'https://example.test/api' }));
vi.mock('@/os.js', () => ({ waiting: () => mocks.done }));
vi.mock('@/utility/unison-reload.js', () => ({ unisonReload: mocks.reload }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { removeItem: mocks.removeItem } }));
vi.mock('@/utility/idb-proxy.js', () => ({ del: mocks.del }));
vi.mock('@/theme.js', () => ({ clearAppliedThemeCache: mocks.clearTheme }));

import { clearCache } from '@/utility/clear-cache.js';

beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	mocks.del.mockResolvedValue(undefined);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function setup() {
	const cacheStorage = {
		keys: vi.fn().mockResolvedValue(['misskey-static-v2-old', 'mk-cache-old', 'unrelated-app']),
		delete: vi.fn().mockResolvedValue(true),
	};
	const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
	vi.stubGlobal('caches', cacheStorage);
	vi.stubGlobal('fetch', fetchMock);
	return { cacheStorage, fetchMock };
}

describe('cache recovery', () => {
	test('clears owned caches and emoji IndexedDB entries, then releases the UI and reloads', async () => {
		const { cacheStorage, fetchMock } = setup();
		await clearCache();
		expect(cacheStorage.delete.mock.calls).toEqual([['misskey-static-v2-old'], ['mk-cache-old']]);
		expect(mocks.del.mock.calls).toEqual([['emojis'], ['lastEmojisFetchedAt']]);
		expect(mocks.removeItem.mock.calls).toEqual([['instance'], ['instanceCachedAt'], ['emojis'], ['lastEmojisFetchedAt']]);
		expect(mocks.clearTheme).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://example.test/api/clear-browser-cache', expect.objectContaining({ cache: 'no-store' }));
		expect(mocks.done).toHaveBeenCalledOnce();
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	test('reloads even when storage is denied and the cache-clearing endpoint is offline', async () => {
		const { cacheStorage, fetchMock } = setup();
		cacheStorage.keys.mockRejectedValue(new Error('denied'));
		mocks.del.mockRejectedValue(new Error('denied'));
		mocks.removeItem.mockImplementation(() => { throw new Error('denied'); });
		fetchMock.mockRejectedValue(new Error('offline'));
		await expect(clearCache()).resolves.toBeUndefined();
		expect(mocks.done).toHaveBeenCalledOnce();
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	test('attempts the other cache deletions even when one fails', async () => {
		const { cacheStorage } = setup();
		cacheStorage.delete.mockRejectedValueOnce(new Error('denied'));
		await clearCache();
		expect(cacheStorage.delete).toHaveBeenCalledTimes(2);
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	test('bounds recovery when storage and network never settle', async () => {
		const { cacheStorage, fetchMock } = setup();
		cacheStorage.keys.mockReturnValue(new Promise(() => {}));
		fetchMock.mockReturnValue(new Promise(() => {}));
		const pending = clearCache();
		await vi.advanceTimersByTimeAsync(9_999);
		expect(mocks.reload).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(mocks.done).toHaveBeenCalledOnce();
		expect(mocks.reload).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});

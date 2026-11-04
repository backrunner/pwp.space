/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { unisonReload } from '@/utility/unison-reload.js';
import { apiUrl } from '@@/js/config.js';
import * as os from '@/os.js';
import { miLocalStorage } from '@/local-storage.js';
import { del } from '@/utility/idb-proxy.js';
import { clearAppliedThemeCache } from '@/theme.js';

export async function clearCache() {
	const done = os.waiting();
	const controller = new AbortController();
	let timeout: number | undefined;
	try {
		const cleanup = Promise.allSettled([
			Promise.resolve().then(() => {
				for (const key of ['instance', 'instanceCachedAt', 'emojis', 'lastEmojisFetchedAt'] as const) {
					miLocalStorage.removeItem(key);
				}
				clearAppliedThemeCache();
			}),
			del('emojis'),
			del('lastEmojisFetchedAt'),
			Promise.resolve().then(async () => {
				// Clear CacheStorage explicitly; Clear-Site-Data support varies by browser.
				const names = await window.caches.keys();
				await Promise.allSettled(names
					.filter(name => name.startsWith('misskey-static-') || name.startsWith('mk-cache-'))
					.map(name => window.caches.delete(name)));
			}),
			Promise.resolve().then(() => window.fetch(`${apiUrl}/clear-browser-cache`, {
				method: 'GET',
				credentials: 'omit',
				cache: 'no-store',
				signal: controller.signal,
			})),
		]);
		// Recovery must finish even when network or browser storage never settles.
		await Promise.race([cleanup, new Promise<void>(resolve => {
			timeout = window.setTimeout(resolve, 10_000);
		})]);
	} finally {
		window.clearTimeout(timeout);
		controller.abort();
		done();
		// Fresh metadata/emojis are fetched on startup, without blocking this reload.
		unisonReload();
	}
}

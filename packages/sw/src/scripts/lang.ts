/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * Language manager for SW
 */
import { get, set } from 'idb-keyval';
import { I18n } from '@@/js/i18n.js';
import { FETCH_TIMEOUT_MS } from '@/const.js';
import type { Locale } from 'i18n';

async function parseLocale(response: Response): Promise<I18n<Locale>> {
	const locale = await response.json();
	if (locale === null || typeof locale !== 'object' || Array.isArray(locale)) throw new Error('invalid locale');
	return new I18n<Locale>(locale);
}

class SwLang {
	public cacheName = `mk-cache-${_VERSION_}`;

	public lang: Promise<string> = get('lang').catch(() => null).then(async prelang => {
		if (!prelang) return 'en-US';
		return prelang;
	});

	public async setLang(newLang: string): Promise<I18n<Locale>> {
		this.lang = Promise.resolve(newLang);
		await set('lang', newLang).catch(() => {});
		return this.fetchLocale();
	}

	public i18n: Promise<I18n<Locale>> | null = null;

	public fetchLocale(): Promise<I18n<Locale>> {
		const pending = this._fetch().catch(error => {
			// A temporary failure must not poison all future notifications/navigation.
			if (this.i18n === pending) this.i18n = null;
			throw error;
		});
		return (this.i18n = pending);
	}

	private async _fetch(): Promise<I18n<Locale>> {
		// Service Workerは何度も起動しそのたびにlocaleを読み込むので、CacheStorageを使う
		const localeUrl = `/assets/locales/${await this.lang}.${_VERSION_}.json`;
		let cache: Cache | undefined;
		try {
			cache = await caches.open(this.cacheName);
			if (!_DEV_) {
				const cached = await cache.match(localeUrl);
				if (cached?.ok) return await parseLocale(cached);
			}
		} catch {
			// Unavailable storage or invalid cached JSON must fall back to the network.
		}

		const controller = new AbortController();
		const timeout = globalThis.setTimeout(() => {
			controller.abort('locale-fetch-timeout');
		}, FETCH_TIMEOUT_MS);

		try {
			const response = await fetch(localeUrl, { signal: controller.signal, cache: 'no-cache' });
			if (!response.ok) throw new Error('locale fetching error');

			const cacheResponse = response.clone();
			const locale = await parseLocale(response);
			// Store only parsed JSON. Storage latency must not delay an offline page.
			void cache?.put(localeUrl, cacheResponse).catch(() => {});
			return locale;
		} finally {
			globalThis.clearTimeout(timeout);
		}
	}
}

export const swLang = new SwLang();

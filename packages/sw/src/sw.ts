/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { get } from 'idb-keyval';
import * as Misskey from 'misskey-js';
import { FETCH_TIMEOUT_MS } from '@/const.js';
import type { PushNotificationDataMap } from '@/types.js';
import type { I18n } from '@@/js/i18n.js';
import type { Locale } from 'i18n';
import { createEmptyNotification, createNotification } from '@/scripts/create-notification.js';
import { swLang } from '@/scripts/lang.js';
import * as swos from '@/scripts/operations.js';

async function respondToNavigation(request: Request): Promise<Response> {
	const controller = new AbortController();
	const timeout = globalThis.setTimeout(() => {
		controller.abort('navigation-timeout');
	}, FETCH_TIMEOUT_MS);

	try {
		// Revalidate the document so it does not reference assets from an old deploy.
		const response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });

		if (response?.status && response.status < 500) return response;
		if (response?.type === 'opaqueredirect') return response;
	} catch (error) {
		if (_DEV_) {
			console.warn('navigation fetch failed; showing offline page', error);
		}
	} finally {
		globalThis.clearTimeout(timeout);
	}

	// Only show offline page when network request actually fails
	const html = await offlineContentHTML();
	return new Response(html, {
		status: 200,
		headers: {
			'content-type': 'text/html',
		},
	});
}

async function offlineContentHTML() {
	let i18n: Partial<I18n<Locale>>;
	try {
		i18n = await (swLang.i18n ?? await swLang.fetchLocale()) as Partial<I18n<Locale>>;
	} catch {
		i18n = {};
	}

	const messages = {
		title: i18n.ts?._offlineScreen?.title ?? 'Offline - Could not connect to server',
		header: i18n.ts?._offlineScreen?.header ?? 'Could not connect to server',
		reload: i18n.ts?.reload ?? 'Reload',
	};

	return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta content="width=device-width,initial-scale=1"name="viewport"><title>${messages.title}</title><style>body{background-color:#0c1210;color:#dee7e4;font-family:Hiragino Maru Gothic Pro,BIZ UDGothic,Roboto,HelveticaNeue,Arial,sans-serif;line-height:1.35;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box}.icon{max-width:120px;width:100%;height:auto;margin-bottom:20px;}.message{text-align:center;font-size:20px;font-weight:700;margin-bottom:20px}.version{text-align:center;font-size:90%;margin-bottom:20px}button{padding:7px 14px;min-width:100px;font-weight:700;font-family:Hiragino Maru Gothic Pro,BIZ UDGothic,Roboto,HelveticaNeue,Arial,sans-serif;line-height:1.35;border-radius:99rem;background-color:#b4e900;color:#192320;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent}button:hover{background-color:#c6ff03}</style></head><body><svg class="icon"fill="none"height="24"stroke="currentColor"stroke-linecap="round"stroke-linejoin="round"stroke-width="2"viewBox="0 0 24 24"width="24"xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"fill="none"stroke="none"/><path d="M9.58 5.548c.24 -.11 .492 -.207 .752 -.286c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 .957 -.383 1.824 -1.003 2.454m-2.997 1.033h-11.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.13 -.582 .37 -1.128 .7 -1.62"/><path d="M3 3l18 18"/></svg><div class="message">${messages.header}</div><div class="version">v${_VERSION_}</div><button onclick="reloadPage()">${messages.reload}</button><script>function reloadPage(){location.reload(!0)}</script></body></html>`;
}

const STATIC_CACHE_NAME = `misskey-static-v2-${_VERSION_}`;

function isImmutableAsset(request: Request): boolean {
	const url = new URL(request.url);
	// Only content-hashed build output is safe to serve cache-first across deployments.
	return request.method === 'GET' && url.origin === globalThis.location.origin &&
		/^\/vite\/(scripts|assets|[a-z]{2,3}-[A-Z]{2,3})\/[^/]+-[\w-]{8}\.[\w.]+$/.test(url.pathname);
}

function isUsableAsset(request: Request, response: Response): boolean {
	if (response.status !== 200 || response.redirected) return false;
	const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
	const path = new URL(request.url).pathname;
	if (/\.m?js$/.test(path)) return /^(text|application)\/(javascript|ecmascript)$/.test(mime ?? '');
	if (path.endsWith('.css')) return mime === 'text/css';
	return mime !== 'text/html';
}

async function respondToAsset(ev: FetchEvent): Promise<Response> {
	const request = ev.request;
	if (request.cache === 'no-store') return fetch(request);

	let cache: Cache | undefined;
	let invalidCachedResponse = false;
	try {
		cache = await caches.open(STATIC_CACHE_NAME);
		// CacheStorage does not implement Request.cache for us.
		if (request.cache !== 'reload' && request.cache !== 'no-cache') {
			const cached = await cache.match(request);
			if (cached && isUsableAsset(request, cached)) return cached;
			invalidCachedResponse = cached !== undefined;
		}
	} catch {
		// Safari can deny or evict CacheStorage. Network requests must still work.
	}

	// Do not repair a bad CacheStorage entry with the same bad HTTP-cache entry.
	const response = await fetch(request, invalidCachedResponse ? { cache: 'reload' } : undefined);
	if (cache && response.type === 'basic' && isUsableAsset(request, response)) {
		try {
			// Keep the worker alive for storage, but return the resource immediately.
			ev.waitUntil(cache.put(request, response.clone()).catch(() => {}));
		} catch {
			// A full or unavailable cache must not turn a successful fetch into an error.
		}
	}
	return response;
}

globalThis.addEventListener('install', ev => {
	// Opt out of Chromium ServiceWorkerAutoPreload (issues.chromium.org/466790291).
	if ('addRoutes' in ev && 'URLPattern' in globalThis) {
		// @ts-expect-error Experimental API is not in the worker type definitions.
		ev.addRoutes({
			condition: {
				// @ts-expect-error Experimental API is not in the worker type definitions.
				urlPattern: new URLPattern({}),
			},
			source: 'fetch-event',
		});
	}
	// Do not skipWaiting: a breaking worker update must not take over running clients.
});

globalThis.addEventListener('activate', ev => {
	ev.waitUntil((async () => {
		try {
			const cacheNames = await caches.keys();
			await Promise.all(cacheNames
				.filter(name => (name.startsWith('misskey-static-') || name.startsWith('mk-cache-')) &&
					name !== STATIC_CACHE_NAME && name !== swLang.cacheName)
				.map(name => caches.delete(name)));
		} catch {
			// CacheStorage is optional; activation must succeed without it.
		}
		await globalThis.clients.claim();
	})());
});

globalThis.addEventListener('fetch', ev => {
	if (isImmutableAsset(ev.request)) {
		ev.respondWith(respondToAsset(ev));
		return;
	}

	// Safari need not expose Sec-Fetch-Dest. Request.mode identifies real navigations.
	if (ev.request.mode !== 'navigate') return;
	ev.respondWith(respondToNavigation(ev.request));
});

globalThis.addEventListener('push', ev => {
	ev.waitUntil(globalThis.clients.matchAll({
		includeUncontrolled: true,
		type: 'window',
	}).then(async () => {
		const data: PushNotificationDataMap[keyof PushNotificationDataMap] = ev.data?.json();

		switch (data.type) {
			case 'notification':
			case 'unreadAntennaNote':
			case 'newChatMessage':
				// 1日以上経過している場合は無視
				if (Date.now() - data.dateTime > 1000 * 60 * 60 * 24) break;

				return createNotification(data);
			case 'readAllNotifications':
				await globalThis.registration.getNotifications()
					.then(notifications => notifications.forEach(n => n.tag !== 'read_notification' && n.close()));
				break;
		}

		await createEmptyNotification();
		return;
	}));
});

globalThis.addEventListener('notificationclick', (ev: ServiceWorkerGlobalScopeEventMap['notificationclick']) => {
	ev.waitUntil((async (): Promise<void> => {
		if (_DEV_) {
			console.log('notificationclick', ev.action, ev.notification.data);
		}

		const { action, notification } = ev;
		const data: PushNotificationDataMap[keyof PushNotificationDataMap] = notification.data ?? {};
		const { userId: loginId } = data;
		let client: WindowClient | null = null;

		switch (data.type) {
			case 'notification':
				switch (action) {
					case 'follow':
						if ('userId' in data.body) await swos.api('following/create', loginId, { userId: data.body.userId });
						break;
					case 'showUser':
						if ('user' in data.body) client = await swos.openUser(Misskey.acct.toString(data.body.user), loginId);
						break;
					case 'reply':
						if ('note' in data.body) client = await swos.openPost({ reply: data.body.note }, loginId);
						break;
					case 'renote':
						if ('note' in data.body) await swos.api('notes/create', loginId, { renoteId: data.body.note.id });
						break;
					case 'accept':
						switch (data.body.type) {
							case 'receiveFollowRequest':
								await swos.api('following/requests/accept', loginId, { userId: data.body.userId });
								break;
						}
						break;
					case 'reject':
						switch (data.body.type) {
							case 'receiveFollowRequest':
								await swos.api('following/requests/reject', loginId, { userId: data.body.userId });
								break;
						}
						break;
					case 'showFollowRequests':
						client = await swos.openClient('push', '/my/follow-requests', loginId);
						break;
					case 'edited':
						if ('note' in data.body) client = await swos.openPost({ reply: data.body.note }, loginId);
						break;
					default:
						switch (data.body.type) {
							case 'receiveFollowRequest':
								client = await swos.openClient('push', '/my/follow-requests', loginId);
								break;
							case 'reaction':
								client = await swos.openNote(data.body.note.id, loginId);
								break;
							default:
								if ('note' in data.body) {
									client = await swos.openNote(data.body.note.id, loginId);
								} else if ('user' in data.body) {
									client = await swos.openUser(Misskey.acct.toString(data.body.user), loginId);
								}
								break;
						}
				}
				break;
			case 'unreadAntennaNote':
				client = await swos.openAntenna(data.body.antenna.id, loginId);
				break;
			case 'newChatMessage':
				client = await swos.openChat(data.body, loginId);
				break;
			default:
				switch (action) {
					case 'markAllAsRead':
						await globalThis.registration.getNotifications()
							.then(notifications => notifications.forEach(n => n.tag !== 'read_notification' && n.close()));
						await get<Pick<Misskey.entities.SignupResponse, 'id' | 'token'>[]>('accounts').then(accounts => {
							return Promise.all((accounts ?? []).map(async account => {
								await swos.sendMarkAllAsRead(account.id);
							}));
						});
						break;
					case 'settings':
						client = await swos.openClient('push', '/settings/notifications', loginId);
						break;
				}
		}

		if (client) {
			client.focus();
		}
		if (data.type === 'notification') {
			await swos.sendMarkAllAsRead(loginId);
		}

		notification.close();
	})());
});

globalThis.addEventListener('notificationclose', (ev: ServiceWorkerGlobalScopeEventMap['notificationclose']) => {
	const data: PushNotificationDataMap[keyof PushNotificationDataMap] = ev.notification.data;

	ev.waitUntil((async (): Promise<void> => {
		if (data.type === 'notification') {
			await swos.sendMarkAllAsRead(data.userId);
		}
		return;
	})());
});

globalThis.addEventListener('message', (ev: ServiceWorkerGlobalScopeEventMap['message']) => {
	ev.waitUntil((async (): Promise<void> => {
		if (ev.data === 'clear') {
			await caches.keys().then(cacheNames => Promise.allSettled(
				cacheNames.filter(name => name.startsWith('misskey-static-') || name.startsWith('mk-cache-'))
					.map(name => caches.delete(name)),
			)).catch(() => {});
			return;
		}

		if (typeof ev.data === 'object') {
			const otype = Object.prototype.toString.call(ev.data).slice(8, -1).toLowerCase();

			if (otype === 'object') {
				if (ev.data.msg === 'initialize') {
					// Optional translation fetching must not reject the message event offline.
					await swLang.setLang(ev.data.lang).catch(() => {});
				}
			}
		}
	})());
});

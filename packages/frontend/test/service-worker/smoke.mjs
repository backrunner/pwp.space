/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Standalone browser regression test; no database or production account required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const bundles = {};
for (const version of ['test-v1', 'test-v2']) {
	const result = await build({
		absWorkingDir: new URL('../../../sw/', import.meta.url).pathname,
		entryPoints: ['src/sw.ts'],
		bundle: true,
		write: false,
		format: 'iife',
		target: 'safari18.2',
		define: {
			_VERSION_: JSON.stringify(version), _DEV_: 'false', _ENV_: '"production"',
			_LANGS_: '[]', _PERF_PREFIX_: '"Misskey:"',
		},
	});
	bundles[version] = result.outputFiles[0].text;
}
const legacy = `self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 if (new URL(event.request.url).pathname.startsWith('/assets/')) {
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
 }
});`;

for (const [browserName, browserType] of Object.entries({ webkit, chromium })) {
	let workerVersion = 'test-v1';
	let assetVersion = 'asset-v1';
	let storageFailure = '';
	let offline = false;
	let localeBody = '{}';
	let assetContentType = 'text/javascript';
	const server = createServer((request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		if (request.url === '/sw.js') {
			response.setHeader('Content-Type', 'text/javascript');
			const prefix = storageFailure === 'denied' ? `Object.defineProperty(self, 'caches', { value: {
 open: async () => { throw new Error('storage denied'); },
 keys: async () => { throw new Error('storage denied'); }
}});\n` : storageFailure === 'quota' ? `const openCache = caches.open.bind(caches);
caches.open = async (...args) => {
 const cache = await openCache(...args);
 cache.put = async () => { throw new DOMException('full', 'QuotaExceededError'); };
 return cache;
};\n` : storageFailure === 'write-stall' ? `const openCache = caches.open.bind(caches);
caches.open = async (...args) => {
 const cache = await openCache(...args);
 cache.put = () => new Promise(() => {});
 return cache;
};\n` : '';
			response.end(prefix + (workerVersion === 'broken' ? 'invalid javascript {' : workerVersion === 'legacy' ? legacy : bundles[workerVersion]));
		} else if (request.url.startsWith('/assets/locales/')) {
			response.setHeader('Content-Type', 'application/json');
			response.end(localeBody);
		} else if (request.url.startsWith('/assets/') || request.url.startsWith('/vite/') || request.url.startsWith('/api/')) {
			if (request.url === '/api/failure/') response.statusCode = 503;
			if (request.url === '/vite/scripts/http-poisoned-12345678.js') response.setHeader('Cache-Control', 'max-age=3600');
			response.setHeader('Content-Type', assetContentType);
			response.end(assetVersion);
		} else if (offline) {
			response.destroy();
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end('<!doctype html><title>SW smoke</title><body>Online</body>');
		}
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const browser = await browserType.launch();
	const contexts = [];
	const newPage = async () => {
		const context = await browser.newContext();
		contexts.push(context);
		const page = await context.newPage();
		await page.goto(origin);
		return page;
	};
	const register = async page => {
		await page.evaluate(async () => {
			await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
			await navigator.serviceWorker.ready;
		});
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
	};
	const requestText = (page, path, options) => page.evaluate(async ({ path, options }) => (await fetch(path, options)).text(), { path, options });
	const waitForCached = (page, path, body) => page.waitForFunction(async ({ path, body }) => {
		const cached = await caches.match(path);
		return cached && await cached.text() === body;
	}, { path, body });
	try {
		const page = await newPage();
		await page.evaluate(async () => {
			await (await caches.open('misskey-static-legacy')).put('/assets/app.js', new Response('stale'));
			await caches.open('mk-cache-old');
			await caches.open('unrelated-app');
		});
		await register(page);
		const keys = await page.evaluate(() => caches.keys());
		assert(!keys.includes('misskey-static-legacy'));
		assert(!keys.includes('mk-cache-old'));
		assert(keys.includes('unrelated-app'));
		assert.equal(await requestText(page, '/assets/app.js'), 'asset-v1');
		assert.equal(await requestText(page, '/vite/scripts/app-12345678.js'), 'asset-v1');
		assert.equal(await requestText(page, '/vite/en-US/app-12345678.js'), 'asset-v1');
		await waitForCached(page, '/vite/scripts/app-12345678.js', 'asset-v1');
		await waitForCached(page, '/vite/en-US/app-12345678.js', 'asset-v1');
		assetVersion = 'asset-v2';
		assert.equal(await requestText(page, '/assets/app.js'), 'asset-v2');
		assert.equal(await requestText(page, '/vite/scripts/app-12345678.js'), 'asset-v1');
		assert.equal(await requestText(page, '/vite/en-US/app-12345678.js'), 'asset-v1');
		assert.equal(await requestText(page, '/vite/scripts/app-abcdefgh.js'), 'asset-v2');
		assert.equal(await requestText(page, '/api/example/', { headers: { Accept: 'text/html' } }), 'asset-v2');
		assert.equal(await page.evaluate(async () => (await fetch('/api/failure/', { headers: { Accept: 'text/html' } })).status), 503);
		assert.equal(await requestText(page, '/vite/scripts/app-12345678.js', { method: 'POST' }), 'asset-v2');
		console.log(`${browserName}: cache isolation, mutable assets, GET-only cache and API bypass PASS`);

		assert.equal(await requestText(page, '/vite/scripts/app-12345678.js', { cache: 'reload' }), 'asset-v2');
		await waitForCached(page, '/vite/scripts/app-12345678.js', 'asset-v2');
		assert.equal(await requestText(page, '/vite/en-US/app-12345678.js', { cache: 'no-cache' }), 'asset-v2');
		await waitForCached(page, '/vite/en-US/app-12345678.js', 'asset-v2');
		assetVersion = 'asset-v3';
		assert.equal(await requestText(page, '/vite/scripts/app-12345678.js', { cache: 'no-store' }), 'asset-v3');
		assert.equal(await requestText(page, '/vite/scripts/app-12345678.js'), 'asset-v2');
		assert.equal(await requestText(page, '/vite/scripts/uncached-12345678.js', { cache: 'no-store' }), 'asset-v3');
		assert.equal(await page.evaluate(async () => !!await caches.match('/vite/scripts/uncached-12345678.js')), false);
		assetVersion = 'asset-v2';
		console.log(`${browserName}: reload/no-cache refresh entries, no-store bypasses reads and writes PASS`);

		await page.evaluate(async () => {
			const cache = await caches.open('misskey-static-v2-test-v1');
			await cache.put('/vite/scripts/poisoned-12345678.js', new Response('<html>Error</html>', { headers: { 'content-type': 'text/html' } }));
			await cache.put('/vite/scripts/failed-12345678.js', new Response('unavailable', { status: 503, headers: { 'content-type': 'text/javascript' } }));
		});
		assert.equal(await requestText(page, '/vite/scripts/poisoned-12345678.js'), 'asset-v2');
		assert.equal(await requestText(page, '/vite/scripts/failed-12345678.js'), 'asset-v2');
		await waitForCached(page, '/vite/scripts/poisoned-12345678.js', 'asset-v2');
		assetContentType = 'text/html';
		await requestText(page, '/vite/scripts/transient-12345678.js');
		assert.equal(await page.evaluate(async () => !!await caches.match('/vite/scripts/transient-12345678.js')), false);
		assetVersion = 'cached HTML error';
		await requestText(page, '/vite/scripts/http-poisoned-12345678.js');
		await page.evaluate(async () => {
			await (await caches.open('misskey-static-v2-test-v1')).put('/vite/scripts/http-poisoned-12345678.js', new Response('cached HTML error', { headers: { 'content-type': 'text/html' } }));
		});
		assetVersion = 'asset-v2';
		assetContentType = 'text/javascript';
		assert.equal(await requestText(page, '/vite/scripts/http-poisoned-12345678.js'), 'asset-v2');
		assert.equal(await requestText(page, '/vite/scripts/transient-12345678.js'), 'asset-v2');
		console.log(`${browserName}: poisoned cache entries recover and HTML errors are not cached as scripts PASS`);

		workerVersion = 'broken';
		assert(await page.evaluate(async () => {
			try {
				await (await navigator.serviceWorker.getRegistration()).update();
				return false;
			} catch {
				return true;
			}
		}));
		assert.equal(await requestText(page, '/assets/app.js'), 'asset-v2');
		console.log(`${browserName}: invalid worker update preserves working client PASS`);

		const sibling = await page.context().newPage();
		await sibling.goto(origin);
		await sibling.waitForFunction(() => navigator.serviceWorker.controller !== null);
		workerVersion = 'test-v2';
		await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
		await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state === 'installed');
		await page.close();
		assert(await sibling.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting !== null));
		await sibling.close();
		const reopened = await page.context().newPage();
		await reopened.goto(origin);
		await register(reopened);
		await reopened.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()).waiting);
		await requestText(reopened, '/vite/scripts/app-abcdefgh.js');
		assert((await reopened.evaluate(() => caches.keys())).includes('misskey-static-v2-test-v2'));
		assert(!(await reopened.evaluate(() => caches.keys())).includes('misskey-static-v2-test-v1'));
		offline = true;
		await reopened.goto(`${origin}/offline-test`);
		await reopened.waitForSelector('button');
		assert((await reopened.locator('body').innerText()).includes('Could not connect to server'));
		offline = false;
		console.log(`${browserName}: two-tab breaking update waits, relaunch activates and offline navigation PASS`);

		workerVersion = 'legacy';
		const migration = await newPage();
		await register(migration);
		workerVersion = 'test-v2';
		await migration.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
		await migration.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state === 'installed');
		await migration.close();
		const migrated = await migration.context().newPage();
		await migrated.goto(origin);
		await register(migrated);
		await migrated.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration()).waiting);
		console.log(`${browserName}: legacy skipWaiting worker migration PASS`);

		const corruptLocale = await newPage();
		await register(corruptLocale);
		await corruptLocale.evaluate(async () => {
			await (await caches.open('mk-cache-test-v2')).put('/assets/locales/en-US.test-v2.json', new Response('{broken'));
		});
		localeBody = JSON.stringify({ _offlineScreen: { header: 'Recovered translation' } });
		offline = true;
		await corruptLocale.goto(`${origin}/offline-corrupt-locale`);
		assert((await corruptLocale.locator('body').innerText()).includes('Recovered translation'));
		offline = false;
		const retryLocale = await newPage();
		await register(retryLocale);
		localeBody = '{invalid network JSON';
		offline = true;
		await retryLocale.goto(`${origin}/offline-locale-first-attempt`);
		assert((await retryLocale.locator('body').innerText()).includes('Could not connect to server'));
		assert.equal(await retryLocale.evaluate(async () => !!await caches.match('/assets/locales/en-US.test-v2.json')), false);
		localeBody = JSON.stringify({ _offlineScreen: { header: 'Recovered after retry' } });
		await retryLocale.goto(`${origin}/offline-locale-second-attempt`);
		assert((await retryLocale.locator('body').innerText()).includes('Recovered after retry'));
		offline = false;
		localeBody = '{}';
		console.log(`${browserName}: corrupt locale cache and failed locale fetch recover without a worker restart PASS`);

		await migrated.evaluate(async () => {
			await caches.open('misskey-static-clear-test');
			await caches.open('mk-cache-clear-test');
			await caches.open('unrelated-app');
			navigator.serviceWorker.controller.postMessage('clear');
		});
		await migrated.waitForFunction(async () => (await caches.keys()).every(name => !name.startsWith('mk-cache-') && !name.startsWith('misskey-static-')));
		assert((await migrated.evaluate(() => caches.keys())).includes('unrelated-app'));

		storageFailure = 'denied';
		const denied = await newPage();
		await register(denied);
		assert.equal(await requestText(denied, '/vite/scripts/app-12345678.js'), 'asset-v2');
		offline = true;
		await denied.goto(`${origin}/offline-storage-denied`);
		assert((await denied.locator('body').innerText()).includes('Could not connect to server'));
		console.log(`${browserName}: CacheStorage denial still activates, fetches and shows offline fallback PASS`);
		offline = false;
		storageFailure = 'quota';
		const quota = await newPage();
		await register(quota);
		assert.equal(await requestText(quota, '/vite/scripts/app-12345678.js'), 'asset-v2');
		assert.equal(await requestText(quota, '/vite/scripts/app-12345678.js'), 'asset-v2');
		console.log(`${browserName}: cache write quota failures preserve network responses PASS`);

		storageFailure = 'write-stall';
		const stalled = await newPage();
		await register(stalled);
		const stalledResponse = await stalled.evaluate(async () => Promise.race([
			fetch('/vite/scripts/app-12345678.js').then(response => response.text()),
			new Promise(resolve => setTimeout(() => resolve('timed out waiting for Cache.put'), 3000)),
		]));
		assert.equal(stalledResponse, 'asset-v2');
		offline = true;
		await stalled.goto(`${origin}/offline-cache-write-stall`, { timeout: 5000 });
		assert((await stalled.locator('body').innerText()).includes('Could not connect to server'));
		offline = false;
		console.log(`${browserName}: stalled cache writes do not delay assets or offline navigation PASS`);
	} finally {
		await Promise.all(contexts.map(context => context.close()));
		await browser.close();
		await new Promise(resolve => server.close(resolve));
	}
}

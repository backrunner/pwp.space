/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang } from '@@/js/config.js';

let initialized = false;
let listening = false;
let registration: ServiceWorkerRegistration | undefined;
let updating = false;
let lastUpdateCheck = -Infinity;

async function checkForUpdate(force = false) {
	if (navigator.onLine === false) return;
	if (!initialized) return initializeSw();
	if (!registration || updating || (!force && Date.now() - lastUpdateCheck < 60_000)) return;

	updating = true;
	lastUpdateCheck = Date.now();
	try {
		await registration.update();
	} catch (error) {
		console.warn('Service worker update check failed', error);
	} finally {
		updating = false;
	}
}

function initializeController() {
	try {
		(navigator.serviceWorker.controller ?? registration?.active)?.postMessage({
			msg: 'initialize',
			lang,
		});
	} catch (error) {
		// A controller can become redundant between lookup and postMessage.
		console.warn('Service worker initialization failed', error);
	}
}

export async function initializeSw() {
	if (!('serviceWorker' in navigator) || initialized) return;
	initialized = true;

	try {
		if (!listening) {
			navigator.serviceWorker.addEventListener('controllerchange', initializeController);
			window.addEventListener('online', () => { void checkForUpdate(true); });
			// Install recovery listeners even when the initial registration fails.
			window.document.addEventListener('visibilitychange', () => {
				if (window.document.visibilityState === 'visible') void checkForUpdate();
			});
			listening = true;
		}
		registration = await navigator.serviceWorker.register('/sw.js', {
			scope: '/',
			type: 'classic',
			updateViaCache: 'none',
		});
		void navigator.serviceWorker.ready.then(initializeController).catch(error => {
			console.warn('Service worker initialization failed', error);
		});
	} catch (error) {
		initialized = false;
		console.warn('Service worker registration failed', error);
	}
}

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@@/js/config.js', () => ({ lang: 'en-US' }));

const removeListeners: (() => void)[] = [];
beforeEach(() => {
	vi.resetModules();
	// Module resets do not remove listeners from happy-dom's shared document.
	const targets: EventTarget[] = [window, window.document];
	for (const target of targets) {
		const addEventListener = target.addEventListener.bind(target);
		vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
			addEventListener(type, listener, options);
			removeListeners.push(() => target.removeEventListener(type, listener, options));
		});
	}
});
afterEach(() => {
	for (const remove of removeListeners.splice(0)) remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function setup() {
	const active = { postMessage: vi.fn() };
	const registration = { active, update: vi.fn().mockResolvedValue(undefined) };
	const serviceWorker = Object.assign(new EventTarget(), {
		controller: null as typeof active | null,
		register: vi.fn().mockResolvedValue(registration),
		ready: Promise.resolve(registration),
	});
	vi.stubGlobal('navigator', { serviceWorker, onLine: true });
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	return { active, registration, serviceWorker };
}

describe('service worker initialization', () => {
	test('bypasses the HTTP cache and sends language to the active worker', async () => {
		const { active, serviceWorker } = setup();
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		await initializeSw();
		expect(serviceWorker.register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/', type: 'classic', updateViaCache: 'none' });
		expect(active.postMessage).toHaveBeenCalledWith({ msg: 'initialize', lang: 'en-US' });
	});

	test('initializes the new controller without reloading the page', async () => {
		const { serviceWorker } = setup();
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		const controller = { postMessage: vi.fn() };
		serviceWorker.controller = controller;
		serviceWorker.dispatchEvent(new Event('controllerchange'));
		expect(controller.postMessage).toHaveBeenCalledWith({ msg: 'initialize', lang: 'en-US' });
	});

	test('checks updates on foreground resume and catches offline rejection', async () => {
		const { registration } = setup();
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		registration.update.mockRejectedValue(new Error('offline'));
		vi.spyOn(window.document, 'visibilityState', 'get').mockReturnValue('visible');
		window.document.dispatchEvent(new Event('visibilitychange'));
		await Promise.resolve();
		expect(registration.update).toHaveBeenCalledOnce();
		expect(console.warn).toHaveBeenCalledWith('Service worker update check failed', expect.any(Error));
	});

	test('catches registration denial and allows a later retry', async () => {
		const { serviceWorker } = setup();
		serviceWorker.register.mockRejectedValueOnce(new Error('denied'));
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await expect(initializeSw()).resolves.toBeUndefined();
		await initializeSw();
		expect(serviceWorker.register).toHaveBeenCalledTimes(2);
	});

	test('retries failed registration when the network returns', async () => {
		const { serviceWorker } = setup();
		serviceWorker.register.mockRejectedValueOnce(new Error('offline'));
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		window.dispatchEvent(new Event('online'));
		await vi.waitFor(() => expect(serviceWorker.register).toHaveBeenCalledTimes(2));
	});

	test('coalesces resume checks, skips offline checks and retries on reconnect', async () => {
		const { registration } = setup();
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		vi.spyOn(window.document, 'visibilityState', 'get').mockReturnValue('visible');
		let completeUpdate!: () => void;
		registration.update.mockImplementationOnce(() => new Promise<void>(resolve => { completeUpdate = resolve; }));
		window.document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('online'));
		expect(registration.update).toHaveBeenCalledOnce();
		completeUpdate();
		await Promise.resolve();
		window.document.dispatchEvent(new Event('visibilitychange'));
		expect(registration.update).toHaveBeenCalledOnce();
		Object.assign(navigator, { onLine: false });
		window.dispatchEvent(new Event('online'));
		expect(registration.update).toHaveBeenCalledOnce();
		Object.assign(navigator, { onLine: true });
		window.dispatchEvent(new Event('online'));
		expect(registration.update).toHaveBeenCalledTimes(2);
	});

	test('contains controller messaging errors during startup and activation', async () => {
		const { active, serviceWorker } = setup();
		active.postMessage.mockImplementation(() => { throw new Error('redundant worker'); });
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await expect(initializeSw()).resolves.toBeUndefined();
		expect(() => serviceWorker.dispatchEvent(new Event('controllerchange'))).not.toThrow();
		expect(console.warn).toHaveBeenCalledWith('Service worker initialization failed', expect.any(Error));
	});

	test('allows browsers without service worker support to boot', async () => {
		vi.stubGlobal('navigator', {});
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await expect(initializeSw()).resolves.toBeUndefined();
	});

	test('allows startup when access to the service worker container is denied', async () => {
		setup();
		vi.stubGlobal('navigator', Object.defineProperty({}, 'serviceWorker', {
			get() { throw new DOMException('denied', 'SecurityError'); },
		}));
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await expect(initializeSw()).resolves.toBeUndefined();
		expect(console.warn).toHaveBeenCalledWith('Service worker registration failed', expect.any(DOMException));
	});
});

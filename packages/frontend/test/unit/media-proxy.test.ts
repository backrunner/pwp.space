/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type * as Misskey from 'misskey-js';
import { getProxySign, MediaProxy } from '@@/js/media-proxy.js';

const instanceUrl = 'https://local.example';
const mediaProxy = new MediaProxy({
	mediaProxy: 'https://media.example/proxy',
	mediaProxyKey: 'hashed-key',
} as Misskey.entities.MetaDetailed, instanceUrl);

describe('MediaProxy', () => {
	test('routes dynamic images through the configured proxy with a signature', () => {
		const proxied = new URL(mediaProxy.getProxiedImageUrl('https://remote.example/image.png', 'preview'));

		expect(proxied.origin).toBe('https://media.example');
		expect(proxied.pathname).toBe('/proxy/preview.webp');
		expect(proxied.searchParams.get('url')).toBe('https://remote.example/image.png');
		expect(proxied.searchParams.get('preview')).toBe('1');
		expect(proxied.searchParams.get('sign')).toBe(getProxySign('https://remote.example/image.png', 'hashed-key'));
	});

	test('unwraps relative proxy URLs against the instance URL', () => {
		const proxied = new URL(mediaProxy.getProxiedImageUrl('/proxy/image.webp?url=https%3A%2F%2Fremote.example%2Foriginal.png'));

		expect(proxied.searchParams.get('url')).toBe('https://remote.example/original.png');
		expect(proxied.searchParams.has('sign')).toBe(true);
	});

	test('routes static images through the configured proxy with a signature', () => {
		const proxied = new URL(mediaProxy.getStaticImageUrl('https://remote.example/image.png'));

		expect(proxied.origin).toBe('https://media.example');
		expect(proxied.pathname).toBe('/proxy/static.webp');
		expect(proxied.searchParams.get('sign')).toBe(getProxySign('https://remote.example/image.png', 'hashed-key'));
	});
});

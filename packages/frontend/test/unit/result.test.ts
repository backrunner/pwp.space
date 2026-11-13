/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import MkResult from '@/components/global/MkResult.vue';
import MkSystemIcon from '@/components/global/MkSystemIcon.vue';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';

vi.mock('@/instance.js', async () => {
	const { reactive } = await import('vue');
	return { instance: reactive({ infoImageUrl: null, notFoundImageUrl: null, serverErrorImageUrl: null }) };
});

const states = [
	{ type: 'empty', imageKey: 'infoImageUrl', textKey: 'nothing' },
	{ type: 'notFound', imageKey: 'notFoundImageUrl', textKey: 'notFound' },
	{ type: 'error', imageKey: 'serverErrorImageUrl', textKey: 'somethingHappened' },
] as const;

function renderResult(type: typeof states[number]['type'] = 'empty') {
	return render(MkResult, {
		props: { type },
		slots: { default: '<button>Retry</button>' },
		global: { components: { MkSystemIcon } },
	});
}

beforeEach(() => {
	instance.infoImageUrl = null;
	instance.notFoundImageUrl = null;
	instance.serverErrorImageUrl = null;
});

afterEach(cleanup);

describe('Result images', () => {
	test.each(states)('$type keeps its message and actions when the image fails', async ({ type, imageKey, textKey }) => {
		instance[imageKey] = '/missing-result.svg';
		const view = renderResult(type);
		const image = view.container.querySelector('img');
		expect(image?.getAttribute('src')).toBe('/missing-result.svg');
		expect(view.container.querySelector('svg')).toBeNull();
		await fireEvent.error(image!);
		expect(view.container.querySelector('img')).toBeNull();
		expect(view.container.querySelector('svg')).not.toBeNull();
		expect(view.getByText(i18n.ts[textKey])).toBeTruthy();
		expect(view.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});

	test.each(states)('$type uses its built-in icon without a custom image', ({ type, textKey }) => {
		const view = renderResult(type);
		expect(view.container.querySelector('img')).toBeNull();
		expect(view.container.querySelector('svg')).not.toBeNull();
		expect(view.getByText(i18n.ts[textKey])).toBeTruthy();
	});

	test('tries a replacement URL after an image failure', async () => {
		instance.infoImageUrl = '/missing-result.svg';
		const view = renderResult();
		await fireEvent.error(view.container.querySelector('img')!);
		instance.infoImageUrl = '/replacement.svg';
		await nextTick();
		const image = view.container.querySelector('img');
		expect(image?.getAttribute('src')).toBe('/replacement.svg');
		await fireEvent.load(image!);
		expect(view.container.querySelector('img')).toBe(image);
		expect(view.container.querySelector('svg')).toBeNull();
	});

	test('tries the next state image after the previous state failed', async () => {
		instance.infoImageUrl = '/empty.svg';
		instance.serverErrorImageUrl = '/error.svg';
		const view = renderResult();
		await fireEvent.error(view.container.querySelector('img')!);
		await view.rerender({ type: 'error', text: 'Custom error' });
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/error.svg');
		expect(view.getByText('Custom error')).toBeTruthy();
	});
});

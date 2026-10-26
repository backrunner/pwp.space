/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import { afterEach, describe, expect, test } from 'vitest';
import { createMfmRenderer } from '@@/js/mfm-renderer.js';

afterEach(cleanup);

const placeholder = defineComponent(() => () => h('span'));
const components = {
	Url: placeholder,
	Link: placeholder,
	Mention: placeholder,
	A: placeholder,
	Time: placeholder,
	Emoji: placeholder,
	CustomEmoji: placeholder,
};

const Formula = defineComponent({
	props: { formula: String, block: Boolean },
	setup: props => () => h(props.block ? 'div' : 'span', { class: 'formula' }, props.formula),
});

describe('shared MFM formula rendering', () => {
	test.each([
		{ text: '\\(x^2\\)', block: false },
		{ text: '\\[x^2\\]', block: true },
	])('renders $text using the frontend formula component', ({ text, block }) => {
		const Renderer = createMfmRenderer({ components: () => ({ ...components, Formula }) });
		const { container } = render(Renderer, { props: { text } });

		expect(container.querySelector('bdi')?.classList.contains('block')).toBe(block);
		expect(container.querySelector(block ? 'bdi > div.formula' : 'bdi > span.formula')?.textContent).toBe('x^2');
		expect(container.querySelector('code')).toBeNull();
	});

	test.each(['\\(x^2\\)', '\\[x^2\\]'])('keeps the embed code fallback for %s', (text) => {
		const Renderer = createMfmRenderer({ components: () => components });
		const { container } = render(Renderer, { props: { text } });

		expect(container.querySelector('code')?.textContent).toBe('x^2');
		expect(container.querySelector('bdi')).toBeNull();
	});
});

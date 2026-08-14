/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import MkFormula from './MkFormula.vue';

export const Inline = {
	render(args) {
		return {
			components: { MkFormula },
			setup() {
				return { args };
			},
			template: '<MkFormula v-bind="args" />',
		};
	},
	args: {
		formula: String.raw`E = mc^2`,
		block: false,
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkFormula>;

export const Block = {
	...Inline,
	args: {
		...Inline.args,
		formula: String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}`,
		block: true,
	},
} satisfies StoryObj<typeof MkFormula>;

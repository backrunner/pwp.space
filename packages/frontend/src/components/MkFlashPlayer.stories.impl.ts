/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import { file } from '../../.storybook/fakes.js';
import MkFlashPlayer from './MkFlashPlayer.vue';

export const Default = {
	render(args) {
		return {
			components: { MkFlashPlayer },
			setup() {
				return { args };
			},
			template: '<div style="width: 480px"><MkFlashPlayer v-bind="args" /></div>',
		};
	},
	args: {
		flashFile: {
			...file(true),
			name: 'example.swf',
			type: 'application/x-shockwave-flash',
		},
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkFlashPlayer>;

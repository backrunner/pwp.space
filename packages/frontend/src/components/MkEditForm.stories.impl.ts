/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { action } from 'storybook/actions';
import type { StoryObj } from '@storybook/vue3';
import { HttpResponse, http } from 'msw';
import { note } from '../../.storybook/fakes.js';
import { commonHandlers } from '../../.storybook/mocks.js';
import MkEditForm from './MkEditForm.vue';

export const Default = {
	render(args) {
		return {
			components: { MkEditForm },
			setup() {
				return { args };
			},
			computed: {
				props() {
					return { ...this.args };
				},
				events() {
					return {
						posted: action('posted'),
						cancel: action('cancel'),
						esc: action('esc'),
					};
				},
			},
			template: '<MkEditForm v-bind="props" v-on="events" />',
		};
	},
	args: {
		target: note(),
		autofocus: false,
	},
	parameters: {
		layout: 'padded',
		msw: {
			handlers: [
				...commonHandlers,
				http.post('/api/notes/update', async ({ request }) => {
					action('POST /api/notes/update')(await request.json());
					return new HttpResponse(null, { status: 204 });
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkEditForm>;

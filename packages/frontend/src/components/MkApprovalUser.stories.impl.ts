/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { action } from 'storybook/actions';
import type { StoryObj } from '@storybook/vue3';
import { HttpResponse, http } from 'msw';
import { userDetailed } from '../../.storybook/fakes.js';
import { commonHandlers } from '../../.storybook/mocks.js';
import MkApprovalUser from './MkApprovalUser.vue';

export const Default = {
	render(args) {
		return {
			components: { MkApprovalUser },
			setup() {
				return { args };
			},
			computed: {
				props() {
					return { ...this.args };
				},
				events() {
					return {
						deleted: action('deleted'),
					};
				},
			},
			template: '<MkApprovalUser v-bind="props" v-on="events" />',
		};
	},
	args: {
		user: userDetailed('pending-user', 'pending', null, 'Pending User'),
	},
	parameters: {
		layout: 'padded',
		msw: {
			handlers: [
				...commonHandlers,
				http.post('/api/admin/show-user', () => {
					return HttpResponse.json({
						email: 'pending@example.com',
						signupReason: 'I would like to join this community.',
					});
				}),
				http.post('/api/admin/approve-user', async ({ request }) => {
					action('POST /api/admin/approve-user')(await request.json());
					return HttpResponse.json({});
				}),
				http.post('/api/admin/delete-account', async ({ request }) => {
					action('POST /api/admin/delete-account')(await request.json());
					return HttpResponse.json({});
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkApprovalUser>;

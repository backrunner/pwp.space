/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import { userDetailed } from '../../.storybook/fakes.js';
import MkNoteHistory from './MkNoteHistory.vue';

export const Default = {
	render(args) {
		return {
			components: { MkNoteHistory },
			setup() {
				return { args };
			},
			template: '<MkNoteHistory v-bind="args" />',
		};
	},
	args: {
		text: 'This is the previous version of the note.',
		targetId: 'note-id',
		updatedAt: new Date('2026-08-12T00:00:00.000Z'),
		files: [],
		emojis: {},
		cw: null,
		user: userDetailed('author', 'author', null, 'Note Author'),
	},
	parameters: {
		layout: 'padded',
	},
} satisfies StoryObj<typeof MkNoteHistory>;

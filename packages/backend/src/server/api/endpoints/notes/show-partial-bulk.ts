/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { QueryService } from '@/core/QueryService.js';
import type { NotesRepository } from '@/models/_.js';
import { MiMeta } from '@/models/Meta.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['notes'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					optional: false, nullable: false,
				},
				updatedAt: {
					type: 'string',
					optional: false, nullable: true,
					format: 'date-time',
				},
				reactions: {
					type: 'object',
					optional: false, nullable: false,
					additionalProperties: {
						type: 'number',
					},
				},
				reactionEmojis: {
					type: 'object',
					optional: false, nullable: false,
					additionalProperties: {
						type: 'string',
					},
				},
			},
		},
	},

	errors: {
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteIds: { type: 'array', items: { type: 'string', format: 'misskey:id' }, maxItems: 100, minItems: 1 },
	},
	required: ['noteIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private queryService: QueryService,
		private noteEntityService: NoteEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (me == null && this.serverSettings.ugcVisibilityForVisitor === 'none') return [];

			const query = this.notesRepository.createQueryBuilder('note')
				.innerJoinAndSelect('note.user', 'user')
				.select([
					'note.id',
					'note.updatedAt',
					'note.userId',
					'note.userHost',
					'note.visibility',
					'note.visibleUserIds',
					'note.mentions',
					'note.replyUserId',
					'user.id',
					'user.requireSigninToViewContents',
					'user.makeNotesFollowersOnlyBefore',
					'user.makeNotesHiddenBefore',
				])
				.where('note.id IN (:...noteIds)', { noteIds: ps.noteIds });

			this.queryService.generateVisibilityQuery(query, me);

			if (me == null) {
				query.andWhere('user.requireSigninToViewContents = false');
				if (this.serverSettings.ugcVisibilityForVisitor === 'local') {
					query.andWhere('note.userHost IS NULL');
				}
			}

			const visibleNotes = await query.getMany();
			const visibleNoteIds: string[] = [];
			for (const note of visibleNotes) {
				if (await this.noteEntityService.isNoteContentVisibleByUserPolicy(note, me?.id ?? null)) {
					visibleNoteIds.push(note.id);
				}
			}

			return await this.noteEntityService.fetchDiffs(visibleNoteIds);
		});
	}
}

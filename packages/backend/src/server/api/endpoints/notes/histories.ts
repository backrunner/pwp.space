/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteHistoryEntityService } from '@/core/entities/NoteHistoryEntityService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { GetterService } from '@/server/api/GetterService.js';
import type { NoteHistoriesRepository } from '@/models/_.js';
import { MiMeta } from '@/models/Meta.js';
import { DI } from '@/di-symbols.js';
import { QueryService } from '@/core/QueryService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: false,

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'NoteHistory',
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '65776587-1e50-46c3-9825-f4d8dd17efcf',
		},
		contentRestrictedByUser: {
			message: 'Content restricted by user. Please sign in to view.',
			code: 'CONTENT_RESTRICTED_BY_USER',
			id: '4d88424f-0b20-41e2-95df-b40a8142c47c',
		},
		contentRestrictedByServer: {
			message: 'Content restricted by server settings. Please sign in to view.',
			code: 'CONTENT_RESTRICTED_BY_SERVER',
			id: '9f9dc5b9-e916-4a41-aff5-bb6269fbbb91',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		noteId: { type: 'string', format: 'misskey:id' },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.noteHistoriesRepository)
		private noteHistoriesRepository: NoteHistoriesRepository,

		private queryService: QueryService,
		private noteEntityService: NoteEntityService,
		private noteHistoryEntityService: NoteHistoryEntityService,
		private getterService: GetterService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const q = this.queryService.makePaginationQuery(this.noteHistoriesRepository.createQueryBuilder('noteHistory'), ps.sinceId, ps.untilId);
			const note = await this.getterService.getNoteWithRelations(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});
			if (note.user == null) throw new Error('Note author relation was not loaded.');

			if (note.user.requireSigninToViewContents && me == null) {
				throw new ApiError(meta.errors.contentRestrictedByUser);
			}

			if (this.serverSettings.ugcVisibilityForVisitor === 'none' && me == null) {
				throw new ApiError(meta.errors.contentRestrictedByServer);
			}

			if (this.serverSettings.ugcVisibilityForVisitor === 'local' && note.userHost != null && me == null) {
				throw new ApiError(meta.errors.contentRestrictedByServer);
			}

			if (
				!await this.noteEntityService.isVisibleForMe(note, me?.id ?? null) ||
				!await this.noteEntityService.isNoteContentVisibleByUserPolicy(note, me?.id ?? null)
			) {
				throw new ApiError(meta.errors.noSuchNote);
			}

			q.andWhere('noteHistory.targetId = :targetId', { targetId: note.id });
			const histories = await q.limit(ps.limit).getMany();
			return await this.noteHistoryEntityService.packMany(histories, me, {
				detail: true,
				skipHide: true,
			});
		});
	}
}

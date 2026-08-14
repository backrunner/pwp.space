/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { isEqual } from 'lodash-es';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { DriveFilesRepository, UsersRepository } from '@/models/_.js';
import { NoteEditService } from '@/core/NoteEditService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import { RoleService } from '@/core/RoleService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'write:notes',

	limit: {
		duration: ms('1hour'),
		max: 10,
		minInterval: ms('2min'),
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '47a99933-dedf-4c7e-94d4-1c8574ff6ef4',
		},
		accessDenied: {
			message: 'Access denied.',
			code: 'ACCESS_DENIED',
			id: '1e19af52-946d-42d5-9440-4104938c5b1b',
		},
		cannotEditNote: {
			message: 'Editing notes are not allowed by the role policy.',
			code: 'CANNOT_EDIT_NOTE',
			id: '15f34c0a-57d6-404e-bc40-6e7c07db88fe',
		},
		containsProhibitedWords: {
			message: 'Cannot post because it contains prohibited words.',
			code: 'CONTAINS_PROHIBITED_WORDS',
			id: '18f9acb5-112a-4c7e-8ccd-89e333f5a8c9',
		},
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: '115dd131-af41-4e96-a1b4-d4194e19e3b7',
		},
		invalidNoteContent: {
			message: 'A note must contain text, a file, a poll, or a renote.',
			code: 'INVALID_NOTE_CONTENT',
			id: '364ae9ca-0815-40b1-b49d-59d3135f0c68',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		text: {
			type: 'string',
			minLength: 1,
			maxLength: MAX_NOTE_TEXT_LENGTH,
			pattern: '[^\\s]+',
			nullable: true,
		},
		cw: {
			type: 'string',
			nullable: true,
			maxLength: 100,
		},
		fileIds: {
			type: 'array',
			uniqueItems: true,
			minItems: 0,
			maxItems: 16,
			items: { type: 'string', format: 'misskey:id' },
		},
	},
	required: ['noteId', 'text', 'cw'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private getterService: GetterService,
		private noteEditService: NoteEditService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			const canOverrideAuthor = await this.roleService.isModerator(me);
			if (canOverrideAuthor && note.userHost !== null) {
				throw new ApiError(meta.errors.accessDenied);
			}
			if (!canOverrideAuthor) {
				if (note.userId !== me.id) {
					throw new ApiError(meta.errors.accessDenied);
				} else if ((await this.roleService.getUserPolicies(me.id)).canEditNote !== true) {
					throw new ApiError(meta.errors.cannotEditNote);
				}
			}

			const unorderedCurrentFiles = await this.driveFilesRepository.findBy({ id: In(note.fileIds) });
			const currentFiles = note.fileIds.flatMap(id => {
				const file = unorderedCurrentFiles.find(candidate => candidate.id === id);
				return file == null ? [] : [file];
			});

			let files = currentFiles;
			if (ps.fileIds !== undefined) {
				const requestedFiles = await this.driveFilesRepository.findBy({
					id: In(ps.fileIds),
					userId: note.userId,
				});
				if (requestedFiles.length !== ps.fileIds.length) {
					throw new ApiError(meta.errors.noSuchFile);
				}
				files = ps.fileIds.flatMap(id => {
					const file = requestedFiles.find(candidate => candidate.id === id);
					return file == null ? [] : [file];
				});
			}

			const newEditData = {
				text: ps.text,
				cw: ps.cw,
				files,
			};

			const currentData = {
				text: note.text,
				cw: note.cw,
				files: currentFiles,
			};

			if (isEqual(newEditData, currentData)) {
				return;
			}

			try {
				await this.noteEditService.edit(
					await this.usersRepository.findOneByOrFail({ id: note.userId }),
					note.id,
					newEditData,
					undefined,
					me,
					{
						skipRolePolicyCheck: canOverrideAuthor,
						allowAuthorOverride: canOverrideAuthor,
					},
				);
			} catch (e) {
				if (e instanceof NoteEditService.ContainsProhibitedWordsError) {
					throw new ApiError(meta.errors.containsProhibitedWords);
				}
				if (e instanceof NoteEditService.InvalidNoteContentError) {
					throw new ApiError(meta.errors.invalidNoteContent);
				}
				throw e;
			}
		});
	}
}

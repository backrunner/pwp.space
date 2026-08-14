/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Packed } from '@/misc/json-schema.js';
import { awaitAll } from '@/misc/prelude/await-all.js';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import type { NotesRepository, NoteHistoriesRepository, MiNoteHistory } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import type { OnModuleInit } from '@nestjs/common';
import type { CustomEmojiService } from '../CustomEmojiService.js';
import type { DriveFileEntityService } from './DriveFileEntityService.js';
import type { NoteEntityService } from './NoteEntityService.js';

@Injectable()
export class NoteHistoryEntityService implements OnModuleInit {
	private driveFileEntityService: DriveFileEntityService;
	private customEmojiService: CustomEmojiService;
	private noteEntityService: NoteEntityService;
	private idService: IdService;

	constructor(
		private moduleRef: ModuleRef,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.noteHistoriesRepository)
		private noteHistoriesRepository: NoteHistoriesRepository,
	) {
	}

	onModuleInit() {
		this.driveFileEntityService = this.moduleRef.get('DriveFileEntityService');
		this.customEmojiService = this.moduleRef.get('CustomEmojiService');
		this.noteEntityService = this.moduleRef.get('NoteEntityService');
		this.idService = this.moduleRef.get('IdService');
	}

	@bindThis
	public async pack(
		src: MiNoteHistory['id'] | MiNoteHistory,
		me?: { id: MiUser['id'] } | null | undefined,
		options?: {
			detail?: boolean;
			skipHide?: boolean;
			withReactionAndUserPairCache?: boolean;
			_hint_?: {
				packedFiles: Map<MiNote['fileIds'][number], Packed<'DriveFile'> | null>;
				targetNote: MiNote;
			};
		},
	): Promise<Packed<'NoteHistory'>> {
		const opts = Object.assign({
			detail: true,
			skipHide: false,
			withReactionAndUserPairCache: false,
		}, options);
		const targetHistory = typeof src === 'object' ? src : await this.noteHistoriesRepository.findOneByOrFail({ id: src });
		const targetNote = opts._hint_?.targetNote ?? await this.notesRepository.findOneByOrFail({ id: targetHistory.targetId });
		const meId = me ? me.id : null;
		if (!opts.skipHide && !(await this.noteEntityService.isVisibleForMe(targetNote, meId))) {
			throw new Error('Note is not visible for me');
		}
		const host = targetNote.userHost;

		const packedFiles = opts._hint_?.packedFiles;

		const packed: Packed<'NoteHistory'> = await awaitAll({
			id: targetHistory.id,
			targetId: targetHistory.targetId,
			createdAt: this.idService.parse(targetHistory.id).date.toISOString(),
			text: targetHistory.text,
			cw: targetHistory.cw,
			emojis: host != null ? this.customEmojiService.populateEmojis(targetHistory.emojis, host) : undefined,
			tags: targetHistory.tags.length > 0 ? targetHistory.tags : undefined,
			fileIds: targetHistory.fileIds,
			files: packedFiles ? this.noteEntityService.packAttachedFiles(targetHistory.fileIds, packedFiles) : this.driveFileEntityService.packManyByIds(targetHistory.fileIds),
			mentions: targetHistory.mentions.length > 0 ? targetHistory.mentions : undefined,

			...(opts.detail ? {
				poll: targetHistory.hasPoll ? this.noteEntityService.populatePoll(targetNote, meId) : undefined,
			} : {}),
		});
		return packed;
	}

	@bindThis
	public async packMany(
		noteHistories: MiNoteHistory[],
		me?: { id: MiUser['id'] } | null | undefined,
		options?: {
			detail?: boolean;
			skipHide?: boolean;
		},
	) {
		if (noteHistories.length === 0) return [];
		const targetNotes = await this.notesRepository.findBy({ id: In(noteHistories.map(n => n.targetId)) });
		const targetNotesById = new Map(targetNotes.map(note => [note.id, note]));
		if (!options?.skipHide) {
			for (const targetNote of targetNotes) {
				if (!await this.noteEntityService.isVisibleForMe(targetNote, me?.id ?? null)) {
					throw new Error('Note is not visible for me');
				}
			}
		}
		await this.customEmojiService.prefetchEmojis(this.noteEntityService.aggregateNoteEmojis(targetNotes));
		const fileIds = noteHistories.flatMap(history => history.fileIds);
		const packedFiles = fileIds.length > 0 ? await this.driveFileEntityService.packManyByIdsMap(fileIds) : new Map();

		return await Promise.all(noteHistories.map(nh => {
			const targetNote = targetNotesById.get(nh.targetId);
			if (targetNote == null) throw new Error('History target note not found');
			return this.pack(nh, me, {
			...options,
			skipHide: true,
			_hint_: {
				packedFiles,
				targetNote,
			},
			});
		}));
	}
}

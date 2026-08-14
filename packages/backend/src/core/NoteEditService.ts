
/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setImmediate } from 'node:timers/promises';
import RE2 from 're2';
import * as mfm from 'mfm-js';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { extractCustomEmojisFromMfm } from '@/misc/extract-custom-emojis-from-mfm.js';
import { extractHashtags } from '@/misc/extract-hashtags.js';
import type { IMentionedRemoteUsers } from '@/models/Note.js';
import { MiNote } from '@/models/Note.js';
import { MiNoteHistory } from '@/models/NoteHistory.js';
import type { ChannelsRepository, NotesRepository, UserProfilesRepository, UsersRepository, PollsRepository, DriveFilesRepository } from '@/models/_.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { concat } from '@/misc/prelude/array.js';
import { IdService } from '@/core/IdService.js';
import type { MiUser, MiRemoteUser } from '@/models/User.js';
import type { IPoll } from '@/models/Poll.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import type { MiChannel } from '@/models/Channel.js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { RelayService } from '@/core/RelayService.js';
import { DI } from '@/di-symbols.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserWebhookService } from '@/core/UserWebhookService.js';
import { QueueService } from '@/core/QueueService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { ApDeliverManagerService } from '@/core/activitypub/ApDeliverManagerService.js';
import { bindThis } from '@/decorators.js';
import { DB_MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import { RoleService } from '@/core/RoleService.js';
import { MetaService } from '@/core/MetaService.js';
import { SearchService } from '@/core/SearchService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { cleanLink } from '@/misc/link-cleaner.js';
import { trackPromise } from '@/misc/promise-tracker.js';

const FAST_URL_TESTER = new RE2('https?:\\/\\/');

type MinimumUser = {
	id: MiUser['id'];
	host: MiUser['host'];
	username: MiUser['username'];
	uri: MiUser['uri'];
};

type Option = {
	publishedAt?: Date | null;
	name?: string | null;
	text?: string | null;
	reply?: MiNote | null;
	renote?: MiNote | null;
	files?: MiDriveFile[] | null;
	poll?: IPoll | null;
	reactionAcceptance?: MiNote['reactionAcceptance'];
	cw?: string | null;
	channel?: MiChannel | null;
	apMentions?: MinimumUser[] | MiUser[] | null;
	apHashtags?: string[] | null;
	apEmojis?: string[] | null;
	uri?: string | null;
	url?: string | null;
};

type EditOptions = {
	skipRolePolicyCheck?: boolean;
	allowAuthorOverride?: boolean;
};

@Injectable()
export class NoteEditService implements OnApplicationShutdown {
	#shutdownController = new AbortController();

	public static ContainsProhibitedWordsError = class extends Error { };
	public static InvalidNoteContentError = class extends Error { };

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.channelsRepository)
		private channelsRepository: ChannelsRepository,

		@Inject(DI.pollsRepository)
		private pollsRepository: PollsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private userEntityService: UserEntityService,
		private noteEntityService: NoteEntityService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private queueService: QueueService,
		private relayService: RelayService,
		private apDeliverManagerService: ApDeliverManagerService,
		private apRendererService: ApRendererService,
		private roleService: RoleService,
		private metaService: MetaService,
		private searchService: SearchService,
		private activeUsersChart: ActiveUsersChart,
		private utilityService: UtilityService,
		private userBlockingService: UserBlockingService,
		private moderationLogService: ModerationLogService,
		private userWebhookService: UserWebhookService,
	) { }

	@bindThis
	public async edit(user: {
		id: MiUser['id'];
		username: MiUser['username'];
		host: MiUser['host'];
		isBot: MiUser['isBot'];
		isCat: MiUser['isCat'];
	}, targetId: MiNote['id'], data: Option, silent = false, editor?: MiUser, options?: EditOptions): Promise<MiNote> {
		const targetNote = await this.notesRepository.findOneByOrFail({ id: targetId });

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (targetNote == null) {
			throw new Error('No such note');
		}
		const requester = editor ?? user;
		if (options?.allowAuthorOverride && targetNote.userHost !== null) {
			throw new Error('Remote notes cannot be edited through a local author override');
		}
		if (targetNote.userId !== requester.id && !options?.allowAuthorOverride) {
			throw new Error('The editor is not the note author');
		}

		if (!options?.skipRolePolicyCheck && (await this.roleService.getUserPolicies(user.id)).canEditNote !== true) {
			throw new Error('Edit note is not allowed');
		}

		if (data.reply == null && targetNote.replyId) data.reply = await this.notesRepository.findOneByOrFail({ id: targetNote.replyId });
		if (data.renote == null && targetNote.renoteId) data.renote = await this.notesRepository.findOneByOrFail({ id: targetNote.renoteId });
		if (data.channel == null && targetNote.channelId) data.channel = await this.channelsRepository.findOneByOrFail({ id: targetNote.channelId });

		// チャンネル外にリプライしたら対象のスコープに合わせる
		// (クライアントサイドでやっても良い処理だと思うけどとりあえずサーバーサイドで)
		if (data.reply && data.channel && data.reply.channelId !== data.channel.id) {
			if (data.reply.channelId) {
				data.channel = await this.channelsRepository.findOneBy({ id: data.reply.channelId });
			} else {
				data.channel = null;
			}
		}

		// チャンネル内にリプライしたら対象のスコープに合わせる
		// (クライアントサイドでやっても良い処理だと思うけどとりあえずサーバーサイドで)
		if (data.reply && (data.channel == null) && data.reply.channelId) {
			data.channel = await this.channelsRepository.findOneBy({ id: data.reply.channelId });
		}

		// Poll editing is intentionally unsupported. Keeping the stored poll also
		// preserves votes and the original end-notification job.
		data.poll = targetNote.hasPoll ? await this.pollsRepository.findOneByOrFail({ noteId: targetId }) : null;
		if (data.files === undefined) {
			const unorderedFiles = await this.driveFilesRepository.findBy({ id: In(targetNote.fileIds) });
			data.files = targetNote.fileIds.flatMap(id => {
				const file = unorderedFiles.find(candidate => candidate.id === id);
				return file == null ? [] : [file];
			});
		}
		if (data.name == null) data.name = targetNote.name;
		if (data.reactionAcceptance == null) data.reactionAcceptance = targetNote.reactionAcceptance;
		const meta = await this.metaService.fetch();

		if (this.utilityService.isKeyWordIncluded(data.cw ?? data.text ?? '', meta.prohibitedWords)) {
			throw new NoteEditService.ContainsProhibitedWordsError();
		}

		// Check blocking
		if (data.renote && !this.noteEntityService.isQuote(data)) {
			if (data.renote.userHost === null) {
				if (data.renote.userId !== user.id) {
					const blocked = await this.userBlockingService.checkBlocked(data.renote.userId, user.id);
					if (blocked) {
						throw new Error('blocked');
					}
				}
			}
		}

		if (data.text) {
			if (data.text.length > DB_MAX_NOTE_TEXT_LENGTH) {
				data.text = data.text.slice(0, DB_MAX_NOTE_TEXT_LENGTH);
			}
			data.text = data.text.trim() || null;
			if (data.text && FAST_URL_TESTER.test(data.text)) {
				data.text = await cleanLink(data.text);
			}
		} else {
			data.text = null;
		}

		if (data.text == null && (data.files?.length ?? 0) === 0 && data.poll == null && data.renote == null) {
			throw new NoteEditService.InvalidNoteContentError();
		}

		let tags = data.apHashtags;
		let emojis = data.apEmojis;
		let mentionedUsers = data.apMentions;

		// Parse MFM if needed
		if (!tags || !emojis || !mentionedUsers) {
			const tokens = (data.text ? mfm.parse(data.text)! : []);
			const cwTokens = data.cw ? mfm.parse(data.cw)! : [];
			const choiceTokens = data.poll?.choices
				? concat(data.poll.choices.map(choice => mfm.parse(choice)!))
				: [];

			const combinedTokens = tokens.concat(cwTokens).concat(choiceTokens);

			tags = data.apHashtags ?? extractHashtags(combinedTokens);

			emojis = data.apEmojis ?? extractCustomEmojisFromMfm(combinedTokens);

			mentionedUsers = data.apMentions ?? await this.noteEntityService.ExtractMentionedUsers(user, combinedTokens);
		}

		tags = tags.filter(tag => Array.from(tag).length <= 128).splice(0, 32);

		if (data.reply && (user.id !== data.reply.userId) && !mentionedUsers.some(u => u.id === data.reply!.userId)) {
			mentionedUsers.push(await this.usersRepository.findOneByOrFail({ id: data.reply!.userId }));
		}

		const note = new MiNote({
			id: targetNote.id,
			updatedAt: data.publishedAt ?? new Date(),
			visibility: targetNote.visibility,
			fileIds: data.files ? data.files.map(file => file.id) : [],
			replyId: data.reply ? data.reply.id : null,
			renoteId: data.renote ? data.renote.id : null,
			channelId: data.channel ? data.channel.id : null,
			threadId: data.reply
				? data.reply.threadId
					? data.reply.threadId
					: data.reply.id
				: null,
			name: data.name,
			text: data.text,
			hasPoll: data.poll != null,
			cw: data.cw ?? null,
			tags: tags.map(tag => normalizeForSearch(tag)),
			emojis,
			userId: user.id,
			reactionAcceptance: data.reactionAcceptance,
			attachedFileTypes: data.files ? data.files.map(file => file.type) : [],
			// 以下非正規化データ
			replyUserId: data.reply ? data.reply.userId : null,
			replyUserHost: data.reply ? data.reply.userHost : null,
			renoteUserId: data.renote ? data.renote.userId : null,
			renoteUserHost: data.renote ? data.renote.userHost : null,
			userHost: user.host,
		});

		if (data.uri != null) note.uri = data.uri;
		if (data.url != null) note.url = data.url;

		// Append mentions data
		note.mentions = mentionedUsers.map(u => u.id);
		note.mentionedRemoteUsers = '[]';
		if (note.mentions.length > 0) {
			const profiles = await this.userProfilesRepository.findBy({ userId: In(note.mentions) });
			note.mentionedRemoteUsers = JSON.stringify(mentionedUsers.filter(u => this.userEntityService.isRemoteUser(u)).map(u => {
				const profile = profiles.find(p => p.userId === u.id);
				const url = profile != null ? profile.url : null;
				return {
					uri: u.uri,
					url: url ?? undefined,
					username: u.username,
					host: u.host,
				} as IMentionedRemoteUsers[0];
			}));
		}

		let savedNote: MiNote;
		let beforeNote: MiNote;
		try {
			({ savedNote, beforeNote } = await this.db.transaction(async transactionalEntityManager => {
				const lockedNote = await transactionalEntityManager.findOneOrFail(MiNote, {
					where: { id: note.id },
					lock: { mode: 'pessimistic_write' },
				});
				const history = new MiNoteHistory({
					id: this.idService.gen(),
					text: lockedNote.text,
					name: lockedNote.name,
					cw: lockedNote.cw,
					targetId: lockedNote.id,
					fileIds: lockedNote.fileIds,
					attachedFileTypes: lockedNote.attachedFileTypes,
					mentions: lockedNote.mentions,
					mentionedRemoteUsers: lockedNote.mentionedRemoteUsers,
					emojis: lockedNote.emojis,
					tags: lockedNote.tags,
					hasPoll: lockedNote.hasPoll,
				});

				await transactionalEntityManager.update(MiNote, { id: note.id }, note);
				await transactionalEntityManager.insert(MiNoteHistory, history);
				return {
					beforeNote: lockedNote,
					savedNote: await transactionalEntityManager.findOneByOrFail(MiNote, { id: note.id }),
				};
			}));
		} catch (e) {
			// duplicate key error
			if (isDuplicateKeyValueError(e)) {
				const err = new Error('Duplicated note');
				err.name = 'duplicated';
				throw err;
			}

			console.error(e);

			throw e;
		}
		trackPromise(setImmediate('post updated', { signal: this.#shutdownController.signal }).then(
			() => this.postNoteEdited(savedNote, user, data, silent, tags!, mentionedUsers!),
			() => { /* aborted, ignore this */ },
		));
		if (editor && (savedNote.userId !== editor.id)) {
			const user = await this.usersRepository.findOneByOrFail({ id: savedNote.userId });
			await this.moderationLogService.log(editor, 'editNote', {
				noteId: savedNote.id,
				noteUserId: savedNote.userId,
				noteUserUsername: user.username,
				noteUserHost: user.host,
				note: savedNote,
				beforeNote,
			});
		}
		return savedNote;
	}

	@bindThis
	private async postNoteEdited(note: MiNote, user: {
		id: MiUser['id'];
		username: MiUser['username'];
		host: MiUser['host'];
		isBot: MiUser['isBot'];
	}, data: Option, silent: boolean, tags: string[], mentionedUsers: MinimumUser[]) {
		if (!silent) {
			if (this.userEntityService.isLocalUser(user)) this.activeUsersChart.write(user);

			// Publish before optional webhook/AP work so subscribed clients can refresh promptly.
			this.globalEventService.publishNoteStream(note, 'edited', {
				note,
			});
			this.globalEventService.publishMainStream(note.userId, 'noteUpdated', note.id);

			// Pack the note
			const noteObj = await this.noteEntityService.pack(note, null, { skipHide: true, withReactionAndUserPairCache: true });

			this.userWebhookService.getActiveWebhooks().then(webhooks => {
				webhooks = webhooks.filter(x => x.userId === user.id && x.on.includes('note'));
				for (const webhook of webhooks) {
					this.queueService.userWebhookDeliver(webhook, 'note', {
						note: noteObj,
					});
				}
			});

			//#region AP deliver
			if (this.userEntityService.isLocalUser(user) && !note.localOnly) {
				trackPromise((async () => {
					const noteActivity = await this.renderNoteOrRenoteActivity(data, note, user.id);
					const dm = this.apDeliverManagerService.createDeliverManager(user, noteActivity);

					// メンションされたリモートユーザーに配送
					for (const u of mentionedUsers.filter(u => this.userEntityService.isRemoteUser(u))) {
						dm.addDirectRecipe(u as MiRemoteUser);
					}

					// 投稿がリプライかつ投稿者がローカルユーザーかつリプライ先の投稿の投稿者がリモートユーザーなら配送
					if (data.reply && data.reply.userHost !== null) {
						const u = await this.usersRepository.findOneBy({ id: data.reply.userId });
						if (u && this.userEntityService.isRemoteUser(u)) dm.addDirectRecipe(u);
					}

					// 投稿がRenoteかつ投稿者がローカルユーザーかつRenote元の投稿の投稿者がリモートユーザーなら配送
					if (data.renote && data.renote.userHost !== null) {
						const u = await this.usersRepository.findOneBy({ id: data.renote.userId });
						if (u && this.userEntityService.isRemoteUser(u)) dm.addDirectRecipe(u);
					}

					// フォロワーに配送
					if (['public', 'home', 'followers'].includes(note.visibility)) {
						dm.addFollowersRecipe();
					}

					if (['public'].includes(note.visibility)) {
						await Promise.all([
							this.relayService.deliverToRelays(user, noteActivity),
							dm.execute(),
						]);
					} else {
						await dm.execute();
					}
				})());
			}
			//#endregion
		}

		// Register to search database
		await this.index(note);
	}

	@bindThis
	private async renderNoteOrRenoteActivity(data: Option, note: MiNote, userId: string) {
		const content = this.apRendererService.renderNoteUpdate(await this.apRendererService.renderNote(note, false, true), { id: userId });

		return this.apRendererService.addContext(content);
	}

	@bindThis
	private async index(note: MiNote): Promise<void> {
		await this.searchService.unindexNote(note);
		if (note.text == null && note.cw == null) return;

		await this.searchService.indexNote(note);
	}

	@bindThis
	public dispose(): void {
		this.#shutdownController.abort();
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}
}

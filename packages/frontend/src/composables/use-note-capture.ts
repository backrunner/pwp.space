/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onUnmounted, reactive, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { EventEmitter } from 'eventemitter3';
import { createVisibilityAwareInterval } from '@@/js/interval.js';
import type { Reactive } from 'vue';
import type { NoteUpdatedEvent } from 'misskey-js/streaming.types.js';
import { useStream } from '@/stream.js';
import { $i } from '@/i.js';
import { store } from '@/store.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';
import { globalEvents } from '@/events.js';

export const noteEvents = new EventEmitter<{
	[ev: `reacted:${string}`]: (ctx: { userId: Misskey.entities.User['id']; reaction: string; emoji?: { name: string; url: string; } | null; }) => void;
	[ev: `unreacted:${string}`]: (ctx: { userId: Misskey.entities.User['id']; reaction: string; emoji?: { name: string; url: string; } | null; }) => void;
	[ev: `pollVoted:${string}`]: (ctx: { userId: Misskey.entities.User['id']; choice: number; }) => void;
}>();

const fetchEvent = new EventEmitter<{
	[id: string]: Pick<Misskey.entities.Note, 'updatedAt' | 'reactions' | 'reactionEmojis'>;
}>();

const pollingQueue = new Map<string, {
	referenceCount: number;
	persistentReferenceCount: number;
	lastAddedAt: number;
	lastPolledAt: number;
}>();

function pollingEnqueue(note: Pick<Misskey.entities.Note, 'id' | 'createdAt'>, persistent: boolean) {
	if (pollingQueue.has(note.id)) {
		const data = pollingQueue.get(note.id)!;
		pollingQueue.set(note.id, {
			...data,
			referenceCount: data.referenceCount + 1,
			persistentReferenceCount: data.persistentReferenceCount + (persistent ? 1 : 0),
			lastAddedAt: Date.now(),
		});
	} else {
		pollingQueue.set(note.id, {
			referenceCount: 1,
			persistentReferenceCount: persistent ? 1 : 0,
			lastAddedAt: Date.now(),
			lastPolledAt: 0,
		});
	}
}

function pollingDequeue(note: Pick<Misskey.entities.Note, 'id' | 'createdAt'>, persistent: boolean) {
	const data = pollingQueue.get(note.id);
	if (data == null) return;

	if (data.referenceCount === 1) {
		pollingQueue.delete(note.id);
	} else {
		pollingQueue.set(note.id, {
			...data,
			referenceCount: data.referenceCount - 1,
			persistentReferenceCount: data.persistentReferenceCount - (persistent ? 1 : 0),
		});
	}
}

const CAPTURE_MAX = 100;
const MIN_POLLING_INTERVAL = 1000 * 10;
const POLLING_INTERVAL =
	prefer.s.pollingInterval === 1 ? MIN_POLLING_INTERVAL * 1.5 * 1.5 :
	prefer.s.pollingInterval === 2 ? MIN_POLLING_INTERVAL * 1.5 :
	prefer.s.pollingInterval === 3 ? MIN_POLLING_INTERVAL :
	MIN_POLLING_INTERVAL;

// documentが非表示の間はポーリングを停止する
export function selectPollingNoteIds(
	queue: ReadonlyMap<string, { persistentReferenceCount: number; lastAddedAt: number; lastPolledAt: number }>,
	now = Date.now(),
	limit = CAPTURE_MAX,
): string[] {
	return [...queue.entries()]
		.filter(([, v]) => v.persistentReferenceCount > 0 || now - v.lastAddedAt < 1000 * 60 * 5)
		.sort(([aId, a], [bId, b]) => {
			if ((a.persistentReferenceCount > 0) !== (b.persistentReferenceCount > 0)) {
				return a.persistentReferenceCount > 0 ? -1 : 1;
			}
			if (a.lastPolledAt !== b.lastPolledAt) return a.lastPolledAt - b.lastPolledAt;
			if (a.lastAddedAt !== b.lastAddedAt) return b.lastAddedAt - a.lastAddedAt;
			return aId > bId ? -1 : 1;
		})
		.slice(0, limit)
		.map(([id]) => id);
}

createVisibilityAwareInterval(() => {
	const now = Date.now();
	const ids = selectPollingNoteIds(pollingQueue, now);
	for (const id of ids) {
		const entry = pollingQueue.get(id);
		if (entry != null) pollingQueue.set(id, { ...entry, lastPolledAt: now });
	}

	if (ids.length === 0) return;

	// まとめてリクエストするのではなく、個別にHTTPリクエスト投げてCDNにキャッシュさせた方がサーバーの負荷低減には良いかもしれない？
	misskeyApi('notes/show-partial-bulk', {
		noteIds: ids,
	}).then((items) => {
		for (const item of items) {
			fetchEvent.emit(item.id, {
				updatedAt: item.updatedAt,
				reactions: item.reactions,
				reactionEmojis: item.reactionEmojis,
			});
		}
	});
}, POLLING_INTERVAL);

function pollingSubscribe(props: {
	note: Pick<Misskey.entities.Note, 'id' | 'createdAt'>;
	persistent: boolean;
	onFetched: (data: Pick<Misskey.entities.Note, 'updatedAt' | 'reactions' | 'reactionEmojis'>) => void;
}): () => void {
	const { note, persistent, onFetched } = props;

	pollingEnqueue(note, persistent);
	fetchEvent.on(note.id, onFetched);

	return () => {
		pollingDequeue(note, persistent);
		fetchEvent.off(note.id, onFetched);
	};
}

function realtimeSubscribe(props: {
	note: Pick<Misskey.entities.Note, 'id' | 'createdAt'>;
}): () => void {
	const note = props.note;
	const connection = useStream();

	function onStreamNoteUpdated(noteData: NoteUpdatedEvent): void {
		const { type, id, body } = noteData;

		if (id !== note.id) return;

		switch (type) {
			case 'reacted': {
				noteEvents.emit(`reacted:${id}`, {
					userId: body.userId,
					reaction: body.reaction,
					emoji: body.emoji,
				});
				break;
			}

			case 'unreacted': {
				noteEvents.emit(`unreacted:${id}`, {
					userId: body.userId,
					reaction: body.reaction,
				});
				break;
			}

			case 'pollVoted': {
				noteEvents.emit(`pollVoted:${id}`, {
					userId: body.userId,
					choice: body.choice,
				});
				break;
			}

			case 'deleted': {
				globalEvents.emit('noteDeleted', id);
				break;
			}

			case 'edited': {
				globalEvents.emit('noteUpdated', id);
				break;
			}
		}
	}

	function capture(withHandler = false): void {
		connection.send('sr', { id: note.id });
		if (withHandler) connection.on('noteUpdated', onStreamNoteUpdated);
	}

	function decapture(withHandler = false): void {
		connection.send('un', { id: note.id });
		if (withHandler) connection.off('noteUpdated', onStreamNoteUpdated);
	}

	function onStreamConnected() {
		capture(false);
	}

	capture(true);
	connection.on('_connected_', onStreamConnected);

	return () => {
		decapture(true);
		connection.off('_connected_', onStreamConnected);
	};
}

export type ReactiveNoteData = {
	reactions: Misskey.entities.Note['reactions'];
	reactionCount: Misskey.entities.Note['reactionCount'];
	reactionEmojis: Misskey.entities.Note['reactionEmojis'];
	myReaction: Misskey.entities.Note['myReaction'];
	pollChoices: NonNullable<Misskey.entities.Note['poll']>['choices'];
};

const noReaction = Symbol();

function normalizeReactions(reactions: Misskey.entities.Note['reactions']): Misskey.entities.Note['reactions'] {
	return Object.entries(reactions).reduce((acc, [name, count]) => {
		const normalizedName = name.replace(/^:(\w+):$/, ':$1@.:');
		acc[normalizedName] = (acc[normalizedName] ?? 0) + count;
		return acc;
	}, {} as Misskey.entities.Note['reactions']);
}

export function useNoteCapture(props: {
	note: Misskey.entities.Note;
	parentNote: Misskey.entities.Note | null;
	mock?: boolean;
	forceSubscribe?: boolean;
}): {
	$note: Reactive<ReactiveNoteData>;
	subscribe: () => void;
} {
	const { note, parentNote, mock, forceSubscribe } = props;

	const $note = reactive<ReactiveNoteData>({
		reactions: normalizeReactions(note.reactions),
		reactionCount: note.reactionCount,
		reactionEmojis: { ...note.reactionEmojis },
		myReaction: note.myReaction,
		pollChoices: note.poll?.choices.map(choice => ({ ...choice })) ?? [],
	});

	// 操作がダブっていないかどうかを簡易的に記録するためのMap
	const reactionUserMap = new Map<Misskey.entities.User['id'], string | typeof noReaction>();
	let latestPollVotedKey: string | null = null;
	let subscribed = false;
	let unsubscribers: Array<() => void> = [];

	function onReacted(ctx: { userId: Misskey.entities.User['id']; reaction: string; emoji?: { name: string; url: string; } | null; }): void {
		let normalizedName = ctx.reaction.replace(/^:(\w+):$/, ':$1@.:');
		normalizedName = normalizedName.match('\u200d') ? normalizedName : normalizedName.replace(/\ufe0f/g, '');
		if (reactionUserMap.has(ctx.userId) && reactionUserMap.get(ctx.userId) === normalizedName) return;
		reactionUserMap.set(ctx.userId, normalizedName);

		if (ctx.emoji && !(ctx.emoji.name in $note.reactionEmojis)) {
			$note.reactionEmojis[ctx.emoji.name] = ctx.emoji.url;
		}

		const currentCount = $note.reactions[normalizedName] || 0;

		$note.reactions[normalizedName] = currentCount + 1;
		$note.reactionCount += 1;

		if ($i && (ctx.userId === $i.id)) {
			$note.myReaction = normalizedName;
		}
	}

	function onUnreacted(ctx: { userId: Misskey.entities.User['id']; reaction: string; emoji?: { name: string; url: string; } | null; }): void {
		let normalizedName = ctx.reaction.replace(/^:(\w+):$/, ':$1@.:');
		normalizedName = normalizedName.match('\u200d') ? normalizedName : normalizedName.replace(/\ufe0f/g, '');

		// 確実に一度リアクションされて取り消されている場合のみ処理をとめる（APIで初回読み込み→Streamでアップデート等の場合、reactionUserMapに情報がないため）
		if (reactionUserMap.has(ctx.userId) && reactionUserMap.get(ctx.userId) === noReaction) return;
		reactionUserMap.set(ctx.userId, noReaction);

		const currentCount = $note.reactions[normalizedName] || 0;

		$note.reactions[normalizedName] = Math.max(0, currentCount - 1);
		$note.reactionCount = Math.max(0, $note.reactionCount - 1);
		if ($note.reactions[normalizedName] === 0) delete $note.reactions[normalizedName];

		if ($i && (ctx.userId === $i.id)) {
			$note.myReaction = null;
		}
	}

	function onPollVoted(ctx: { userId: Misskey.entities.User['id']; choice: number; }): void {
		const newPollVotedKey = `${ctx.userId}:${ctx.choice}`;
		if (newPollVotedKey === latestPollVotedKey) return;
		latestPollVotedKey = newPollVotedKey;

		const choices = [...$note.pollChoices];
		choices[ctx.choice] = {
			...choices[ctx.choice],
			votes: choices[ctx.choice].votes + 1,
			...($i && (ctx.userId === $i.id) ? {
				isVoted: true,
			} : {}),
		};

		$note.pollChoices = choices;
	}

	function getCaptureTargets(): Misskey.entities.Note[] {
		const targets = [note, parentNote, parentNote?.renote].filter(target => target != null);
		return [...new Map(targets.map(target => [target.id, target])).values()];
	}

	function unsubscribeAll(): void {
		for (const unsubscribe of unsubscribers) unsubscribe();
		unsubscribers = [];
	}

	function bindSubscriptions(): void {
		unsubscribeAll();
		if (!subscribed) return;

		for (const target of getCaptureTargets()) {
			const capturedNote = {
				id: target.id,
				createdAt: target.createdAt,
			};
			if ($i && store.s.realtimeMode) {
				unsubscribers.push(realtimeSubscribe({ note: capturedNote }));
			} else {
				unsubscribers.push(pollingSubscribe({
					note: capturedNote,
					persistent: forceSubscribe ?? false,
					onFetched: (data) => {
						const currentTarget = getCaptureTargets().find(current => current.id === capturedNote.id);
						if (note.id === capturedNote.id) {
							$note.reactions = normalizeReactions(data.reactions);
							$note.reactionCount = Object.values(data.reactions).reduce((a, b) => a + b, 0);
							$note.reactionEmojis = { ...data.reactionEmojis };
						}
						if (currentTarget != null && (data.updatedAt ?? null) !== (currentTarget.updatedAt ?? null)) {
							globalEvents.emit('noteUpdated', capturedNote.id);
						}
					},
				}));
			}
		}
	}

	function subscribe() {
		if (mock || subscribed) {
			// モックモードでは購読しない
			return;
		}

		subscribed = true;
		bindSubscriptions();
	}

	watch(() => note.id, (noteId, _oldNoteId, onCleanup) => {
		reactionUserMap.clear();
		latestPollVotedKey = null;
		noteEvents.on(`reacted:${noteId}`, onReacted);
		noteEvents.on(`unreacted:${noteId}`, onUnreacted);
		noteEvents.on(`pollVoted:${noteId}`, onPollVoted);
		onCleanup(() => {
			noteEvents.off(`reacted:${noteId}`, onReacted);
			noteEvents.off(`unreacted:${noteId}`, onUnreacted);
			noteEvents.off(`pollVoted:${noteId}`, onPollVoted);
		});
	}, { immediate: true });

	watch(() => ({
		id: note.id,
		updatedAt: note.updatedAt,
		reactions: note.reactions,
		reactionCount: note.reactionCount,
		reactionEmojis: note.reactionEmojis,
		myReaction: note.myReaction,
		pollChoices: note.poll?.choices,
	}), () => {
		$note.reactions = normalizeReactions(note.reactions);
		$note.reactionCount = note.reactionCount;
		$note.reactionEmojis = { ...note.reactionEmojis };
		$note.myReaction = note.myReaction;
		$note.pollChoices = note.poll?.choices.map(choice => ({ ...choice })) ?? [];
	});

	watch(() => getCaptureTargets().map(target => target.id).sort().join(':'), () => {
		bindSubscriptions();
	});

	onUnmounted(() => {
		unsubscribeAll();
	});

	if (forceSubscribe) {
		subscribe();
		return {
			$note,
			subscribe,
		};
	}

	// 投稿からある程度経過している(=タイムラインを遡って表示した)ノートは、イベントが発生する可能性が低いためそもそも購読しない
	// ただし「リノートされたばかりの過去のノート」(= parentNoteが存在し、かつparentNoteの投稿日時が最近)はイベント発生が考えられるため購読する
	// TODO: デバイスとサーバーの時計がズレていると不具合の元になるため、ズレを検知して警告を表示するなどのケアが必要かもしれない
	if (parentNote == null) {
		if ((Date.now() - new Date(note.createdAt).getTime()) > 1000 * 60 * 5) { // 5min
			// リノートで表示されているノートでもないし、投稿からある程度経過しているので自動で購読しない
			return {
				$note,
				subscribe,
			};
		}
	} else {
		if ((Date.now() - new Date(parentNote.createdAt).getTime()) > 1000 * 60 * 5) { // 5min
			// リノートで表示されているノートだが、リノートされてからある程度経過しているので自動で購読しない
			return {
				$note,
				subscribe,
			};
		}
	}

	subscribe();

	return {
		$note,
		subscribe,
	};
}

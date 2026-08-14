/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, reactive, ref } from 'vue';
import { afterEach, assert, describe, expect, test, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { globalEvents } from '@/events.js';
import { noteEvents, selectPollingNoteIds, useNoteCapture } from '@/composables/use-note-capture.js';
import { createCoalescedRerun, createNoteViewState, fetchLatestNote, replaceNoteState, resolveCollapsedStateAfterRefresh, resolveNoteStateAfterRefresh } from '@/utility/note-refresh.js';
import { Paginator } from '@/utility/paginator.js';
import { getTimelineNoteKey, updateNoteInTimeline } from '@/utility/update-note-in-timeline.js';

const misskeyApi = vi.hoisted(() => vi.fn());

vi.mock('@/utility/misskey-api.js', () => ({
	misskeyApi,
}));

const stream = vi.hoisted(() => {
	const listeners = new Map<string, Set<(payload?: unknown) => void>>();

	return {
		listeners,
		send: vi.fn(),
		on: vi.fn((event: string, listener: (payload?: unknown) => void) => {
			const eventListeners = listeners.get(event) ?? new Set();
			eventListeners.add(listener);
			listeners.set(event, eventListeners);
		}),
		off: vi.fn((event: string, listener: (payload?: unknown) => void) => {
			listeners.get(event)?.delete(listener);
		}),
		emit(event: string, payload?: unknown) {
			for (const listener of listeners.get(event) ?? []) listener(payload);
		},
		reset() {
			listeners.clear();
			this.send.mockClear();
			this.on.mockClear();
			this.off.mockClear();
		},
	};
});

vi.mock('@/stream.js', () => ({
	useStream: () => stream,
}));

vi.mock('@/i.js', () => ({
	$i: { id: 'signed-in-user' },
}));

vi.mock('@/store.js', () => ({
	store: {
		s: {
			realtimeMode: true,
		},
	},
}));

function note(id: string, overrides: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return {
		id,
		createdAt: '2020-01-01T00:00:00.000Z',
		deletedAt: null,
		text: 'before edit',
		cw: null,
		userId: 'author',
		user: {
			id: 'author',
			name: 'Author',
			username: 'author',
			host: null,
			avatarUrl: 'https://example.com/avatar.png',
			avatarBlurhash: null,
			avatarDecorations: [],
			isBot: false,
			isCat: false,
			emojis: {},
			onlineStatus: 'unknown',
		},
		visibility: 'public',
		reactionAcceptance: null,
		reactionEmojis: {},
		reactions: {},
		myReaction: null,
		reactionCount: 0,
		renoteCount: 0,
		repliesCount: 0,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	stream.reset();
	misskeyApi.mockReset();
});

describe('old note capture', () => {
	test('subscribes once, forwards edited events, and unsubscribes on unmount', () => {
		const oldNote = note('old-note');
		const onNoteUpdated = vi.fn();
		globalEvents.on('noteUpdated', onNoteUpdated);

		const component = defineComponent({
			setup() {
				const capture = useNoteCapture({ note: oldNote, parentNote: oldNote });
				capture.subscribe();
				capture.subscribe();
				return () => h('div');
			},
		});

		const rendered = render(component);
		expect(stream.send).toHaveBeenCalledTimes(1);
		expect(stream.send).toHaveBeenCalledWith('sr', { id: oldNote.id });

		stream.emit('noteUpdated', {
			id: oldNote.id,
			type: 'edited',
			body: { note: oldNote },
		});
		expect(onNoteUpdated).toHaveBeenCalledOnce();
		expect(onNoteUpdated).toHaveBeenCalledWith(oldNote.id);

		rendered.unmount();
		expect(stream.send).toHaveBeenCalledTimes(2);
		expect(stream.send).toHaveBeenLastCalledWith('un', { id: oldNote.id });
		assert.strictEqual(stream.listeners.get('noteUpdated')?.size ?? 0, 0);
		globalEvents.off('noteUpdated', onNoteUpdated);
	});

	test('a timeline note subscribes after the automatic capture window', () => {
		const oldNote = note('old-note', { createdAt: '2000-01-01T00:00:00.000Z' });

		const component = defineComponent({
			setup() {
				useNoteCapture({ note: oldNote, parentNote: oldNote, forceSubscribe: true });
				return () => h('div');
			},
		});

		const rendered = render(component);
		expect(stream.send).toHaveBeenCalledOnce();
		expect(stream.send).toHaveBeenCalledWith('sr', { id: oldNote.id });

		rendered.unmount();
		expect(stream.send).toHaveBeenLastCalledWith('un', { id: oldNote.id });
	});

	test('fairly rotates persistent polling targets beyond one bulk request', () => {
		const queue = new Map<string, { persistentReferenceCount: number; lastAddedAt: number; lastPolledAt: number }>();
		for (let i = 0; i < 101; i++) {
			queue.set(`note-${i}`, { persistentReferenceCount: 1, lastAddedAt: 0, lastPolledAt: i === 0 ? 100 : 0 });
		}

		const firstBatch = selectPollingNoteIds(queue, 200, 100);
		const secondBatch = selectPollingNoteIds(new Map([...queue].map(([id, entry]) => [id, {
			...entry,
			lastPolledAt: firstBatch.includes(id) ? 200 : entry.lastPolledAt,
		}])), 300, 100);

		expect(firstBatch).toHaveLength(100);
		expect(secondBatch).toContain('note-0');
		expect(new Set([...firstBatch, ...secondBatch])).toHaveProperty('size', 101);
	});

	test('captures both a quote wrapper and its target and rebinds reaction listeners when the displayed note changes', async () => {
		const quoted = note('quoted');
		const wrapper = reactive(note('wrapper', {
			text: 'a quote',
			renoteId: quoted.id,
			renote: quoted,
		}));
		const displayed = reactive(note('wrapper', {
			text: 'a quote',
			renoteId: quoted.id,
			renote: quoted,
		}));
		const onNoteUpdated = vi.fn();
		globalEvents.on('noteUpdated', onNoteUpdated);

		let captured!: ReturnType<typeof useNoteCapture>;
		const component = defineComponent({
			setup() {
				captured = useNoteCapture({ note: displayed, parentNote: wrapper, forceSubscribe: true });
				return () => h('div');
			},
		});

		const rendered = render(component);
		expect(stream.send).toHaveBeenCalledWith('sr', { id: wrapper.id });
		expect(stream.send).toHaveBeenCalledWith('sr', { id: quoted.id });

		stream.emit('noteUpdated', {
			id: quoted.id,
			type: 'edited',
			body: { note: quoted },
		});
		expect(onNoteUpdated).toHaveBeenCalledOnce();
		expect(onNoteUpdated).toHaveBeenCalledWith(quoted.id);

		for (const key of Object.keys(displayed)) {
			if (!(key in quoted)) Reflect.deleteProperty(displayed, key);
		}
		Object.assign(displayed, quoted);
		await nextTick();
		noteEvents.emit(`reacted:${wrapper.id}`, { userId: 'other-user', reaction: 'old' });
		expect(captured.$note.reactionCount).toBe(0);
		noteEvents.emit(`reacted:${quoted.id}`, { userId: 'other-user', reaction: 'new' });
		expect(captured.$note.reactionCount).toBe(1);

		stream.emit('noteUpdated', {
			id: wrapper.id,
			type: 'edited',
			body: { note: wrapper },
		});
		expect(onNoteUpdated).toHaveBeenCalledTimes(2);
		expect(onNoteUpdated).toHaveBeenLastCalledWith(wrapper.id);

		rendered.unmount();
		expect(stream.send).toHaveBeenCalledWith('un', { id: wrapper.id });
		expect(stream.send).toHaveBeenCalledWith('un', { id: quoted.id });
		globalEvents.off('noteUpdated', onNoteUpdated);
	});
});

describe('timeline note refresh', () => {
	function paginator(initialItems: Misskey.entities.Note[]) {
		const itemsRef = ref(initialItems);
		return {
			items: itemsRef,
			updateItems(updater: (item: Misskey.entities.Note) => Misskey.entities.Note) {
				itemsRef.value = itemsRef.value.map(updater);
			},
		};
	}

	test('replaces a direct timeline note', () => {
		const original = note('direct');
		const updated = note('direct', { text: 'after edit', updatedAt: '2026-08-12T00:00:00.000Z' });
		const timeline = paginator([original]);

		updateNoteInTimeline(timeline, updated);

		expect(timeline.items.value[0]).toEqual(updated);
	});

	test('replaces an edited note inside a renote wrapper and changes its render key', () => {
		const original = note('renoted');
		const wrapper = note('wrapper', {
			text: null,
			renoteId: original.id,
			renote: original,
		});
		const updated = note('renoted', { text: 'after edit', updatedAt: '2026-08-12T00:00:00.000Z' });
		const timeline = paginator([wrapper]);
		const oldKey = getTimelineNoteKey(wrapper);

		updateNoteInTimeline(timeline, updated);

		expect(timeline.items.value[0]?.id).toBe(wrapper.id);
		expect(timeline.items.value[0]?.renote).toEqual(updated);
		expect(getTimelineNoteKey(timeline.items.value[0]!)).not.toBe(oldKey);
	});

	test('updates a direct note waiting in the ahead queue', () => {
		const original = note('queued-direct');
		const updated = note('queued-direct', { text: 'after edit', updatedAt: '2026-08-12T00:00:00.000Z' });
		const timeline = new Paginator('notes/timeline', { useShallowRef: true });
		timeline.enqueue(original);

		updateNoteInTimeline(timeline, updated);
		timeline.releaseQueue();

		expect(timeline.items.value[0]).toEqual(updated);
	});

	test('updates a renoted note waiting in the ahead queue', () => {
		const original = note('queued-renoted');
		const wrapper = note('queued-wrapper', {
			text: null,
			renoteId: original.id,
			renote: original,
		});
		const updated = note('queued-renoted', { text: 'after edit', updatedAt: '2026-08-12T00:00:00.000Z' });
		const timeline = new Paginator('notes/timeline', { useShallowRef: true });
		timeline.enqueue(wrapper);

		updateNoteInTimeline(timeline, updated);
		timeline.releaseQueue();

		expect(timeline.items.value[0]?.id).toBe(wrapper.id);
		expect(timeline.items.value[0]?.renote).toEqual(updated);
	});
});

describe('shared note refresh', () => {
	test('coalesces listeners from the same event into one request', async () => {
		const updated = note('coalesced', { text: 'after edit' });
		misskeyApi.mockResolvedValue(updated);

		const first = fetchLatestNote(updated.id);
		const second = fetchLatestNote(updated.id);

		await expect(Promise.all([first, second])).resolves.toEqual([updated, updated]);
		expect(misskeyApi).toHaveBeenCalledOnce();
		expect(misskeyApi).toHaveBeenCalledWith('notes/show', { noteId: updated.id });
	});

	test('reruns once when another edit arrives in flight and resolves every listener with the latest note', async () => {
		const resolvers: Array<(value: Misskey.entities.Note) => void> = [];
		misskeyApi.mockImplementation(() => new Promise(resolve => {
			resolvers.push(resolve);
		}));

		const first = fetchLatestNote('racing');
		await vi.waitFor(() => expect(resolvers).toHaveLength(1));

		const duringRequest = fetchLatestNote('racing');
		resolvers[0]!(note('racing', { text: 'stale edit' }));
		await vi.waitFor(() => expect(resolvers).toHaveLength(2));

		const latest = note('racing', { text: 'latest edit', updatedAt: '2026-08-12T00:00:01.000Z' });
		resolvers[1]!(latest);

		await expect(Promise.all([first, duringRequest])).resolves.toEqual([latest, latest]);
		expect(misskeyApi).toHaveBeenCalledTimes(2);
	});

	test('retries a failed request when another edit arrived in flight', async () => {
		const rejecters: Array<(error: Error) => void> = [];
		const resolvers: Array<(value: Misskey.entities.Note) => void> = [];
		misskeyApi.mockImplementation(() => new Promise((resolve, reject) => {
			resolvers.push(resolve);
			rejecters.push(reject);
		}));

		const first = fetchLatestNote('retry-after-failure');
		await vi.waitFor(() => expect(rejecters).toHaveLength(1));
		const duringRequest = fetchLatestNote('retry-after-failure');
		rejecters[0]!(new Error('stale request failed'));
		await vi.waitFor(() => expect(resolvers).toHaveLength(2));

		const latest = note('retry-after-failure', { text: 'latest edit' });
		resolvers[1]!(latest);

		await expect(Promise.all([first, duringRequest])).resolves.toEqual([latest, latest]);
		expect(misskeyApi).toHaveBeenCalledTimes(2);
	});

	test('serializes a refresh requested in flight and coalesces same-tick requests', async () => {
		const resolvers: Array<() => void> = [];
		let active = 0;
		let maxActive = 0;
		const task = vi.fn(async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise<void>(resolve => resolvers.push(resolve));
			active--;
		});
		const rerun = createCoalescedRerun(task);

		const first = rerun();
		const sameTick = rerun();
		expect(first).toBe(sameTick);
		await vi.waitFor(() => expect(resolvers).toHaveLength(1));

		const duringRequest = rerun();
		expect(duringRequest).toBe(first);
		expect(task).toHaveBeenCalledOnce();
		resolvers[0]!();
		await vi.waitFor(() => expect(resolvers).toHaveLength(2));
		expect(maxActive).toBe(1);

		resolvers[1]!();
		await Promise.all([first, sameTick, duringRequest]);
		expect(task).toHaveBeenCalledTimes(2);
		expect(maxActive).toBe(1);
	});

	test('reruns a failed coalesced task when another refresh was queued', async () => {
		const rejecters: Array<(error: Error) => void> = [];
		const resolvers: Array<() => void> = [];
		const task = vi.fn(() => new Promise<void>((resolve, reject) => {
			resolvers.push(resolve);
			rejecters.push(reject);
		}));
		const rerun = createCoalescedRerun(task);

		const first = rerun();
		await vi.waitFor(() => expect(rejecters).toHaveLength(1));
		const duringRequest = rerun();
		rejecters[0]!(new Error('stale history request failed'));
		await vi.waitFor(() => expect(resolvers).toHaveLength(2));
		resolvers[1]!();

		await expect(Promise.all([first, duringRequest])).resolves.toEqual([undefined, undefined]);
		expect(task).toHaveBeenCalledTimes(2);
	});

	test('keeps wrapper and renote target refreshes independent', async () => {
		const requests = new Map<string, Array<(value: Misskey.entities.Note) => void>>();
		misskeyApi.mockImplementation((endpoint: string, params: { noteId: string }) => new Promise(resolve => {
			if (endpoint !== 'notes/show') throw new Error(`Unexpected endpoint: ${endpoint}`);
			const pending = requests.get(params.noteId) ?? [];
			pending.push(resolve as (value: Misskey.entities.Note) => void);
			requests.set(params.noteId, pending);
		}));

		const wrapper = note('refresh-wrapper', { text: 'wrapper' });
		const target = note('refresh-target', { text: 'target' });
		const wrapperRequest = fetchLatestNote(wrapper.id);
		const targetRequest = fetchLatestNote(target.id);
		await vi.waitFor(() => {
			expect(requests.get(wrapper.id)).toHaveLength(1);
			expect(requests.get(target.id)).toHaveLength(1);
		});

		const updatedWrapper = note(wrapper.id, { text: 'updated wrapper' });
		const updatedTarget = note(target.id, { text: 'updated target' });
		requests.get(wrapper.id)![0]!(updatedWrapper);
		requests.get(target.id)![0]!(updatedTarget);

		await expect(Promise.all([wrapperRequest, targetRequest])).resolves.toEqual([updatedWrapper, updatedTarget]);
	});

	test('keeps wrapper and displayed note state separate when a quote becomes a pure renote', async () => {
		const quoted = note('quoted', { text: 'quoted body' });
		const quote = note('wrapper', {
			text: 'quote body',
			renoteId: quoted.id,
			renote: quoted,
		});
		const pureRenote = note('wrapper', {
			text: null,
			renoteId: quoted.id,
			renote: quoted,
		});
		const initialState = createNoteViewState(quote);
		const rawNote = reactive(initialState.rawNote);
		const appearNote = reactive(initialState.appearNote);
		expect(rawNote.id).toBe(appearNote.id);
		expect(rawNote).not.toBe(appearNote);

		const updatedState = resolveNoteStateAfterRefresh(rawNote, quote.id, pureRenote);
		assert.ok(updatedState);
		replaceNoteState(rawNote, updatedState.rawNote);
		replaceNoteState(appearNote, updatedState.appearNote);

		expect(rawNote.id).toBe(quote.id);
		expect(rawNote.text).toBeNull();
		expect(appearNote.id).toBe(quoted.id);
		expect(appearNote.text).toBe('quoted body');
		expect(appearNote.renoteId).toBeUndefined();
	});

	test('does not let a wrapper refresh overwrite a newer renote target refresh', () => {
		const staleTarget = note('race-target', {
			text: 'stale target',
			updatedAt: '2026-08-12T00:00:00.000Z',
		});
		const initialWrapper = note('race-wrapper', {
			text: 'initial wrapper',
			renoteId: staleTarget.id,
			renote: staleTarget,
		});
		const newerTarget = note(staleTarget.id, {
			text: 'newer target',
			updatedAt: '2026-08-12T00:00:02.000Z',
		});
		const refreshedWrapperWithStaleTarget = note(initialWrapper.id, {
			text: 'updated wrapper',
			updatedAt: '2026-08-12T00:00:03.000Z',
			renoteId: staleTarget.id,
			renote: staleTarget,
		});

		const targetState = resolveNoteStateAfterRefresh(initialWrapper, newerTarget.id, newerTarget);
		assert.ok(targetState);
		const wrapperState = resolveNoteStateAfterRefresh(targetState.rawNote, initialWrapper.id, refreshedWrapperWithStaleTarget);
		assert.ok(wrapperState);

		expect(wrapperState.rawNote.text).toBe('updated wrapper');
		expect(wrapperState.rawNote.renote?.text).toBe('newer target');
		expect(wrapperState.appearNote.text).toBe('updated wrapper');
		expect(wrapperState.appearNote.renote?.text).toBe('newer target');
	});

	test('ignores a stale quote target response after the wrapper points to another target', () => {
		const firstTarget = note('first-target');
		const secondTarget = note('second-target');
		const wrapper = note('wrapper', { text: 'quote', renoteId: secondTarget.id, renote: secondTarget });

		expect(resolveNoteStateAfterRefresh(wrapper, firstTarget.id, firstTarget)).toBeNull();
	});

	test('reconciles collapsed state after edited content changes length', () => {
		expect(resolveCollapsedStateAfterRefresh({
			wasLong: true,
			wasCollapsed: true,
			isLong: false,
			hasCw: false,
		})).toBe(false);
		expect(resolveCollapsedStateAfterRefresh({
			wasLong: false,
			wasCollapsed: false,
			isLong: true,
			hasCw: false,
		})).toBe(true);
		expect(resolveCollapsedStateAfterRefresh({
			wasLong: true,
			wasCollapsed: false,
			isLong: true,
			hasCw: false,
		})).toBe(false);
		expect(resolveCollapsedStateAfterRefresh({
			wasLong: true,
			wasCollapsed: true,
			isLong: true,
			hasCw: true,
		})).toBe(false);
	});
});

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { deepClone } from '@/utility/clone.js';
import { getAppearNote } from '@/utility/get-appear-note.js';

class RefreshState {
	public scheduled = true;
	public rerun = false;
	public readonly promise: Promise<Misskey.entities.Note>;

	constructor(noteId: Misskey.entities.Note['id']) {
		this.promise = Promise.resolve().then(async () => {
			this.scheduled = false;
			let latestNote: Misskey.entities.Note | null = null;

			do {
				this.rerun = false;
				try {
					latestNote = await misskeyApi('notes/show', { noteId });
				} catch (error) {
					if (!this.rerun) {
						if (refreshStates.get(noteId) === this) refreshStates.delete(noteId);
						throw error;
					}
				}
			} while (this.rerun);

			if (refreshStates.get(noteId) === this) refreshStates.delete(noteId);
			if (latestNote == null) throw new Error('Note refresh completed without a result');
			return latestNote;
		});
	}
}

const refreshStates = new Map<Misskey.entities.Note['id'], RefreshState>();

export function createCoalescedRerun(task: () => Promise<void>): () => Promise<void> {
	let state: {
		scheduled: boolean;
		rerun: boolean;
		promise: Promise<void>;
	} | null = null;

	return () => {
		if (state != null) {
			if (!state.scheduled) state.rerun = true;
			return state.promise;
		}

		const current = {
			scheduled: true,
			rerun: false,
			promise: Promise.resolve(),
		};
		current.promise = Promise.resolve().then(async () => {
			current.scheduled = false;
			try {
				do {
					current.rerun = false;
					try {
						await task();
					} catch (error) {
						if (!current.rerun) throw error;
					}
				} while (current.rerun);
			} finally {
				if (state === current) state = null;
			}
		});
		state = current;
		return current.promise;
	};
}

export function resolveCollapsedStateAfterRefresh(options: {
	wasLong: boolean;
	wasCollapsed: boolean;
	isLong: boolean;
	hasCw: boolean;
}): boolean {
	if (options.hasCw || !options.isLong) return false;
	if (!options.wasLong) return true;
	return options.wasCollapsed;
}

export function createNoteViewState(note: Misskey.entities.Note): {
	rawNote: Misskey.entities.Note;
	appearNote: Misskey.entities.Note;
} {
	const rawNote = deepClone(note);
	return {
		rawNote,
		appearNote: deepClone(getAppearNote(rawNote) ?? rawNote),
	};
}

export function resolveNoteStateAfterRefresh(
	rawNote: Misskey.entities.Note,
	refreshedNoteId: Misskey.entities.Note['id'],
	refreshedNote: Misskey.entities.Note,
): {
	rawNote: Misskey.entities.Note;
		appearNote: Misskey.entities.Note;
		} | null {
	if (refreshedNoteId !== rawNote.id && rawNote.renote?.id !== refreshedNoteId) return null;

	let updatedRawNote = refreshedNoteId === rawNote.id ? deepClone(refreshedNote) : {
		...deepClone(rawNote),
		renote: deepClone(refreshedNote),
	};
	if (
		refreshedNoteId === rawNote.id &&
		rawNote.renote != null &&
		updatedRawNote.renote != null &&
		rawNote.renote.id === updatedRawNote.renote.id
	) {
		const currentRenoteUpdatedAt = rawNote.renote.updatedAt == null ? null : Date.parse(rawNote.renote.updatedAt);
		const refreshedRenoteUpdatedAt = updatedRawNote.renote.updatedAt == null ? null : Date.parse(updatedRawNote.renote.updatedAt);
		if (
			currentRenoteUpdatedAt != null &&
			!Number.isNaN(currentRenoteUpdatedAt) &&
			(refreshedRenoteUpdatedAt == null || Number.isNaN(refreshedRenoteUpdatedAt) || currentRenoteUpdatedAt >= refreshedRenoteUpdatedAt)
		) {
			updatedRawNote = {
				...updatedRawNote,
				renote: deepClone(rawNote.renote),
			};
		}
	}
	return {
		rawNote: updatedRawNote,
		appearNote: deepClone(getAppearNote(updatedRawNote) ?? updatedRawNote),
	};
}

export function replaceNoteState(target: Misskey.entities.Note, source: Misskey.entities.Note): void {
	for (const key of Object.keys(target)) {
		if (!(key in source)) Reflect.deleteProperty(target, key);
	}
	Object.assign(target, source);
}

export function fetchLatestNote(noteId: Misskey.entities.Note['id']): Promise<Misskey.entities.Note> {
	const existing = refreshStates.get(noteId);
	if (existing != null) {
		if (!existing.scheduled) existing.rerun = true;
		return existing.promise;
	}

	const state = new RefreshState(noteId);
	refreshStates.set(noteId, state);
	return state.promise;
}

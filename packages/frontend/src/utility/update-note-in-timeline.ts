/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import type { IPaginator } from '@/utility/paginator.js';

export function getTimelineNoteKey(note: Misskey.entities.Note): string {
	return `${note.id}-${note.updatedAt ?? ''}-${note.renote?.updatedAt ?? ''}`;
}

export function updateNoteInTimeline(
	paginator: Pick<IPaginator<Misskey.entities.Note>, 'updateItems'>,
	updatedNote: Misskey.entities.Note,
): void {
	paginator.updateItems(item => {
		if (item.id === updatedNote.id) {
			return item._shouldInsertAd_ ? {
				...updatedNote,
				_shouldInsertAd_: true,
			} : updatedNote;
		}
		if (item.renote?.id !== updatedNote.id) return item;

		return {
			...item,
			renote: updatedNote,
		};
	});
}

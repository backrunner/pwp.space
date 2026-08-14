/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { WebSocket } from 'ws';
import { api, castAsError, initTestDb, port, post, role, signup, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('Note editing', () => {
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;
	let remote: misskey.entities.SignupResponse;
	let editRole: misskey.entities.Role;
	let moderatorRole: misskey.entities.Role;

	beforeAll(async () => {
		await initTestDb(true);
		root = await signup({ username: 'root' });
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
		carol = await signup({ username: 'carol' });
		remote = await signup({ username: 'remote', host: 'remote.example' });

		editRole = await role(root, { name: 'Can edit notes' }, {
			canEditNote: {
				useDefault: false,
				priority: 1,
				value: true,
			},
		});
		moderatorRole = await role(root, { name: 'Moderator', isModerator: true });

		assert.strictEqual((await api('admin/roles/assign', {
			roleId: editRole.id,
			userId: alice.id,
		}, root)).status, 204);
		assert.strictEqual((await api('admin/roles/assign', {
			roleId: moderatorRole.id,
			userId: bob.id,
		}, root)).status, 204);
		assert.strictEqual((await api('following/create', { userId: alice.id }, bob)).status, 200);
	}, 1000 * 60 * 2);

	afterAll(async () => {
		await api('admin/roles/unassign', { roleId: editRole.id, userId: alice.id }, root);
		await api('admin/roles/unassign', { roleId: moderatorRole.id, userId: bob.id }, root);
	});

	test('rejects editing when the role policy does not allow it', async () => {
		const note = await post(carol, { text: 'original' });
		const response = await api('notes/update', {
			noteId: note.id,
			text: 'edited',
			cw: null,
		}, carol);

		assert.strictEqual(response.status, 400);
		assert.strictEqual(castAsError(response.body as any).error.code, 'CANNOT_EDIT_NOTE');
	});

	test('publishes edited events to the note and author main streams', async () => {
		const note = await post(alice, { text: 'before streaming edit' });
		const ws = new WebSocket(`ws://127.0.0.1:${port}/streaming?i=${alice.token}`);
		await once(ws, 'open');

		const ready = new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Timed out connecting to the main stream')), 5000);
			ws.on('message', data => {
				const message = JSON.parse(data.toString());
				if (message.type === 'connected' && message.body.id === 'main') {
					clearTimeout(timeout);
					resolve();
				}
			});
		});
		ws.send(JSON.stringify({ type: 'sr', body: { id: note.id } }));
		ws.send(JSON.stringify({
			type: 'connect',
			body: { channel: 'main', id: 'main', pong: true, params: {} },
		}));

		try {
			await ready;

			const noteEvent = new Promise<void>((resolve) => {
				ws.on('message', data => {
					const message = JSON.parse(data.toString());
					if (message.type === 'noteUpdated' && message.body.id === note.id && message.body.type === 'edited') {
						assert.strictEqual(message.body.body.note.text, 'after streaming edit');
						resolve();
					}
				});
			});
			const mainEvent = new Promise<void>((resolve) => {
				ws.on('message', data => {
					const message = JSON.parse(data.toString());
					if (message.type === 'channel' && message.body.id === 'main' && message.body.type === 'noteUpdated') {
						assert.strictEqual(message.body.body, note.id);
						resolve();
					}
				});
			});

			const response = await api('notes/update', {
				noteId: note.id,
				text: 'after streaming edit',
				cw: null,
			}, alice);
			assert.strictEqual(response.status, 204);

			await Promise.race([
				Promise.all([noteEvent, mainEvent]),
				new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for note edit stream events')), 5000)),
			]);
		} finally {
			ws.close();
		}
	});

	test('stores each previous version in order', async () => {
		const note = await post(alice, { text: 'version 1', cw: 'cw 1' });

		assert.strictEqual((await api('notes/update', {
			noteId: note.id,
			text: 'version 2',
			cw: 'cw 2',
		}, alice)).status, 204);
		assert.strictEqual((await api('notes/update', {
			noteId: note.id,
			text: 'version 3',
			cw: null,
		}, alice)).status, 204);

		const current = await api('notes/show', { noteId: note.id }, alice);
		assert.strictEqual(current.status, 200);
		assert.strictEqual(current.body.text, 'version 3');
		assert.strictEqual(current.body.cw, null);
		assert.ok(current.body.updatedAt);
		const partial = await api('notes/show-partial-bulk', { noteIds: [note.id] }, alice);
		assert.strictEqual(partial.status, 200);
		assert.strictEqual(partial.body[0]?.updatedAt, current.body.updatedAt);

		const histories = await api('notes/histories', { noteId: note.id }, alice);
		assert.strictEqual(histories.status, 200);
		assert.deepStrictEqual(histories.body.map(history => [history.text, history.cw]), [
			['version 2', 'cw 2'],
			['version 1', 'cw 1'],
		]);
	});

	test('does not expose edit histories outside the note audience', async () => {
		const note = await post(alice, {
			text: 'private version 1',
			visibility: 'specified',
			visibleUserIds: [carol.id],
		});

		assert.strictEqual((await api('notes/update', {
			noteId: note.id,
			text: 'private version 2',
			cw: null,
		}, alice)).status, 204);

		const visible = await api('notes/histories', { noteId: note.id }, carol);
		assert.strictEqual(visible.status, 200);
		assert.strictEqual(visible.body[0]?.text, 'private version 1');

		for (const requester of [bob, undefined]) {
			const hidden = await api('notes/histories', { noteId: note.id }, requester);
			assert.strictEqual(hidden.status, 400);
			assert.strictEqual(castAsError(hidden.body as any).error.code, 'NO_SUCH_NOTE');
		}
	});

	test('only returns partial note updates visible to the requester', async () => {
		const publicNote = await post(alice, { text: 'public partial update', visibility: 'public' });
		const followersNote = await post(alice, { text: 'followers partial update', visibility: 'followers' });
		const specifiedNote = await post(alice, {
			text: 'specified partial update',
			visibility: 'specified',
			visibleUserIds: [carol.id],
		});
		const noteIds = [publicNote.id, followersNote.id, specifiedNote.id];

		async function visibleIds(requester?: misskey.entities.SignupResponse): Promise<string[]> {
			const response = await api('notes/show-partial-bulk', { noteIds }, requester);
			assert.strictEqual(response.status, 200);
			return response.body.map(note => note.id).sort();
		}

		assert.deepStrictEqual(await visibleIds(alice), [...noteIds].sort());
		assert.deepStrictEqual(await visibleIds(bob), [publicNote.id, followersNote.id].sort());
		assert.deepStrictEqual(await visibleIds(carol), [publicNote.id, specifiedNote.id].sort());
		assert.deepStrictEqual(await visibleIds(), [publicNote.id]);
	});

	test('applies time-based author visibility policies to partial updates and histories', async () => {
		const note = await post(alice, { text: 'time restricted version 1', visibility: 'public' });
		assert.strictEqual((await api('notes/update', {
			noteId: note.id,
			text: 'time restricted version 2',
			cw: null,
		}, alice)).status, 204);
		const cutoff = Math.floor(Date.now() / 1000) + 1;

		async function visiblePartialIds(requester?: misskey.entities.SignupResponse): Promise<string[]> {
			const response = await api('notes/show-partial-bulk', { noteIds: [note.id] }, requester);
			assert.strictEqual(response.status, 200);
			return response.body.map(item => item.id);
		}

		async function assertHistoriesHidden(requester?: misskey.entities.SignupResponse): Promise<void> {
			const response = await api('notes/histories', { noteId: note.id }, requester);
			assert.strictEqual(response.status, 400);
			assert.strictEqual(castAsError(response.body as any).error.code, 'NO_SUCH_NOTE');
		}

		try {
			assert.strictEqual((await api('i/update', {
				makeNotesFollowersOnlyBefore: cutoff,
			}, alice)).status, 200);

			assert.deepStrictEqual(await visiblePartialIds(alice), [note.id]);
			assert.deepStrictEqual(await visiblePartialIds(bob), [note.id]);
			assert.deepStrictEqual(await visiblePartialIds(carol), []);
			assert.deepStrictEqual(await visiblePartialIds(), []);

			for (const requester of [alice, bob]) {
				const response = await api('notes/histories', { noteId: note.id }, requester);
				assert.strictEqual(response.status, 200);
				assert.strictEqual(response.body[0]?.text, 'time restricted version 1');
			}
			await assertHistoriesHidden(carol);
			await assertHistoriesHidden();

			assert.strictEqual((await api('i/update', {
				makeNotesFollowersOnlyBefore: null,
				makeNotesHiddenBefore: cutoff,
			}, alice)).status, 200);

			assert.deepStrictEqual(await visiblePartialIds(alice), [note.id]);
			assert.deepStrictEqual(await visiblePartialIds(bob), []);
			assert.deepStrictEqual(await visiblePartialIds(carol), []);
			assert.deepStrictEqual(await visiblePartialIds(), []);

			const authorHistories = await api('notes/histories', { noteId: note.id }, alice);
			assert.strictEqual(authorHistories.status, 200);
			assert.strictEqual(authorHistories.body[0]?.text, 'time restricted version 1');
			await assertHistoriesHidden(bob);
			await assertHistoriesHidden(carol);
			await assertHistoriesHidden();
		} finally {
			assert.strictEqual((await api('i/update', {
				makeNotesFollowersOnlyBefore: null,
				makeNotesHiddenBefore: null,
			}, alice)).status, 200);
		}
	});

	test('does not return partial note updates to visitors when the author requires sign-in', async () => {
		const update = await api('i/update', { requireSigninToViewContents: true }, alice);
		assert.strictEqual(update.status, 200);
		const note = await post(alice, { text: 'signed-in viewers only', visibility: 'public' });

		try {
			const signedIn = await api('notes/show-partial-bulk', { noteIds: [note.id] }, bob);
			assert.strictEqual(signedIn.status, 200);
			assert.deepStrictEqual(signedIn.body.map(item => item.id), [note.id]);

			const visitor = await api('notes/show-partial-bulk', { noteIds: [note.id] });
			assert.strictEqual(visitor.status, 200);
			assert.deepStrictEqual(visitor.body, []);
		} finally {
			assert.strictEqual((await api('i/update', { requireSigninToViewContents: false }, alice)).status, 200);
		}
	});

	test('clears attachments while retaining the poll, votes, and channel', async () => {
		const channel = await api('channels/create', { name: 'edited note channel' }, alice);
		assert.strictEqual(channel.status, 200);
		const firstFile = await uploadFile(alice);
		const secondFile = await uploadFile(alice, { name: 'second.jpg' });
		assert.ok(firstFile.body);
		assert.ok(secondFile.body);

		const note = await post(alice, {
			text: 'with files and poll',
			channelId: channel.body.id,
			fileIds: [firstFile.body.id, secondFile.body.id],
			poll: { choices: ['one', 'two'] },
		});
		assert.strictEqual((await api('notes/polls/vote', { noteId: note.id, choice: 0 }, bob)).status, 204);

		assert.strictEqual((await api('notes/update', {
			noteId: note.id,
			text: 'without files',
			cw: null,
			fileIds: [],
		}, alice)).status, 204);

		const updated = await api('notes/show', { noteId: note.id }, bob);
		assert.strictEqual(updated.status, 200);
		assert.deepStrictEqual(updated.body.fileIds, []);
		assert.strictEqual(updated.body.channelId, channel.body.id);
		assert.ok(updated.body.poll);
		assert.strictEqual(updated.body.poll.choices[0].votes, 1);
		assert.strictEqual(updated.body.poll.choices[0].isVoted, true);
	});

	test('rejects attaching another user\'s file', async () => {
		const note = await post(alice, { text: 'owned by alice' });
		const file = await uploadFile(bob);
		assert.ok(file.body);

		const response = await api('notes/update', {
			noteId: note.id,
			text: 'still owned by alice',
			cw: null,
			fileIds: [file.body.id],
		}, alice);
		assert.strictEqual(response.status, 400);
		assert.strictEqual(castAsError(response.body as any).error.code, 'NO_SUCH_FILE');
	});

	test('clears mentions removed by an edit', async () => {
		const note = await post(alice, { text: `hello @${bob.username}` });
		assert.ok(note.mentions?.includes(bob.id));

		assert.strictEqual((await api('notes/update', {
			noteId: note.id,
			text: 'no mentions remain',
			cw: null,
		}, alice)).status, 204);

		const updated = await api('notes/show', { noteId: note.id }, alice);
		assert.strictEqual(updated.status, 200);
		assert.ok(!updated.body.mentions?.includes(bob.id));
	});

	test('cleans tracking parameters when creating and editing notes', async () => {
		const note = await post(alice, {
			text: 'create https://example.com/page?utm_source=create-test&keep=1',
		});
		assert.strictEqual(note.text, 'create https://example.com/page?keep=1');

		assert.strictEqual((await api('notes/update', {
			noteId: note.id,
			text: 'edit https://example.com/page?utm_medium=edit-test&keep=2',
			cw: null,
		}, alice)).status, 204);

		const updated = await api('notes/show', { noteId: note.id }, alice);
		assert.strictEqual(updated.status, 200);
		assert.strictEqual(updated.body.text, 'edit https://example.com/page?keep=2');
	});

	test('rejects empty and whitespace-only note content', async () => {
		const note = await post(alice, { text: 'cannot become empty' });

		const empty = await api('notes/update', {
			noteId: note.id,
			text: null,
			cw: null,
		}, alice);
		assert.strictEqual(empty.status, 400);
		assert.strictEqual(castAsError(empty.body as any).error.code, 'INVALID_NOTE_CONTENT');

		const whitespace = await api('notes/update', {
			noteId: note.id,
			text: '   ',
			cw: null,
		}, alice);
		assert.strictEqual(whitespace.status, 400);
	});

	test('allows a moderator to edit another user\'s note', async () => {
		const note = await post(alice, { text: 'before moderation' });
		const response = await api('notes/update', {
			noteId: note.id,
			text: 'after moderation',
			cw: null,
		}, bob);
		assert.strictEqual(response.status, 204);

		const updated = await api('notes/show', { noteId: note.id }, alice);
		assert.strictEqual(updated.status, 200);
		assert.strictEqual(updated.body.text, 'after moderation');
		assert.strictEqual(updated.body.userId, alice.id);
	});

	test('rejects a moderator editing a remote note cache', async () => {
		const note = await post(remote, { text: 'remote authority' });
		const response = await api('notes/update', {
			noteId: note.id,
			text: 'local override',
			cw: null,
		}, bob);

		assert.strictEqual(response.status, 400);
		assert.strictEqual(castAsError(response.body as any).error.code, 'ACCESS_DENIED');

		const unchanged = await api('notes/show', { noteId: note.id }, alice);
		assert.strictEqual(unchanged.status, 200);
		assert.strictEqual(unchanged.body.text, 'remote authority');
	});
});

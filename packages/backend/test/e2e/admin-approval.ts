/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { afterAll, beforeAll, describe, test } from 'vitest';
import type * as misskey from 'misskey-js';
import { MiModerationLog } from '@/models/ModerationLog.js';
import { api, castAsError, initTestDb, role, signup } from '../utils.js';

describe('Account approval', () => {
	let root: misskey.entities.SignupResponse;
	let regular: misskey.entities.SignupResponse;
	let moderator: misskey.entities.SignupResponse;

	beforeAll(async () => {
		await initTestDb(true);
		root = await signup({ username: 'root' });
		assert.ok(root.id, JSON.stringify(root));
		assert.strictEqual((await api('admin/update-meta', {
			approvalRequiredForSignup: false,
		}, root)).status, 204);

		regular = await signup({ username: 'regular' });
		moderator = await signup({ username: 'approval_mod' });
		assert.ok(regular.id, JSON.stringify(regular));
		assert.ok(moderator.id, JSON.stringify(moderator));

		const moderatorRole = await role(root, { name: 'Moderator', isModerator: true });
		assert.ok(moderatorRole.id, JSON.stringify(moderatorRole));
		const assignResponse = await api('admin/roles/assign', {
			roleId: moderatorRole.id,
			userId: moderator.id,
		}, root);
		assert.strictEqual(assignResponse.status, 204, JSON.stringify(assignResponse.body));

		assert.strictEqual((await api('admin/update-meta', {
			approvalRequiredForSignup: true,
		}, root)).status, 204);
	}, 1000 * 60 * 2);

	afterAll(async () => {
		await api('admin/update-meta', { approvalRequiredForSignup: false }, root);
	});

	test('requires moderator permission', async () => {
		const pending = await createPendingUser('permission_check');
		const response = await api('admin/approve-user', { userId: pending.id }, regular);

		assert.strictEqual(response.status, 403);
		assert.strictEqual(castAsError(response.body as any).error.code, 'ROLE_PERMISSION_DENIED');
	});

	test('returns a structured error for an unknown user', async () => {
		const response = await api('admin/approve-user', { userId: '0000000000000000' }, moderator);

		assert.strictEqual(response.status, 400);
		assert.strictEqual(castAsError(response.body as any).error.code, 'NO_SUCH_USER');
	});

	test('approves a user once under concurrent requests, removes it from the pending list, and records one audit entry', async () => {
		const pending = await createPendingUser('approval_target');

		const responses = await Promise.all(Array.from({ length: 5 }, () => (
			api('admin/approve-user', { userId: pending.id }, moderator)
		)));
		for (const response of responses) {
			assert.strictEqual(response.status, 204);
		}

		const info = await api('admin/show-user', { userId: pending.id }, moderator);
		assert.strictEqual(info.status, 200);
		assert.strictEqual(info.body.approved, true);

		const pendingUsers = await api('admin/show-users', { state: 'pendingApproval', limit: 100 }, moderator);
		assert.strictEqual(pendingUsers.status, 200);
		assert.ok(!pendingUsers.body.some(user => user.id === pending.id));

		const connection = await initTestDb(true);
		try {
			const moderationLogs = connection.getRepository(MiModerationLog);
			assert.strictEqual(await moderationLogs.countBy({
				type: 'approve',
				userId: moderator.id,
			}), 1);
		} finally {
			await connection.destroy();
		}
	});

	async function createPendingUser(username: string): Promise<misskey.entities.UserDetailed> {
		const signupResponse = await api('signup', {
			username,
			password: 'test',
			reason: 'e2e approval test',
		});
		assert.strictEqual(signupResponse.status, 204);

		const pendingUsers = await api('admin/show-users', {
			state: 'pendingApproval',
			username,
			limit: 100,
		}, moderator);
		assert.strictEqual(pendingUsers.status, 200);
		const pending = pendingUsers.body.find(user => user.username === username);
		assert.ok(pending);
		return pending;
	}
});

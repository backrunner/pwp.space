/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { afterAll, beforeAll, describe, test } from 'vitest';
import type * as misskey from 'misskey-js';
import { MiModerationLog } from '@/models/ModerationLog.js';
import { MiUser } from '@/models/User.js';
import { MiUserPending } from '@/models/UserPending.js';
import { MiAccessToken } from '@/models/AccessToken.js';
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

	test('publishes the approval setting and requires a nonempty reason of at most 1000 characters', async () => {
		for (const detail of [false, true]) {
			const response = await api('meta', { detail });
			assert.strictEqual(response.body.approvalRequiredForSignup, true);
		}
		for (const reason of [undefined, '', '   ', 'x'.repeat(1001)]) {
			const response = await api('signup', { username: 'invalid_reason', password: 'test', reason });
			assert.strictEqual(response.status, 400);
		}
	});

	test('allows ordinary signup without a reason when approval is disabled', async () => {
		assert.strictEqual((await api('admin/update-meta', { approvalRequiredForSignup: false }, root)).status, 204);
		try {
			const response = await api('signup', { username: 'approval_disabled', password: 'test' });
			assert.strictEqual(response.status, 200);
			assert.ok(response.body?.token);
			const info = await api('admin/show-user', { userId: response.body.id }, moderator);
			assert.strictEqual(info.body.approved, true);
			assert.strictEqual((await api('i', {}, { token: response.body.token })).status, 200);
		} finally {
			await api('admin/update-meta', { approvalRequiredForSignup: true }, root);
		}
	});

	test('blocks pending users from signing in and using an account token, then allows both after approval', async () => {
		const pending = await createPendingUser('login_target');
		const info = await api('admin/show-user', { userId: pending.id }, moderator);
		assert.strictEqual(info.body.approved, false);
		assert.strictEqual(info.body.signupReason, 'e2e approval test');

		const connection = await initTestDb(true);
		let token: string;
		const appToken = 'approval-app-access-token';
		try {
			const user = await connection.getRepository(MiUser).findOneByOrFail({ id: pending.id });
			token = user.token!;
			await connection.getRepository(MiAccessToken).insert({
				id: `${pending.id}1`, userId: pending.id, token: appToken, hash: appToken, permission: ['read:account'],
			});
		} finally {
			await connection.destroy();
		}
		const deniedLogin = await api('signin-flow', { username: pending.username, password: 'test' });
		assert.strictEqual(deniedLogin.status, 403);
		assert.strictEqual(castAsError(deniedLogin.body as any).error.code, 'YOUR_ACCOUNT_NOT_APPROVED');
		const deniedApi = await api('i', {}, { token });
		assert.strictEqual(deniedApi.status, 403);
		assert.strictEqual(castAsError(deniedApi.body as any).error.code, 'YOUR_ACCOUNT_NOT_APPROVED');
		assert.strictEqual((await api('i', {}, { token: appToken })).status, 403);

		assert.strictEqual((await api('admin/approve-user', { userId: pending.id }, root)).status, 204);
		const login = await api('signin-flow', { username: pending.username, password: 'test' });
		assert.strictEqual(login.status, 200);
		assert.strictEqual(login.body.finished, true);
		assert.strictEqual((await api('i', {}, { token })).status, 200);
		assert.strictEqual((await api('i', {}, { token: appToken })).status, 200);
	});

	test('excludes rejected accounts from the pending list before the deletion job runs', async () => {
		const pending = await createPendingUser('rejected_target');
		assert.strictEqual((await api('admin/delete-account', { userId: pending.id }, root)).status, 204);
		const response = await api('admin/show-users', { state: 'pendingApproval', username: pending.username }, moderator);
		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.body.length, 0);
		const approve = await api('admin/approve-user', { userId: pending.id }, moderator);
		assert.strictEqual(approve.status, 400);
		assert.strictEqual(castAsError(approve.body as any).error.code, 'NO_SUCH_USER');
	});

	test('does not list or approve remote accounts', async () => {
		const connection = await initTestDb(true);
		let remote: MiUser;
		try {
			remote = await connection.getRepository(MiUser).save({
				id: '0000000000000001', username: 'remote_pending', usernameLower: 'remote_pending', host: 'example.com', approved: false,
			});
		} finally {
			await connection.destroy();
		}
		const response = await api('admin/show-users', { state: 'pendingApproval', username: remote.username }, moderator);
		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.body.length, 0);
		assert.strictEqual((await api('admin/approve-user', { userId: remote.id }, moderator)).status, 400);
	});

	test('preserves the reason through email verification and still requires approval before login', async () => {
		assert.strictEqual((await api('admin/update-meta', { emailRequiredForSignup: true }, root)).status, 204);
		try {
			const username = 'email_target';
			const response = await api('signup', {
				username, password: 'test', emailAddress: 'approval@example.com', reason: '  Email approval reason  ',
			});
			assert.strictEqual(response.status, 204);
			const before = await api('admin/show-users', { state: 'pendingApproval', username }, moderator);
			assert.strictEqual(before.body.length, 0);
			const connection = await initTestDb(true);
			let code: string;
			try {
				const pending = await connection.getRepository(MiUserPending).findOneByOrFail({ username });
				assert.strictEqual(pending.reason, 'Email approval reason');
				code = pending.code;
			} finally {
				await connection.destroy();
			}
			const verified = await api('signup-pending', { code });
			assert.strictEqual(verified.status, 200);
			assert.deepStrictEqual(verified.body, { pendingApproval: true });
			const users = await api('admin/show-users', { state: 'pendingApproval', username }, moderator);
			assert.strictEqual(users.body.length, 1);
			const info = await api('admin/show-user', { userId: users.body[0].id }, moderator);
			assert.strictEqual(info.body.signupReason, 'Email approval reason');
			assert.strictEqual(info.body.email, 'approval@example.com');
			assert.strictEqual(info.body.emailVerified, true);
			assert.strictEqual((await api('signin-flow', { username, password: 'test' })).status, 403);
			assert.strictEqual((await api('admin/approve-user', { userId: users.body[0].id }, moderator)).status, 204);
			assert.strictEqual((await api('signin-flow', { username, password: 'test' })).status, 200);
		} finally {
			await api('admin/update-meta', { emailRequiredForSignup: false }, root);
		}
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
				info: { userId: pending.id, userUsername: pending.username, userHost: null },
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

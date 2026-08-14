/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import DeleteAccountEndpoint from '@/server/api/endpoints/admin/delete-account.js';
import type { DeleteAccountService } from '@/core/DeleteAccountService.js';
import type { UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';

describe('admin/delete-account endpoint', () => {
	let usersRepository: Pick<UsersRepository, 'findOneByOrFail'>;
	let deleteAccountService: Pick<DeleteAccountService, 'deleteAccount'>;
	let endpoint: DeleteAccountEndpoint;
	const moderator = { id: 'moderator' } as MiLocalUser;

	beforeEach(() => {
		usersRepository = {
			findOneByOrFail: vi.fn(),
		};
		deleteAccountService = {
			deleteAccount: vi.fn(),
		};
		endpoint = new DeleteAccountEndpoint(
			usersRepository as UsersRepository,
			deleteAccountService as DeleteAccountService,
		);
	});

	test('upgrades a soft-deleted remote account to a hard delete', async () => {
		const user = { id: 'remoteuser', host: 'remote.example', isDeleted: true };
		vi.mocked(usersRepository.findOneByOrFail).mockResolvedValue(user as never);

		await endpoint.exec({ userId: user.id, hardDelete: true }, moderator, null);

		expect(deleteAccountService.deleteAccount).toHaveBeenCalledWith(user, moderator, { hardDelete: true });
	});

	test('keeps an already deleted account idempotent without a hard-delete request', async () => {
		const user = { id: 'remoteuser', host: 'remote.example', isDeleted: true };
		vi.mocked(usersRepository.findOneByOrFail).mockResolvedValue(user as never);

		await endpoint.exec({ userId: user.id, hardDelete: false }, moderator, null);

		expect(deleteAccountService.deleteAccount).not.toHaveBeenCalled();
	});
});

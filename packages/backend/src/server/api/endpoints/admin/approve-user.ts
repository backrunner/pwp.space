/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { DI } from '@/di-symbols.js';
import { EmailService } from '@/core/EmailService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:approve-account',

	errors: {
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: 'b8373478-2c74-499b-8fae-0615f9299005',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private moderationLogService: ModerationLogService,
		private emailService: EmailService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const user = await this.usersRepository.findOneBy({ id: ps.userId });

			if (user == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			const result = await this.usersRepository.update({
				id: user.id,
				approved: false,
			}, {
				approved: true,
			});
			if (result.affected !== 1) return;

			const profile = await this.userProfilesRepository.findOneBy({ userId: ps.userId });

			await this.moderationLogService.log(me, 'approve', {
				userId: user.id,
				userUsername: user.username,
				userHost: user.host,
			});

			if (profile?.email) {
				await this.emailService.sendEmail(profile.email, 'Account Approved',
					'Your Account has been approved have fun socializing!',
					'Your Account has been approved have fun socializing!')
					.catch(() => { /* EmailService already logged the failure. */ });
			}
		});
	}
}

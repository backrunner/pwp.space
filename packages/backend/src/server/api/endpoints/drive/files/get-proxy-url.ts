/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { getProxySign } from '@/misc/media-proxy.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['drive'],
	description: 'Get a same-origin media proxy URL for a drive file.',

	requireCredential: true,

	kind: 'read:drive',

	limit: {
		duration: 60 * 1000,
		max: 30,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},

	errors: {
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'cc607b13-ec5f-4fae-aff6-c637172a91b1',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		fileId: { type: 'string', format: 'misskey:id' },
	},
	required: ['fileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const file = await this.driveFilesRepository.findOneBy({
				id: ps.fileId,
				userId: me.id,
			});

			if (file == null) {
				throw new ApiError(meta.errors.noSuchFile);
			}

			return {
				url: appendQuery(`${this.config.url}/proxy/image.webp`, query({
					url: file.url,
					origin: '1',
					...(this.config.mediaProxyKey != null ? {
						sign: getProxySign(file.url, this.config.mediaProxyKey, this.config.url),
					} : {}),
				})),
			};
		});
	}
}

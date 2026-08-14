/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import crypto from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const md5 = (payload: string | Buffer) => {
	const hash = crypto.createHash('md5');
	hash.update(payload);
	return hash.digest('hex');
};

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { loadConfig } from '@/config.js';
import { getProxySign } from '@/misc/media-proxy.js';
import { api, castAsError, makeStreamCatcher, origin, post, signup, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

const config = loadConfig();

describe('Drive', () => {
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
	}, 1000 * 60 * 2);

	test('ファイルURLからアップロードできる', async () => {
		// utils.js uploadUrl の処理だがAPIレスポンスも見るためここで同様の処理を書いている

		const marker = Math.random().toString();

		const url = 'https://raw.githubusercontent.com/misskey-dev/misskey/develop/packages/backend/test/resources/192.jpg';

		const catcher = makeStreamCatcher(
			alice,
			'main',
			(msg) => msg.type === 'urlUploadFinished' && msg.body.marker === marker,
			(msg) => msg.body.file,
			10 * 1000);

		const res = await api('drive/files/upload-from-url', {
			url,
			marker,
			force: true,
		}, alice);

		const file = await catcher;

		assert.strictEqual(res.status, 204);
		assert.strictEqual(file.name, '192.jpg');
		assert.strictEqual(file.type, 'image/jpeg');
	});

	test('ローカルからアップロードできる', async () => {
		// APIレスポンスを直接使用するので utils.js uploadFile が通過することで成功とする

		const res = await uploadFile(alice, { path: '192.jpg', name: 'テスト画像' });

		assert.strictEqual(res.body?.name, 'テスト画像.jpg');
		assert.strictEqual(res.body.type, 'image/jpeg');
	});

	test('drive/files/get-proxy-urlは認証を必要とする', async () => {
		const file = await uploadFile(alice);
		assert.ok(file.body);

		const res = await api('drive/files/get-proxy-url', { fileId: file.body.id });

		assert.strictEqual(res.status, 401);
	});

	test('drive/files/get-proxy-urlは他のユーザーのファイルを参照できない', async () => {
		const file = await uploadFile(alice);
		assert.ok(file.body);

		const res = await api('drive/files/get-proxy-url', { fileId: file.body.id }, bob);

		assert.strictEqual(res.status, 400);
		assert.strictEqual(castAsError(res.body).error.code, 'NO_SUCH_FILE');
	});

	test('drive/files/get-proxy-urlは署名付きの同一オリジンURLを返す', async () => {
		const file = await uploadFile(alice);
		assert.ok(file.body);

		const res = await api('drive/files/get-proxy-url', { fileId: file.body.id }, alice);

		assert.strictEqual(res.status, 200);
		const proxyUrl = new URL(res.body.url);
		assert.strictEqual(proxyUrl.origin, origin);
		assert.strictEqual(proxyUrl.pathname, '/proxy/image.webp');
		assert.strictEqual(proxyUrl.searchParams.get('url'), file.body.url);
		assert.strictEqual(proxyUrl.searchParams.get('origin'), '1');
		assert.strictEqual(proxyUrl.searchParams.get('sign'), getProxySign(file.body.url, config.mediaProxyKey, origin));
	});

	test('添付ノート一覧を取得できる', async () => {
		const ids = (await Promise.all([uploadFile(alice), uploadFile(alice), uploadFile(alice)])).map(elm => elm.body!.id);

		const note0 = await post(alice, { fileIds: [ids[0]] });
		const note1 = await post(alice, { fileIds: [ids[0], ids[1]] });

		const attached0 = await api('drive/files/attached-notes', { fileId: ids[0] }, alice);
		assert.strictEqual(attached0.body.length, 2);
		assert.strictEqual(attached0.body[0].id, note1.id);
		assert.strictEqual(attached0.body[1].id, note0.id);

		const attached1 = await api('drive/files/attached-notes', { fileId: ids[1] }, alice);
		assert.strictEqual(attached1.body.length, 1);
		assert.strictEqual(attached1.body[0].id, note1.id);

		const attached2 = await api('drive/files/attached-notes', { fileId: ids[2] }, alice);
		assert.strictEqual(attached2.body.length, 0);
	});

	test('添付ノート一覧は他の人から見えない', async () => {
		const file = await uploadFile(alice);

		await post(alice, { fileIds: [file.body!.id] });

		const res = await api('drive/files/attached-notes', { fileId: file.body!.id }, bob);
		assert.strictEqual(res.status, 400);
		assert.strictEqual('error' in res.body, true);
	});
});

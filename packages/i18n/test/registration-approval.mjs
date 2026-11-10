/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { build, languages, writeFrontendLocalesJson } from '../built/index.js';
import { registrationApprovalTranslations } from '../built/registration-approval.js';

function leaves(object, prefix = '') {
	return Object.entries(object).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return typeof value === 'string' ? [[path, value]] : leaves(value, path);
	});
}

function at(object, path) {
	return path.split('.').reduce((value, key) => value?.[key], object);
}

test('every enabled non-Japanese locale has complete approval translations', () => {
	assert.deepEqual(Object.keys(registrationApprovalTranslations).sort(), languages.filter(lang => !['ja-JP', 'ja-KS'].includes(lang)).sort());
	const keys = leaves(registrationApprovalTranslations['en-US']).map(([path]) => path);
	for (const [lang, messages] of Object.entries(registrationApprovalTranslations)) {
		assert.deepEqual(leaves(messages).map(([path]) => path), keys, lang);
		for (const [path, value] of leaves(messages)) {
			assert.ok(value.trim().length > 0, `${lang}: ${path}`);
			assert.doesNotMatch(value, /[\u3040-\u30ff]/, `${lang}: ${path} must not fall back to Japanese`);
		}
	}
});

test('the loader fills missing approval strings, preserves upstream translations and keeps sibling signup messages', async () => {
	const locales = build();
	for (const [lang, messages] of Object.entries(registrationApprovalTranslations)) {
		const source = load(await readFile(new URL(`../../../locales/${lang}.yml`, import.meta.url), 'utf8'));
		for (const [path, fallback] of leaves(messages)) {
			const upstream = at(source, path);
			assert.equal(at(locales[lang], path), upstream || fallback, `${lang}: ${path}`);
		}
		assert.ok(locales[lang]._signup.almostThere);
	}
	assert.equal(locales['zh-CN'].approveAccount, '批准账号');
	assert.equal(locales['zh-TW'].approveAccount, '核准帳號');
	assert.equal(locales['en-US'].approveAccount, 'Approve account');
});

test('service worker locale JSON contains the same approval text as the shared loader in every language', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'pwp-approval-locales-'));
	try {
		await writeFrontendLocalesJson(directory, 'approval-test');
		const locales = build();
		const paths = leaves(registrationApprovalTranslations['en-US']).map(([path]) => path);
		for (const lang of languages) {
			const json = JSON.parse(await readFile(join(directory, `${lang}.approval-test.json`), 'utf8'));
			for (const path of paths) assert.equal(at(json, path), at(locales[lang], path), `${lang}: ${path}`);
			assert.equal(json._version_, 'approval-test');
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

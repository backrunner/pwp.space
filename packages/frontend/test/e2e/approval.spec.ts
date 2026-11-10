/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import locales from 'i18n';
import { test, expect } from './fixtures.js';
import { api } from './shared.js';
import { BASE_URL, acceptSignupRules, locateMkInput, locateMkSwitch, registerUser, resetState, signIn, visitHome } from './utils.js';
import type { RegisteredUser } from './utils.js';

const locale = locales['en-US'];

test.describe('Registration approval', () => {
	let admin: RegisteredUser;

	test.beforeEach(async () => {
		await resetState();
		admin = await registerUser('admin', 'admin1234', true);
		await api(BASE_URL, 'i/registry/set', { i: admin.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
		await api(BASE_URL, 'admin/update-meta', {
			i: admin.token, disableRegistration: false, emailRequiredForSignup: false,
			approvalRequiredForSignup: false,
		});
	});

	test('saves the approval switch, restores it after reload, and keeps the saved value on failure', async ({ page }) => {
		await signIn(page, 'admin', 'admin1234');
		await expect(page.getByRole('link', { name: locale.controlPanel })).toBeVisible();
		await page.goto(`${BASE_URL}/admin/moderation`);
		const toggle = locateMkSwitch(page, 'signup-approval-required');
		const saved = page.waitForResponse(response => response.url().endsWith('/api/admin/update-meta'));
		await toggle.click();
		expect((await saved).status()).toBe(204);
		await expect.poll(async () => (await api(BASE_URL, 'meta', {})).approvalRequiredForSignup).toBe(true);
		await page.reload();
		await expect(toggle).toBeVisible();
		await page.route('**/api/admin/update-meta', route => route.fulfill({
			status: 403, contentType: 'application/json',
			body: JSON.stringify({ error: { message: 'Approval setting rejected', code: 'ROLE_PERMISSION_DENIED', id: 'test-rejection' } }),
		}));
		await toggle.click();
		await expect(page.getByText(locale.permissionDeniedErrorDescription)).toBeVisible();
		await page.getByTestId('modal-dialog-ok').click();
		await page.unroute('**/api/admin/update-meta');
		const disabled = page.waitForRequest(request => request.url().endsWith('/api/admin/update-meta'));
		await toggle.click();
		expect((await disabled).postDataJSON().approvalRequiredForSignup).toBe(false);
		await expect.poll(async () => (await api(BASE_URL, 'meta', {})).approvalRequiredForSignup).toBe(false);
	});

	test('submits an application, blocks login, shows its reason in the panel, and allows login after approval', async ({ page, browser }) => {
		await api(BASE_URL, 'admin/update-meta', { i: admin.token, approvalRequiredForSignup: true });
		await visitHome(page);
		await page.getByTestId('signup').click();
		await acceptSignupRules(page);
		await locateMkInput(page, 'signup-username').fill('approval_user');
		await locateMkInput(page, 'signup-password').fill('approval1234');
		await locateMkInput(page, 'signup-password-retype').fill('approval1234');
		await expect(page.getByTestId('signup-submit')).toBeDisabled();
		await page.locator('[data-cy-signup-reason] input').fill('I would like to join this community.');
		const signup = page.waitForResponse(response => response.url().endsWith('/api/signup'));
		await page.getByTestId('signup-submit').click();
		expect((await signup).status()).toBe(204);
		await expect(page.getByText(locale._signup.approvalPending)).toBeVisible();
		await page.getByTestId('modal-dialog-ok').click();
		await signIn(page, 'approval_user', 'approval1234');
		await expect(page.getByText(locale.registerHasNotBeenApprovedYet)).toBeVisible();
		await page.getByTestId('modal-dialog-ok').click();

		const adminContext = await browser.newContext();
		try {
			const adminPage = await adminContext.newPage();
			await signIn(adminPage, 'admin', 'admin1234');
			await expect(adminPage.getByRole('link', { name: locale.controlPanel })).toBeVisible();
			await adminPage.goto(`${BASE_URL}/admin`);
			await adminPage.getByRole('link', { name: locale.signupPendingApprovals }).click();
			await adminPage.getByText('User: approval_user', { exact: true }).click();
			await expect(adminPage.getByText('I would like to join this community.', { exact: true })).toBeVisible();
			await adminPage.getByRole('button', { name: locale.approveAccount, exact: true }).click();
			const approved = adminPage.waitForResponse(response => response.url().endsWith('/api/admin/approve-user'));
			await adminPage.getByTestId('modal-dialog-ok').click();
			expect((await approved).status()).toBe(204);
			await expect(adminPage.getByText('User: approval_user', { exact: true })).toHaveCount(0);
			const refreshed = adminPage.waitForResponse(response => response.url().endsWith('/api/admin/show-users') && response.request().postDataJSON().limit > 1);
			await adminPage.reload();
			const refreshedResponse = await refreshed;
			expect(refreshedResponse.status()).toBe(200);
			expect(await refreshedResponse.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ username: 'approval_user' })]));
			await expect(adminPage.getByText('User: approval_user', { exact: true })).toHaveCount(0);
		} finally {
			await adminContext.close();
		}
		await page.reload();
		await signIn(page, 'approval_user', 'approval1234');
		await expect(page.getByTestId('user-setup-continue')).toBeVisible();
	});

	test('rejects an application and keeps it out of the list after reload', async ({ page }) => {
		await api(BASE_URL, 'admin/update-meta', { i: admin.token, approvalRequiredForSignup: true });
		await api(BASE_URL, 'signup', { username: 'rejected_user', password: 'test1234', reason: 'Application to reject' });
		await signIn(page, 'admin', 'admin1234');
		await expect(page.getByRole('link', { name: locale.controlPanel })).toBeVisible();
		await page.goto(`${BASE_URL}/admin/approvals`);
		await page.getByText('User: rejected_user', { exact: true }).click();
		await page.getByRole('button', { name: locale.denyAccount, exact: true }).click();
		await page.getByTestId('modal-dialog-ok').click();
		await page.getByRole('textbox').fill('rejected_user');
		await expect(page.getByTestId('modal-dialog-ok')).toHaveCount(1);
		const rejected = page.waitForResponse(response => response.url().endsWith('/api/admin/delete-account'));
		await page.getByTestId('modal-dialog-ok').click();
		expect((await rejected).status()).toBe(204);
		await expect(page.getByText('User: rejected_user', { exact: true })).toHaveCount(0);
		const refreshed = page.waitForResponse(response => response.url().endsWith('/api/admin/show-users') && response.request().postDataJSON().limit > 1);
		await page.reload();
		const refreshedResponse = await refreshed;
		expect(refreshedResponse.status()).toBe(200);
		expect(await refreshedResponse.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ username: 'rejected_user' })]));
		await expect(page.getByText('User: rejected_user', { exact: true })).toHaveCount(0);
	});

	test('allows moderators to approve while keeping account deletion restricted to administrators', async ({ page }) => {
		const moderator = await registerUser('approval_mod', 'moderator1234');
		await api(BASE_URL, 'i/registry/set', { i: moderator.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
		const role = await api(BASE_URL, 'admin/roles/create', {
			i: admin.token, name: 'Moderator', isModerator: true, isAdministrator: false,
			description: '', color: null, iconUrl: null, target: 'manual', condFormula: {},
			isPublic: false, asBadge: false, canEditMembersByModerator: false, displayOrder: 0, policies: {},
		});
		await api(BASE_URL, 'admin/roles/assign', { i: admin.token, roleId: role.id, userId: moderator.id });
		await api(BASE_URL, 'admin/update-meta', { i: admin.token, approvalRequiredForSignup: true });
		await api(BASE_URL, 'signup', { username: 'mod_target', password: 'test1234', reason: 'Moderator approval' });
		await signIn(page, 'approval_mod', 'moderator1234');
		await expect(page.getByRole('link', { name: locale.controlPanel })).toBeVisible();
		await page.goto(`${BASE_URL}/admin/approvals`);
		await page.getByText('User: mod_target', { exact: true }).click();
		await expect(page.getByRole('button', { name: locale.denyAccount, exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: locale.approveAccount, exact: true }).click();
		const approved = page.waitForResponse(response => response.url().endsWith('/api/admin/approve-user'));
		await page.getByTestId('modal-dialog-ok').click();
		expect((await approved).status()).toBe(204);
		await expect(page.getByText('User: mod_target', { exact: true })).toHaveCount(0);
	});

	for (const lang of ['en-US', 'zh-CN', 'zh-TW']) {
		test(`renders registration and approval controls in ${lang}`, async ({ page }) => {
			const messages = locales[lang];
			await page.addInitScript(language => localStorage.setItem('lang', language), lang);
			await api(BASE_URL, 'admin/update-meta', { i: admin.token, approvalRequiredForSignup: true });
			await api(BASE_URL, 'signup', { username: 'locale_target', password: 'test1234', reason: 'Localized application' });
			await visitHome(page);
			await expect(page.getByText(messages.approvalRequiredToRegister)).toBeVisible();
			await signIn(page, 'admin', 'admin1234');
			await expect(page.getByRole('link', { name: messages.controlPanel })).toBeVisible();
			await page.goto(`${BASE_URL}/admin/moderation`);
			await expect(page.getByTestId('signup-approval-required')).toContainText(messages.approvalRequiredForSignup);
			await page.getByRole('link', { name: messages.signupPendingApprovals }).click();
			await page.getByText(`${messages.user}: locale_target`, { exact: true }).click();
			await expect(page.getByText(messages.registerReason, { exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: messages.approveAccount, exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: messages.denyAccount, exact: true })).toBeVisible();
		});
	}
});

/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

type URLCleanerInstance = {
	cleanURLsInText(text: string): Promise<string>;
};

type URLCleanerConstructor = new (options: {
	useDefaultLists: boolean;
	handleRedirects: boolean;
	redirectTimeout: number;
	enableWASM: boolean;
}) => URLCleanerInstance;

let urlCleanerPromise: Promise<URLCleanerInstance> | null = null;

async function getURLCleaner(): Promise<URLCleanerInstance> {
	if (urlCleanerPromise == null) {
		urlCleanerPromise = import('@backrunner/url-cleaner')
			.then(({ default: URLCleaner }) => new (URLCleaner as URLCleanerConstructor)({
				useDefaultLists: true,
				handleRedirects: true,
				redirectTimeout: 5000,
				enableWASM: true,
			}))
			.catch((err) => {
				urlCleanerPromise = null;
				throw err;
			});
	}

	return await urlCleanerPromise;
}

/**
 * Clean links in text
 * @param text Original text containing links to be cleaned
 * @returns Cleaned text
 */
export const cleanLink = async (text: string): Promise<string> => {
	try {
		return await (await getURLCleaner()).cleanURLsInText(text);
	} catch (error) {
		console.error('Failed to clean links in text:', error);
		return text;
	}
};

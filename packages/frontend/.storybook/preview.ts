/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type Preview, setup } from '@storybook/vue3';
import isChromatic from 'chromatic/isChromatic';
import { setupWorker } from 'msw/browser';
import { mswLoader } from 'msw-storybook-addon/csf3';
import { FORCE_RE_RENDER, FORCE_REMOUNT } from 'storybook/internal/core-events';
import { addons } from 'storybook/preview-api';
import { userDetailed } from './fakes.js';
import { commonHandlers, onUnhandledRequest } from './mocks.js';
import themes from './themes.js';
import '../src/style.scss';

const appInitialized = Symbol();
const misskeyThemeKeys = [
	'l-light',
	'l-coffee',
	'l-apricot',
	'l-rainy',
	'l-botanical',
	'l-vivid',
	'l-cherry',
	'l-sushi',
	'l-u0',
	'd-dark',
	'd-persimmon',
	'd-astro',
	'd-future',
	'd-botanical',
	'd-green-lime',
	'd-green-orange',
	'd-cherry',
	'd-ice',
	'd-u0',
] as const;

let lastStory: string | null = null;
let moduleInitialized = false;
let unobserve = () => {};
let misskeyOS = null;

function loadTheme(themeMaganer: typeof import('../src/theme')['themeManager']) {
	unobserve();
	const theme = themes[window.document.documentElement.dataset.misskeyTheme];
	if (theme) {
		themeMaganer.updateTheme(themes[window.document.documentElement.dataset.misskeyTheme]);
	} else {
		themeMaganer.updateTheme(themes['l-light']);
	}
	const observer = new MutationObserver((entries) => {
		for (const entry of entries) {
			if (entry.attributeName === 'data-misskey-theme') {
				const target = entry.target as HTMLElement;
				const theme = themes[target.dataset.misskeyTheme];
				if (theme) {
					themeMaganer.updateTheme(themes[target.dataset.misskeyTheme]);
				} else {
					target.removeAttribute('style');
				}
			}
		}
	});
	observer.observe(window.document.documentElement, {
		attributes: true,
		attributeFilter: ['data-misskey-theme'],
	});
	unobserve = () => observer.disconnect();
}

function initLocalStorage() {
	localStorage.clear();
	localStorage.setItem('account', JSON.stringify({
		...userDetailed(),
		policies: {},
	}));
}

function applyThemeGlobal(theme: unknown): void {
	if (typeof theme === 'string' && Object.hasOwn(themes, theme)) {
		document.documentElement.dataset.misskeyTheme = theme;
	} else {
		delete document.documentElement.dataset.misskeyTheme;
	}
}

async function setupMswWorker() {
	const worker = setupWorker(...commonHandlers);
	await worker.start({
		onUnhandledRequest,
	});
	return worker;
}

initLocalStorage();
queueMicrotask(() => {
	Promise.all([
		import('../src/components/index.js'),
		import('../src/directives/index.js'),
		import('../src/widgets/index.js'),
		import('../src/theme.js'),
		import('../src/preferences.js'),
		import('../src/os.js'),
	]).then(([{ default: components }, { default: directives }, { default: widgets }, { applyTheme }, { prefer }, os]) => {
		setup((app) => {
			moduleInitialized = true;
			if (app[appInitialized]) {
				return;
			}
			app[appInitialized] = true;
			loadTheme(applyTheme);
			components(app);
			directives(app);
			widgets(app);
			misskeyOS = os;
			if (isChromatic()) {
				prefer.commit('animation', false);
			}
		});
	});
});

const preview = {
	initialGlobals: {
		misskeyTheme: '',
	},
	globalTypes: {
		misskeyTheme: {
			name: 'Misskey theme',
			description: 'Active Misskey theme',
			toolbar: {
				icon: 'mirror',
				items: [
					{ type: 'reset', title: '(clear)' },
					...misskeyThemeKeys,
				],
				dynamicTitle: true,
			},
		},
	},
	tags: ['autodocs'],
	decorators: [
		(Story, context) => {
			applyThemeGlobal(context.globals.misskeyTheme);
			if (lastStory === context.id) {
				lastStory = null;
			} else {
				lastStory = context.id;
				const channel = addons.getChannel();
				const resetIndexedDBPromise = globalThis.indexedDB?.databases
					? indexedDB.databases().then((r) => {
							for (let i = 0; i < r.length; i++) {
								indexedDB.deleteDatabase(r[i].name!);
							}
						}).catch(() => {})
					: Promise.resolve();
				const resetDefaultStorePromise = import('../src/store').then(({ store }) => {
					// @ts-expect-error The Storybook reset intentionally reinitializes the singleton store.
					store.init();
				}).catch(() => {});
				Promise.all([resetIndexedDBPromise, resetDefaultStorePromise]).then(() => {
					initLocalStorage();
					channel.emit(FORCE_RE_RENDER, { storyId: context.id });
				});
			}
			const story = Story();
			if (!moduleInitialized) {
				const channel = addons.getChannel();
				(globalThis.requestIdleCallback || setTimeout)(() => {
					channel.emit(FORCE_REMOUNT, { storyId: context.id });
				});
			}
			return story;
		},
		(Story, context) => {
			return {
				setup() {
					return {
						context,
						popups: misskeyOS.popups,
					};
				},
				template:
					'<component :is="popup.component" v-for="popup in popups" :key="popup.id" v-bind="popup.props" v-on="popup.events"/>' +
					'<story />',
			};
		},
	],
	loaders: [mswLoader(setupMswWorker)],
	parameters: {
		controls: {
			exclude: /^__/,
		},
	},
} satisfies Preview;

export default preview;

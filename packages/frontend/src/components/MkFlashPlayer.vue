<!--
SPDX-FileCopyrightText: CenTdemeern1 and other Sharkey contributors
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.flash_player_container">
	<canvas :class="$style.ratio" height="300" width="300"></canvas>

	<button v-if="hide" type="button" :class="$style.flash_player_disabled" :aria-label="i18n.ts.clickToShow" @click="toggleVisible()">
		<div>
			<b><i class="ti ti-eye"></i> {{ i18n.ts.sensitive }}</b>
			<span>{{ i18n.ts.clickToShow }}</span>
		</div>
	</button>

	<div v-else :class="$style.flash_player_enabled">
		<div :class="$style.flash_display">
			<button v-if="playerHide" type="button" :class="$style.player_hide" :aria-label="i18n.ts.clickToShow" @click="dismissWarning()">
				<b><i class="ti ti-eye"></i> {{ i18n.ts._flash.contentHidden }}</b>
				<span>{{ i18n.ts._flash.poweredByRuffle }}</span>
				<span>{{ i18n.ts._flash.arbitraryCodeExecutionWarning }}</span>
				<span>{{ i18n.ts.clickToShow }}</span>
			</button>
			<div v-if="ruffleError" :class="$style.player_hide">
				<b><i class="ti ti-alert-triangle"></i> {{ i18n.ts._flash.failedToLoad }}</b>
				<span>{{ ruffleError }}</span>
			</div>
			<div v-else-if="loadingStatus" :class="$style.player_hide">
				<b>{{ i18n.ts._flash.isLoading }}
					<MkEllipsis/>
				</b>
				<MkLoading/>
				<p>{{ loadingStatus }}</p>
			</div>
			<div ref="ruffleContainer" :class="$style.container"></div>
		</div>
		<div :class="$style.controls">
			<button :key="playPauseButtonKey" type="button" :title="player?.isPlaying ? i18n.ts._flash.pause : i18n.ts._flash.play" :aria-label="player?.isPlaying ? i18n.ts._flash.pause : i18n.ts._flash.play" @click="playPause()">
				<i v-if="player?.isPlaying" class="ti ti-player-pause"></i>
				<i v-else class="ti ti-player-play"></i>
			</button>
			<button type="button" :title="i18n.ts._flash.stop" :aria-label="i18n.ts._flash.stop" :disabled="playerHide" @click="stop()">
				<i class="ti ti-player-stop"></i>
			</button>
			<input v-if="player && !playerHide" v-model="player.volume" type="range" min="0" max="1" step="0.1" :title="i18n.ts.volume" :aria-label="i18n.ts.volume"/>
			<input v-else type="range" min="0" max="1" value="1" :title="i18n.ts.volume" :aria-label="i18n.ts.volume" disabled/>
			<a :title="i18n.ts.download" :aria-label="i18n.ts.download" :href="flashFile.url" :download="flashFile.name" target="_blank" rel="noopener noreferrer">
				<i class="ti ti-download"></i>
			</a>
			<button type="button" :class="$style.fullscreen" :title="i18n.ts._flash.fullscreen" :aria-label="i18n.ts._flash.fullscreen" :disabled="playerHide" @click="fullscreen()">
				<i class="ti ti-maximize"></i>
			</button>
		</div>
		<div v-if="comment" :class="$style.alt" :title="comment">ALT</div>
		<button type="button" :class="$style.hide" :title="i18n.ts._flash.hide" :aria-label="i18n.ts._flash.hide" @click="toggleVisible()"><i class="ti ti-eye-off"></i></button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, onDeactivated } from 'vue';
import * as Misskey from 'misskey-js';
import type { PublicAPI, PublicAPILike } from '@/types/ruffle/setup/index.js'; // This gives us the types for window.RufflePlayer, etc via side effects
import type { PlayerElement } from '@/types/ruffle/player/index.js';
import MkEllipsis from '@/components/global/MkEllipsis.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	flashFile: Misskey.entities.DriveFile
}>();

const isSensitive = props.flashFile.isSensitive;
const url = props.flashFile.url;
const comment = props.flashFile.comment ?? '';
const hide = ref((prefer.s.nsfw === 'force') || isSensitive && (prefer.s.nsfw !== 'ignore'));
const playerHide = ref(true);
const ruffleContainer = ref<HTMLDivElement>();
const playPauseButtonKey = ref<number>(0);
const loadingStatus = ref<string | undefined>(undefined);
const player = ref<PlayerElement | undefined>(undefined);
const ruffleError = ref<string | undefined>(undefined);

async function dismissWarning() {
	playerHide.value = false;
	try {
		await loadRuffle();
		createPlayer();
		await loadContent();
	} catch (error) {
		handleError(error);
	}
}

function handleError(error: unknown) {
	console.error(error);
	loadingStatus.value = undefined;
	ruffleError.value = i18n.ts._flash.failedToLoadDescription;
}

async function loadRuffle() {
	if (window.RufflePlayer !== undefined) return;
	loadingStatus.value = i18n.ts._flash.loadingRufflePlayer;
	await import('@ruffle-rs/ruffle');
	window.RufflePlayer = window.RufflePlayer as PublicAPILike | PublicAPI | undefined; // Assert unknown type due to side effects
	if (window.RufflePlayer === undefined) throw new Error('Ruffle API is unavailable.');

	window.RufflePlayer.config = {
		// Options affecting the whole page
		'publicPath': `https://raw.esm.sh/@ruffle-rs/ruffle@${_RUFFLE_VERSION_}/`,
		'polyfills': false,

		// Options affecting files only
		'allowScriptAccess': false,
		'autoplay': true,
		'unmuteOverlay': 'visible',
		'backgroundColor': null,
		'wmode': 'window',
		'letterbox': 'on',
		'warnOnUnsupportedContent': true,
		'contextMenu': 'off', // Prevent two overlapping context menus. Most of the stuff in this context menu is available in the controls below the player.
		'showSwfDownload': false, // Handled by custom download button
		'upgradeToHttps': window.location.protocol === 'https:',
		'maxExecutionDuration': 15,
		'logLevel': 'error',
		'base': null,
		'menu': true,
		'salign': '',
		'forceAlign': false,
		'scale': 'showAll',
		'forceScale': false,
		'frameRate': null,
		'quality': 'high',
		'splashScreen': false,
		'preferredRenderer': null,
		'openUrlMode': 'deny',
		'allowNetworking': 'none',
		'favorFlash': false,
		'socketProxy': [],
		'fontSources': [],
		'defaultFonts': {},
		'credentialAllowList': [],
		'playerRuntime': 'flashPlayer',
		'allowFullscreen': false, // Handled by custom fullscreen button
	};
}

/**
 * @throws If `ruffle.newest()` fails (impossible)
 */
function createPlayer() {
	if (player.value !== undefined) return;
	const ruffle = (() => {
		const ruffleAPI = (window.RufflePlayer as PublicAPI).newest();
		if (ruffleAPI === null) {
			throw new Error('Ruffle API returned no compatible source.');
		}
		return ruffleAPI;
	})();
	player.value = ruffle.createPlayer();
	player.value.style.width = '100%';
	player.value.style.height = '100%';
}

/**
 * @throws If `player.value` is uninitialized.
 */
async function loadContent() {
	if (player.value === undefined) throw Error('Player is uninitialized.');
	ruffleContainer.value?.appendChild(player.value);
	loadingStatus.value = i18n.ts._flash.loadingFlashFile;
	try {
		await player.value.load(url);
		loadingStatus.value = undefined;
	} catch (error) {
		try {
			// eslint-disable-next-line no-restricted-globals
			await fetch('https://raw.esm.sh/', {
				mode: 'cors',
			});
			handleError(error); // Unexpected error
		} catch (_) {
			// Must be CSP because esm.sh should be online if `loadRuffle()` didn't fail
			console.error(error);
			loadingStatus.value = undefined;
			ruffleError.value = i18n.ts._flash.cspError;
		}
	}
}

function playPause() {
	if (playerHide.value) {
		dismissWarning();
		return;
	}
	if (player.value === undefined) return; // Not done loading or something
	if (player.value.isPlaying) {
		player.value.pause();
	} else {
		player.value.play();
	}
	playPauseButtonKey.value += 1; // HACK: Used to re-render play/pause button
}

function fullscreen() {
	if (player.value === undefined) return; // Can't fullscreen an element that doesn't exist.
	if (player.value.isFullscreen) {
		player.value.exitFullscreen();
	} else {
		player.value.enterFullscreen();
	}
}

function stop() {
	if (player.value !== undefined) {
		try {
			ruffleContainer.value?.removeChild(player.value);
		} catch {
			// The player may already be detached.
		}
	}
	loadingStatus.value = undefined;
	ruffleError.value = undefined;
	playerHide.value = true;
}

function toggleVisible() {
	hide.value = !hide.value;
	if (hide.value) {
		stop();
	} else {
		playerHide.value = true;
	}
}

onDeactivated(() => {
	stop();
});

</script>

<style lang="scss" module>
.flash_player_container {
	position: relative;
	min-height: 0;
}

.ratio {
	width: 100%;
}

.hide {
	position: absolute;
	top: 12px;
	right: 12px;
	z-index: 6;
	padding: 3px 6px;
	border: 0;
	border-radius: calc(var(--MI-radius) / 2);
	background-color: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	font-size: 12px !important;
	opacity: .7;
	cursor: pointer;
}

.flash_player_enabled {
	overflow: hidden;
	display: flex;
	flex-direction: column;
	position: absolute;
	inset: 0;

	>.alt {
		display: block;
		position: absolute;
		border-radius: calc(var(--MI-radius) / 2);
		background-color: var(--MI_THEME-panel);
		color: var(--MI_THEME-fg);
		font-size: 0.8em;
		font-weight: bold;
		opacity: .5;
		padding: 2px 5px;
		cursor: help;
		user-select: none;
		top: 12px;
		left: 12px;
		z-index: 4;
	}

	>.flash_display {
		width: 100%;
		height: 100%;
		flex-grow: 10;
		overflow-x: scroll;
		overflow-y: hidden;
		background-color: var(--MI_THEME-bg);
		text-align: center;

		scrollbar-width: none;

		&::-webkit-scrollbar {
			display: none;
		}

		.player_hide {
			display: flex;
			flex-direction: column;
			justify-content: center;
			align-items: center;
			border: 0;
			background: color(from var(--MI_THEME-bg) srgb r g b / 0.8);
			backdrop-filter: var(--MI-modalBgFilter);
			color: var(--MI_THEME-fg);
			font-size: 12px;
			border-radius: calc(var(--MI-radius) / 2);
			font-family: inherit;
			cursor: pointer;

			position: absolute;
			z-index: 4;
			width: 100%;
			height: 100%;

			>span {
				display: block;
			}
		}

		>.container {
			height: 100%;
		}
	}

	>.controls {
		display: flex;
		width: 100%;
		background-color: var(--MI_THEME-bg);
		z-index: 5;

		>* {
			padding: 4px 8px;
		}

		>button,
		a {
			border: none;
			background-color: transparent;
			color: var(--MI_THEME-accent);
			text-decoration: none;
			cursor: pointer;

			&:hover {
				background-color: var(--MI_THEME-fg);
			}

			&:disabled {
				filter: grayscale(100%);
				background-color: transparent;
				cursor: not-allowed;
			}
		}

		>.fullscreen {
			margin-left: auto;

			&:disabled {
				filter: grayscale(100%);
			}
		}

		>input[type=range] {
			height: 21px;
			-webkit-appearance: none;
			width: 90px;
			padding: 0;
			margin: 4px 8px;
			overflow-x: hidden;
			cursor: pointer;

			&:disabled {
				filter: grayscale(100%);
				cursor: not-allowed;
			}

			&:focus {
				outline: none;

				&::-webkit-slider-runnable-track {
					background: var(--MI_THEME-bg);
				}

				&::-ms-fill-lower,
				&::-ms-fill-upper {
					background: var(--MI_THEME-bg);
				}
			}

			&::-webkit-slider-runnable-track {
				width: 100%;
				height: 100%;
				border-radius: 0;
				animate: 0.2s;
				background: var(--MI_THEME-bg);
				border: 1px solid var(--MI_THEME-fg);
				overflow-x: hidden;
			}

			&::-webkit-slider-thumb {
				border: none;
				height: 100%;
				width: 14px;
				border-radius: 0;
				background: var(--MI_THEME-accent);
				-webkit-appearance: none;
				box-shadow: calc(-100vw - 14px) 0 0 100vw var(--MI_THEME-accent);
				clip-path: polygon(1px 0, 100% 0, 100% 100%, 1px 100%, 1px calc(50% + 10.5px), -100vw calc(50% + 10.5px), -100vw calc(50% - 10.5px), 0 calc(50% - 10.5px));
				z-index: 1;
			}

			&::-moz-range-track {
				width: 100%;
				height: 100%;
				border-radius: 0;
				animate: 0.2s;
				background: var(--MI_THEME-bg);
				border: 1px solid var(--MI_THEME-fg);
			}

			&::-moz-range-progress {
				height: 100%;
				background: var(--MI_THEME-accent);
			}

			&::-moz-range-thumb {
				border: none;
				height: 100%;
				border-radius: 0;
				width: 14px;
				background: var(--MI_THEME-accent);
			}

			&::-ms-track {
				width: 100%;
				height: 100%;
				border-radius: 0;
				animate: 0.2s;
				background: transparent;
				border-color: transparent;
				color: transparent;
			}

			&::-ms-fill-lower {
				background: var(--MI_THEME-accent);
				border: 1px solid var(--MI_THEME-fg);
				border-radius: 0;
			}

			&::-ms-fill-upper {
				background: var(--MI_THEME-bg);
				border: 1px solid var(--MI_THEME-fg);
				border-radius: 0;
			}

			&::-ms-thumb {
				margin-top: 1px;
				border: none;
				height: 100%;
				width: 14px;
				border-radius: 0;
				background: var(--MI_THEME-accent);
			}
		}
	}
}

.flash_player_disabled {
	width: 100%;
	border: 0;
	display: flex;
	justify-content: center;
	align-items: center;
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fg);
	position: absolute;
	inset: 0;
	font-family: inherit;
	cursor: pointer;

	>div {
		display: table-cell;
		text-align: center;
		font-size: 12px;

		>b {
			display: block;
		}
	}
}
</style>

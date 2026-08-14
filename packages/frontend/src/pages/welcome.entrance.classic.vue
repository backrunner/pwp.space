<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="meta" :class="$style.root">
	<MkFeaturedPhotos :class="$style.bg"/>
	<XTimeline :class="$style.tl"/>
	<div :class="$style.shape1"></div>
	<div :class="$style.shape2"></div>
	<div :class="$style.logoWrapper">
		<div :class="$style.poweredBy">Powered by</div>
		<img :src="misskeysvg" :class="$style.misskey"/>
	</div>
	<div :class="$style.contents">
		<MkVisitorDashboard/>
	</div>
</div>
</template>

<script lang="ts" setup>
import MkFeaturedPhotos from '@/components/MkFeaturedPhotos.vue';
import misskeysvg from '/client-assets/misskey.svg';
import MkVisitorDashboard from '@/components/MkVisitorDashboard.vue';
import { instance as meta } from '@/instance.js';
import XTimeline from './welcome.timeline.vue';
</script>

<style lang="scss" module>
.root {
	height: 100cqh;
	overflow: auto;
	overscroll-behavior: contain;
}

.bg {
	position: fixed;
	top: 0;
	right: 0;
	width: 80vw; // 100%からshapeの幅を引いている
	height: 100vh;
	// 固定レイヤがホイール操作を奪い、コンテンツ列以外の上でページをスクロールできなくなるのを防ぐ (issue #17680)
	pointer-events: none;
}

.tl {
	position: fixed;
	top: 0;
	bottom: 0;
	right: 64px;
	margin: auto;
	padding: 128px 0;
	width: 500px;
	height: calc(100% - 256px);
	overflow: hidden;
	-webkit-mask-image: linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 128px, rgba(0,0,0,1) calc(100% - 128px), rgba(0,0,0,0) 100%);
	mask-image: linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 128px, rgba(0,0,0,1) calc(100% - 128px), rgba(0,0,0,0) 100%);

	@media (max-width: 1200px) {
		display: none;
	}
}

.shape1 {
	position: fixed;
	top: 0;
	left: 0;
	width: 100vw;
	height: 100vh;
	background: var(--MI_THEME-accent);
	clip-path: polygon(0% 0%, 45% 0%, 20% 100%, 0% 100%);
	pointer-events: none; // 装飾レイヤ。ホイール操作を透過させる (→ .bg 参照)
}
.shape2 {
	position: fixed;
	top: 0;
	left: 0;
	width: 100vw;
	height: 100vh;
	background: var(--MI_THEME-accent);
	clip-path: polygon(0% 0%, 25% 0%, 35% 100%, 0% 100%);
	opacity: 0.5;
	pointer-events: none; // 装飾レイヤ。ホイール操作を透過させる (→ .bg 参照)
}

.logoWrapper {
	position: fixed;
	top: 36px;
	left: 36px;
	flex: auto;
	color: #fff;
	user-select: none;
	pointer-events: none;
}

.poweredBy {
	margin-bottom: 2px;
}

.misskey {
	width: 120px;

	@media (max-width: 450px) {
		width: 100px;
	}
}

.contents {
	position: relative;
	width: min(430px, calc(100% - 32px));
	margin-left: 128px;
	padding: 100px 0 100px 0;

	@media (max-width: 1200px) {
		margin: auto;
	}
}

</style>

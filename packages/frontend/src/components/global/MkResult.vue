<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Transition :name="prefer.s.animation ? '_transition_zoom' : ''" appear>
	<div :class="$style.root" class="_gaps">
		<img v-if="imageUrl && !imageFailed" :key="imageUrl" :src="imageUrl" alt="" draggable="false" :class="$style.img" @error="imageFailed = true"/>
		<MkSystemIcon v-else :type="iconType" :class="$style.icon"/>

		<div style="opacity: 0.7;">{{ props.text ?? (type === 'empty' ? i18n.ts.nothing : type === 'notFound' ? i18n.ts.notFound : type === 'error' ? i18n.ts.somethingHappened : null) }}</div>
		<slot></slot>
	</div>
</Transition>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	type: 'empty' | 'notFound' | 'error';
	text?: string;
}>();

const imageUrl = computed(() => props.type === 'empty' ? instance.infoImageUrl : props.type === 'notFound' ? instance.notFoundImageUrl : instance.serverErrorImageUrl);
const iconType = computed(() => props.type === 'empty' ? 'info' : props.type === 'notFound' ? 'question' : 'error');
const imageFailed = ref(false);

watch([() => props.type, imageUrl], () => {
	imageFailed.value = false;
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	text-align: center;
	padding: 32px;
}

.img {
	vertical-align: bottom;
	height: 128px;
	margin: auto auto 16px;
	border-radius: 16px;
}

.icon {
	width: 65px;
	height: 65px;
	margin: 0 auto;
}
</style>

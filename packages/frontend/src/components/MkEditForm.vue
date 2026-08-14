<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	:class="[$style.root, { [$style.modal]: modal, _popup: modal }]"
	@dragover.stop="onDragover"
	@dragenter="onDragenter"
	@dragleave="onDragleave"
	@drop.stop="onDrop"
>
	<header :class="$style.header">
		<div :class="$style.headerLeft">
			<button v-if="!fixed" :class="$style.cancel" class="_button" :aria-label="i18n.ts.close" @click="cancel"><i class="ti ti-x"></i></button>
			<button v-if="$i.policies.noteDraftLimit > 0" v-tooltip="i18n.ts.draft" class="_button" :class="$style.draftButton" :aria-label="i18n.ts.draft" @click="showDraftMenu"><i class="ti ti-pencil-minus"></i></button>
		</div>
		<div :class="$style.headerRight">
			<button ref="otherSettingsButton" v-tooltip="i18n.ts.other" class="_button" :class="$style.headerRightItem" :aria-label="i18n.ts.other" @click="showOtherSettings"><i class="ti ti-dots"></i></button>
			<button v-click-anime class="_button" :class="$style.submit" :disabled="!canPost" data-cy-open-post-form-submit @click="post">
				<div :class="$style.submitInner">
					<template v-if="posted"></template>
					<template v-else-if="posting">
						<MkEllipsis/>
					</template>
					<template v-else>{{ submitText }}</template>
					<i style="margin-left: 6px;" :class="posted ? 'ti ti-check' : reply ? 'ti ti-arrow-back-up' : renote ? 'ti ti-quote' : 'ti ti-send'"></i>
				</div>
			</button>
		</div>
	</header>
	<MkNoteSimple v-if="reply" :class="$style.targetNote" :note="reply"/>
	<MkNoteSimple v-if="renote" :class="$style.targetNote" :note="renote"/>
	<div v-if="quoteId" :class="$style.withQuote"><i class="ti ti-quote"></i>{{ i18n.ts.quoteAttached }}</div>
	<input v-show="useCw" ref="cwInputEl" v-model="cw" :class="$style.cw" :placeholder="i18n.ts.annotation" :aria-label="i18n.ts.annotation" @keydown="onKeydown" @keyup="onKeyup" @compositionend="onCompositionEnd">
	<div :class="[$style.textOuter, { [$style.withCw]: useCw }]">
		<div v-if="channel" :class="$style.colorBar" :style="{ background: channel.color }"></div>
		<textarea ref="textareaEl" v-model="text" :class="[$style.text]" :disabled="posting || posted" :readonly="textAreaReadOnly" :placeholder="placeholder" :aria-label="placeholder" data-cy-post-form-text @keydown="onKeydown" @keyup="onKeyup" @paste="onPaste" @compositionupdate="onCompositionUpdate" @compositionend="onCompositionEnd"></textarea>
		<div v-if="maxTextLength - textLength < 100" :class="['_acrylic', $style.textCount, { [$style.textOver]: textLength > maxTextLength }]">{{ maxTextLength - textLength }}</div>
	</div>
	<input v-show="withHashtags" ref="hashtagsInputEl" v-model="hashtags" :class="$style.hashtags" :placeholder="i18n.ts.hashtags" :aria-label="i18n.ts.hashtags" list="hashtags">
	<XPostFormAttaches v-model="files" @detach="detachFile" @changeSensitive="updateFileSensitive" @changeName="updateFileName"/>
	<div v-if="uploader.items.value.length > 0" style="padding: 12px;">
		<MkTip k="postFormUploader">
			{{ i18n.ts._postForm.uploaderTip }}
		</MkTip>
		<MkUploaderItems :items="uploader.items.value" @showMenu="(item, ev) => showPerUploadItemMenu(item, ev)" @showMenuViaContextmenu="(item, ev) => showPerUploadItemMenuViaContextmenu(item, ev)"/>
	</div>
	<MkNotePreview v-if="showPreview" :class="$style.preview" :text="text" :files="files" :useCw="useCw" :cw="cw" :user="target.user"/>
	<div v-if="showingOptions" style="padding: 8px 16px;">
	</div>
	<footer :class="$style.footer">
		<div :class="$style.footerLeft">
			<button v-tooltip="i18n.ts.attachFile + ' (' + i18n.ts.upload + ')'" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.attachFile + ' (' + i18n.ts.upload + ')'" @click="chooseFileFromPc"><i class="ti ti-photo-plus"></i></button>
			<button v-tooltip="i18n.ts.attachFile + ' (' + i18n.ts.fromDrive + ')'" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.attachFile + ' (' + i18n.ts.fromDrive + ')'" @click="chooseFileFromDrive"><i class="ti ti-cloud-download"></i></button>
			<button v-tooltip="i18n.ts.useCw" class="_button" :class="[$style.footerButton, { [$style.footerButtonActive]: useCw }]" :aria-label="i18n.ts.useCw" :aria-pressed="useCw" @click="useCw = !useCw"><i class="ti ti-eye-off"></i></button>
			<button v-tooltip="i18n.ts.hashtags" class="_button" :class="[$style.footerButton, { [$style.footerButtonActive]: withHashtags }]" :aria-label="i18n.ts.hashtags" :aria-pressed="withHashtags" @click="withHashtags = !withHashtags"><i class="ti ti-hash"></i></button>
			<button v-tooltip="i18n.ts.mention" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.mention" @click="insertMention"><i class="ti ti-at"></i></button>
			<button v-if="showAddMfmFunction" v-tooltip="i18n.ts.addMfmFunction" :class="['_button', $style.footerButton]" :aria-label="i18n.ts.addMfmFunction" @click="insertMfmFunction"><i class="ti ti-palette"></i></button>
			<button v-if="postFormActions.length > 0" v-tooltip="i18n.ts.plugins" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.plugins" @click="showActions"><i class="ti ti-plug"></i></button>
		</div>
		<div :class="$style.footerRight">
			<button v-tooltip="i18n.ts.emoji" :class="['_button', $style.footerButton]" :aria-label="i18n.ts.emoji" @click="insertEmoji"><i class="ti ti-mood-happy"></i></button>
		</div>
	</footer>
	<datalist id="hashtags">
		<option v-for="hashtag in recentHashtags" :key="hashtag" :value="hashtag"></option>
	</datalist>
</div>
</template>

<script lang="ts" setup>
import { inject, watch, nextTick, onMounted, onBeforeUnmount, onUnmounted, provide, ref, computed, useTemplateRef, defineAsyncComponent } from 'vue';
import * as mfm from 'mfm-js';
import * as Misskey from 'misskey-js';
import autosize from 'autosize';
import insertTextAtCursor from 'insert-text-at-cursor';
import { toASCII } from 'punycode.js';
import { host } from '@@/js/config.js';
import MkUploaderItems from './MkUploaderItems.vue';
import type { UploaderItem } from '@/composables/use-uploader.js';
import type { PostFormProps } from '@/types/post-form.js';
import type { MenuItem } from '@/types/menu.js';
import MkNoteSimple from '@/components/MkNoteSimple.vue';
import MkNotePreview from '@/components/MkNotePreview.vue';
import XPostFormAttaches from '@/components/MkPostFormAttaches.vue';
import { unique } from '@/utility/array.js';
import { extractMentions } from '@/utility/extract-mentions.js';
import { formatTimeString } from '@/utility/format-time-string.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { chooseDriveFile } from '@/utility/drive.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { ensureSignin } from '@/i.js';

import { deepClone } from '@/utility/clone.js';
import MkRippleEffect from '@/components/MkRippleEffect.vue';
import { miLocalStorage } from '@/local-storage.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { mfmFunctionPicker } from '@/utility/mfm-function-picker.js';
import { prefer } from '@/preferences.js';
import { getPluginHandlers } from '@/plugin.js';
import { DI } from '@/di.js';
import { checkDragDataType, getDragData } from '@/drag-and-drop.js';
import { globalEvents } from '@/events.js';
import { useUploader } from '@/composables/use-uploader.js';

const $i = ensureSignin();

const modal = inject(DI.inModal, true);

const props = withDefaults(defineProps<PostFormProps & {
	target: Misskey.entities.Note;
	fixed?: boolean;
	autofocus?: boolean;
	freezeAfterPosted?: boolean;
	mock?: boolean;
}>(), {
	initialVisibleUsers: () => [],
	autofocus: true,
	mock: false,
	initialLocalOnly: undefined,
	fixed: false,
});

// eslint-disable-next-line vue/no-setup-props-reactivity-loss
provide(DI.mock, props.mock);

const emit = defineEmits<{
	(ev: 'posted'): void;
	(ev: 'cancel'): void;
	(ev: 'esc'): void;

	// Mock用
	(ev: 'fileChangeSensitive', fileId: string, to: boolean): void;
}>();

const textareaEl = useTemplateRef('textareaEl');
const cwInputEl = useTemplateRef('cwInputEl');
const hashtagsInputEl = useTemplateRef('hashtagsInputEl');
const otherSettingsButton = useTemplateRef('otherSettingsButton');

const posting = ref(false);
const posted = ref(false);
const text = ref(props.initialText ?? '');
const files = ref(props.initialFiles ?? []);
const useCw = ref<boolean>(!!props.initialCw);
const showPreview = ref(store.s.showPreview);
watch(showPreview, () => store.set('showPreview', showPreview.value));
const showAddMfmFunction = ref(prefer.s.enableQuickAddMfmFunction);
watch(showAddMfmFunction, () => prefer.commit('enableQuickAddMfmFunction', showAddMfmFunction.value));

const reply = computed(() => props.reply);
const renote = computed(() => props.renote);
const channel = computed(() => props.channel);
const cw = ref<string | null>(props.initialCw ?? null);
const draghover = ref(false);
const quoteId = ref<string | null>(null);
const recentHashtags = ref(JSON.parse(miLocalStorage.getItem('hashtags') ?? '[]'));
const imeText = ref('');
const justEndedComposition = ref(false);
const showingOptions = ref(false);
const textAreaReadOnly = ref(false);
const postFormActions = getPluginHandlers('post_form_action');

const serverDraftId = ref<string | null>(null);

let textAutocomplete: Autocomplete | null = null;
let cwAutocomplete: Autocomplete | null = null;
let hashtagAutocomplete: Autocomplete | null = null;

const uploader = useUploader({
	multiple: true,
});

uploader.events.on('itemUploaded', ctx => {
	files.value.push(ctx.item.uploaded!);
	uploader.removeItem(ctx.item);
});

const draftKey = computed((): string => {
	let key = props.channel ? `channel:${props.channel.id}` : '';

	if (props.renote) {
		key += `renote:${props.renote.id}`;
	} else if (props.reply) {
		key += `reply:${props.reply.id}`;
	} else {
		key += `note:${props.target.id}`;
	}
	key += ':edit';
	return key;
});

const placeholder = computed((): string => {
	if (props.renote) {
		return i18n.ts._postForm.quotePlaceholder;
	} else if (props.reply) {
		return i18n.ts._postForm.replyPlaceholder;
	} else if (props.channel) {
		return i18n.ts._postForm.channelPlaceholder;
	} else {
		const xs = [
			i18n.ts._postForm._placeholders.a,
			i18n.ts._postForm._placeholders.b,
			i18n.ts._postForm._placeholders.c,
			i18n.ts._postForm._placeholders.d,
			i18n.ts._postForm._placeholders.e,
			i18n.ts._postForm._placeholders.f,
		];
		return xs[Math.floor(Math.random() * xs.length)];
	}
});

const submitText = computed((): string => {
	return props.renote
		? i18n.ts.quote
		: props.reply
			? i18n.ts.reply
			: i18n.ts.note;
});

const textLength = computed((): number => {
	return (text.value + imeText.value).trim().length;
});

const maxTextLength = computed((): number => {
	return instance ? instance.maxNoteTextLength : 1000;
});

const cwTextLength = computed((): number => {
	return cw.value?.length ?? 0;
});

const maxCwTextLength = 100;

const canPost = computed((): boolean => {
	return !props.mock && !posting.value && !posted.value && !uploader.uploading.value && (uploader.items.value.length === 0 || uploader.readyForUpload.value) &&
		(
			1 <= textLength.value ||
			1 <= files.value.length ||
			1 <= uploader.items.value.length ||
			props.target.poll != null ||
			renote.value != null ||
			(reply.value != null && quoteId.value != null)
		) &&
		(textLength.value <= maxTextLength.value) &&
		(
			useCw.value ?
				(
					cw.value != null && cw.value.trim() !== '' &&
					cwTextLength.value <= maxCwTextLength
				) : true
		) &&
		(files.value.length <= 16);
});

// cannot save pure renote as draft
const canSaveAsServerDraft = computed((): boolean => {
	return canPost.value && (textLength.value > 0 || files.value.length > 0);
});

const withHashtags = store.model('postFormWithHashtags');
const hashtags = store.model('postFormHashtags');

if (props.mention) {
	text.value = props.mention.host ? `@${props.mention.username}@${toASCII(props.mention.host)}` : `@${props.mention.username}`;
	text.value += ' ';
}

if (props.reply && (props.reply.user.username !== $i.username || (props.reply.user.host != null && props.reply.user.host !== host))) {
	text.value = `@${props.reply.user.username}${props.reply.user.host != null ? '@' + toASCII(props.reply.user.host) : ''} `;
}

if (props.reply && props.reply.text != null) {
	const ast = mfm.parse(props.reply.text);
	const otherHost = props.reply.user.host;

	for (const x of extractMentions(ast)) {
		const mention = x.host ?
			`@${x.username}@${toASCII(x.host)}` :
			(otherHost == null || otherHost === host) ?
				`@${x.username}` :
				`@${x.username}@${toASCII(otherHost)}`;

		// 自分は除外
		if ($i.username === x.username && (x.host == null || x.host === host)) continue;

		// 重複は除外
		if (text.value.includes(`${mention} `)) continue;

		text.value += `${mention} `;
	}
}

// keep cw when reply
if (prefer.s.keepCw && props.reply && props.reply.cw) {
	useCw.value = true;
	cw.value = props.reply.cw;
}

function watchForDraft() {
	watch(text, () => saveDraft());
	watch(useCw, () => saveDraft());
	watch(cw, () => saveDraft());
	watch(files, () => saveDraft(), { deep: true });
}

function focus() {
	if (textareaEl.value) {
		textareaEl.value.focus();
		textareaEl.value.setSelectionRange(textareaEl.value.value.length, textareaEl.value.value.length);
	}
}

function chooseFileFromPc(ev: PointerEvent) {
	if (props.mock) return;

	os.chooseFileFromPc({ multiple: true }).then(files => {
		if (files.length === 0) return;
		uploader.addFiles(files);
	});
}

function chooseFileFromDrive(ev: PointerEvent) {
	if (props.mock) return;

	chooseDriveFile({ multiple: true }).then(driveFiles => {
		files.value.push(...driveFiles);
	});
}

function detachFile(id: Misskey.entities.DriveFile['id']) {
	files.value = files.value.filter(x => x.id !== id);
}

function updateFileSensitive(file: Misskey.entities.DriveFile, isSensitive: boolean) {
	if (props.mock) {
		emit('fileChangeSensitive', file.id, isSensitive);
	}
	files.value[files.value.findIndex(x => x.id === file.id)].isSensitive = isSensitive;
}

function updateFileName(file: Misskey.entities.DriveFile, name: Misskey.entities.DriveFile['name']) {
	files.value[files.value.findIndex(x => x.id === file.id)].name = name;
}

function clear() {
	text.value = '';
	files.value = [];
	quoteId.value = null;
}

const isResizing = ref(false);

function autoResizeTextarea() {
	if (isResizing.value) return;

	isResizing.value = true;
	nextTick(() => {
		if (textareaEl.value) {
			autosize.update(textareaEl.value);
		}
		isResizing.value = false;
	});
}

function onKeydown(ev: KeyboardEvent) {
	if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && canPost.value) post();

	// justEndedComposition is for Safari, where keydown can fire after compositionend.
	if (ev.key === 'Escape' && !justEndedComposition.value && !ev.isComposing) emit('esc');

	autoResizeTextarea();
}

function onKeyup() {
	justEndedComposition.value = false;
}

function onCompositionUpdate(ev: CompositionEvent) {
	imeText.value = ev.data;
	autoResizeTextarea();
}

function onCompositionEnd(ev: CompositionEvent) {
	imeText.value = '';
	justEndedComposition.value = true;
	autoResizeTextarea();
}

const pastedFileName = 'yyyy-MM-dd HH-mm-ss [{{number}}]';

async function onPaste(ev: ClipboardEvent) {
	if (props.mock) return;
	if (ev.clipboardData == null) return;
	if (textareaEl.value == null) return;

	let pastedFiles: File[] = [];
	for (const { item, i } of Array.from(ev.clipboardData.items, (data, x) => ({ item: data, i: x }))) {
		if (item.kind === 'file') {
			const file = item.getAsFile();
			if (!file) continue;
			const lio = file.name.lastIndexOf('.');
			const ext = lio >= 0 ? file.name.slice(lio) : '';
			const formattedName = `${formatTimeString(new Date(file.lastModified), pastedFileName).replace(/{{number}}/g, `${i + 1}`)}${ext}`;
			const renamedFile = new File([file], formattedName, { type: file.type });
			pastedFiles.push(renamedFile);
		}
	}
	if (pastedFiles.length > 0) {
		ev.preventDefault();
		uploader.addFiles(pastedFiles);
		return;
	}

	const paste = ev.clipboardData.getData('text');

	if (paste.length > 1000) {
		ev.preventDefault();
		const { canceled } = await os.confirm({
			type: 'info',
			text: i18n.ts.attachAsFileQuestion,
		});

		if (canceled) {
			insertTextAtCursor(textareaEl.value, paste);
			return;
		}

		const fileName = formatTimeString(new Date(), pastedFileName).replace(/{{number}}/g, '0');
		const file = new File([paste], `${fileName}.txt`, { type: 'text/plain' });
		uploader.addFiles([file]);
	}

	autoResizeTextarea();
}

function onDragover(ev: DragEvent) {
	if (ev.dataTransfer == null) return;
	if (ev.dataTransfer.items[0] == null) return;

	const isFile = ev.dataTransfer.items[0].kind === 'file';
	if (isFile || checkDragDataType(ev, ['driveFiles'])) {
		ev.preventDefault();
		draghover.value = true;
		switch (ev.dataTransfer.effectAllowed) {
			case 'all':
			case 'uninitialized':
			case 'copy':
			case 'copyLink':
			case 'copyMove':
				ev.dataTransfer.dropEffect = 'copy';
				break;
			case 'linkMove':
			case 'move':
				ev.dataTransfer.dropEffect = 'move';
				break;
			default:
				ev.dataTransfer.dropEffect = 'none';
				break;
		}
	}
}

function onDragenter() {
	draghover.value = true;
}

function onDragleave() {
	draghover.value = false;
}

function onDrop(ev: DragEvent): void {
	draghover.value = false;

	// ファイルだったら
	if (ev.dataTransfer && ev.dataTransfer.files.length > 0) {
		ev.preventDefault();
		uploader.addFiles(Array.from(ev.dataTransfer.files));
		return;
	}

	//#region ドライブのファイル
	{
		const droppedData = getDragData(ev, 'driveFiles');
		if (droppedData != null) {
			files.value.push(...droppedData);
			ev.preventDefault();
		}
	}
	//#endregion
}

type StoredDrafts = {
	[key: string]: {
		updatedAt: string;
		data: {
			text: string;
			useCw: boolean;
			cw: string | null;
			files: Misskey.entities.DriveFile[];
		};
	};
};

function saveDraft() {
	if (props.instant || props.mock) return;

	const draftsData = JSON.parse(miLocalStorage.getItem('drafts') ?? '{}') as StoredDrafts;

	draftsData[draftKey.value] = {
		updatedAt: new Date().toISOString(),
		data: {
			text: text.value,
			useCw: useCw.value,
			cw: cw.value,
			files: files.value,
		},
	};

	miLocalStorage.setItem('drafts', JSON.stringify(draftsData));
}

function deleteDraft() {
	const draftsData = JSON.parse(miLocalStorage.getItem('drafts') ?? '{}') as StoredDrafts;

	delete draftsData[draftKey.value];

	miLocalStorage.setItem('drafts', JSON.stringify(draftsData));
}

async function saveServerDraft(clearLocal = false) {
	return await os.apiWithDialog(serverDraftId.value == null ? 'notes/drafts/create' : 'notes/drafts/update', {
		...(serverDraftId.value == null ? {} : { draftId: serverDraftId.value }),
		text: text.value,
		cw: cw.value,
		hashtag: hashtags.value,
		fileIds: files.value.map(f => f.id),
		replyId: props.target.replyId ?? undefined,
		renoteId: props.target.renoteId ?? undefined,
		channelId: props.target.channelId ?? undefined,
	}).then(() => {
		if (clearLocal) {
			clear();
			deleteDraft();
		}
	}).catch((err) => {
	});
}

async function uploadFiles() {
	await uploader.upload();

	for (const uploadedItem of uploader.items.value.filter(x => x.uploaded != null)) {
		files.value.push(uploadedItem.uploaded!);
		uploader.removeItem(uploadedItem);
	}
}

async function post(ev?: PointerEvent) {
	if (useCw.value && (cw.value == null || cw.value.trim() === '')) {
		os.alert({
			type: 'error',
			text: i18n.ts.cwNotationRequired,
		});
		return;
	}

	if (ev != null) {
		const el = (ev.currentTarget ?? ev.target) as HTMLElement | null;

		if (el && prefer.s.animation) {
			const rect = el.getBoundingClientRect();
			const x = rect.left + (el.offsetWidth / 2);
			const y = rect.top + (el.offsetHeight / 2);
			const { dispose } = os.popup(MkRippleEffect, { x, y }, {
				end: () => dispose(),
			});
		}
	}

	if (props.mock) return;

	if (uploader.items.value.some(x => x.uploaded == null)) {
		await uploadFiles();
	}

	let postData = {
		noteId: props.target.id,
		text: text.value.trim() === '' ? null : text.value,
		fileIds: files.value.map(f => f.id),
		cw: useCw.value ? cw.value ?? '' : null,
	};

	if (withHashtags.value && hashtags.value && hashtags.value.trim() !== '') {
		const hashtags_ = hashtags.value.trim().split(' ').map(x => x.startsWith('#') ? x : '#' + x).join(' ');
		if (!postData.text) {
			postData.text = hashtags_;
		} else {
			const postTextLines = postData.text.split('\n');
			if (postTextLines[postTextLines.length - 1].trim() === '') {
				postTextLines[postTextLines.length - 1] += hashtags_;
			} else {
				postTextLines[postTextLines.length - 1] += ' ' + hashtags_;
			}
			postData.text = postTextLines.join('\n');
		}
	}

	// plugin
	const notePostInterruptors = getPluginHandlers('note_post_interruptor');
	if (notePostInterruptors.length > 0) {
		for (const interruptor of notePostInterruptors) {
			try {
				postData = await interruptor.handler(deepClone(postData)) as typeof postData;
			} catch (err) {
				console.error(err);
			}
		}
	}

	posting.value = true;
	misskeyApi('notes/update', postData).then(() => {
		if (props.freezeAfterPosted) {
			posted.value = true;
		} else {
			clear();
		}

		globalEvents.emit('noteUpdated', props.target.id);

		nextTick(() => {
			deleteDraft();
			emit('posted');
			if (postData.text && postData.text !== '') {
				const hashtags_ = mfm.parse(postData.text).map(x => x.type === 'hashtag' && x.props.hashtag).filter(x => x) as string[];
				const history = JSON.parse(miLocalStorage.getItem('hashtags') ?? '[]') as string[];
				miLocalStorage.setItem('hashtags', JSON.stringify(unique(hashtags_.concat(history))));
			}
			posting.value = false;

			if (serverDraftId.value != null) {
				misskeyApi('notes/drafts/delete', { draftId: serverDraftId.value });
			}
		});
	}).catch(err => {
		posting.value = false;
		os.alert({
			type: 'error',
			text: err.message + '\n' + (err as any).id,
		});
	});
}

function cancel() {
	emit('cancel');
}

function insertMention() {
	os.selectUser({ localOnly: props.initialLocalOnly ?? false, includeSelf: true }).then(user => {
		if (textareaEl.value == null) return;
		insertTextAtCursor(textareaEl.value, '@' + Misskey.acct.toString(user) + ' ');
	});
}

async function insertEmoji(ev: PointerEvent) {
	textAreaReadOnly.value = true;
	const target = ev.currentTarget ?? ev.target;
	if (target == null) return;

	// emojiPickerはダイアログが閉じずにtextareaとやりとりするので、
	// focustrapをかけているとinsertTextAtCursorが効かない
	// そのため、投稿フォームのテキストに直接注入する
	// See: https://github.com/misskey-dev/misskey/pull/14282
	//      https://github.com/misskey-dev/misskey/issues/14274

	let pos = textareaEl.value?.selectionStart ?? 0;
	let posEnd = textareaEl.value?.selectionEnd ?? text.value.length;
	emojiPicker.show(
		target as HTMLElement,
		emoji => {
			const textBefore = text.value.substring(0, pos);
			const textAfter = text.value.substring(posEnd);
			text.value = textBefore + emoji + textAfter;
			pos += emoji.length;
			posEnd += emoji.length;
		},
		() => {
			textAreaReadOnly.value = false;
			nextTick(() => {
				if (textareaEl.value) {
					textareaEl.value.focus();
					textareaEl.value.setSelectionRange(pos, posEnd);
				}
			});
		},
	);
}

async function insertMfmFunction(ev: PointerEvent) {
	if (textareaEl.value == null) return;
	let pos = textareaEl.value.selectionStart ?? 0;
	let posEnd = textareaEl.value.selectionEnd ?? text.value.length;
	mfmFunctionPicker(
		ev.currentTarget ?? ev.target,
		(tag) => {
			if (pos === posEnd) {
				text.value = `${text.value.substring(0, pos)}$[${tag} ]${text.value.substring(pos)}`;
				pos += tag.length + 3;
				posEnd = pos;
			} else {
				text.value = `${text.value.substring(0, pos)}$[${tag} ${text.value.substring(pos, posEnd)}]${text.value.substring(posEnd)}`;
				pos += tag.length + 3;
				posEnd = pos;
			}
		},
		() => {
			nextTick(() => {
				if (textareaEl.value) {
					textareaEl.value.focus();
					textareaEl.value.setSelectionRange(pos, posEnd);
				}
			});
		},
	);
}

function showActions(ev: PointerEvent) {
	os.popupMenu(postFormActions.map(action => ({
		text: action.title,
		action: () => {
			action.handler({
				text: text.value,
				cw: cw.value,
			}, (key, value) => {
				if (typeof key !== 'string' || typeof value !== 'string') return;
				if (key === 'text') { text.value = value; }
				if (key === 'cw') { useCw.value = value !== null; cw.value = value; }
			});
		},
	})), ev.currentTarget ?? ev.target);
}

function showOtherSettings() {
	const menuItems = [{
		type: 'switch' as const,
		icon: 'ti ti-eye',
		text: i18n.ts.preview,
		ref: showPreview,
	}, {
		type: 'button' as const,
		icon: 'ti ti-trash',
		text: i18n.ts.reset,
		danger: true,
		action: async () => {
			if (props.mock) return;
			const { canceled } = await os.confirm({
				type: 'question',
				text: i18n.ts.resetAreYouSure,
			});
			if (canceled) return;
			clear();
		},
	}] satisfies MenuItem[];

	os.popupMenu(menuItems, otherSettingsButton.value);
}

function showPerUploadItemMenu(item: UploaderItem, ev: PointerEvent) {
	const menu = uploader.getMenu(item);
	os.popupMenu(menu, ev.currentTarget ?? ev.target);
}

function showPerUploadItemMenuViaContextmenu(item: UploaderItem, ev: PointerEvent) {
	const menu = uploader.getMenu(item);
	os.contextMenu(menu, ev);
}

function showDraftMenu(ev: PointerEvent) {
	function showDraftsDialog() {
		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkNoteDraftsDialog.vue')), {}, {
			restore: async (draft: Misskey.entities.NoteDraft) => {
				text.value = draft.text ?? '';
				useCw.value = draft.cw != null;
				cw.value = draft.cw ?? null;
				files.value = draft.files ?? [];
				quoteId.value = draft.renoteId ?? null;

				serverDraftId.value = draft.id;
			},
			cancel: () => {},
			closed: () => {
				dispose();
			},
		});
	}

	os.popupMenu([{
		type: 'button' as const,
		text: i18n.ts._drafts.saveToDraft,
		icon: 'ti ti-cloud-upload',
		action: async () => {
			if (!canSaveAsServerDraft.value) {
				return os.alert({
					type: 'error',
					text: i18n.ts._drafts.cannotCreateDraft,
				});
			}
			saveServerDraft();
		},
	}, {
		type: 'button' as const,
		text: i18n.ts._drafts.listDrafts,
		icon: 'ti ti-cloud-download',
		action: () => {
			showDraftsDialog();
		},
	}], (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

onMounted(() => {
	if (props.autofocus) {
		focus();

		nextTick(() => {
			focus();
		});
	}

	if (textareaEl.value) {
		textAutocomplete = new Autocomplete(textareaEl.value, text);
		autosize(textareaEl.value);
	}
	if (cwInputEl.value) cwAutocomplete = new Autocomplete(cwInputEl.value, cw);
	if (hashtagsInputEl.value) hashtagAutocomplete = new Autocomplete(hashtagsInputEl.value, hashtags);

	nextTick(() => {
		const init = props.target;
		text.value = init.text ? init.text : '';
		files.value = init.files ?? [];
		cw.value = init.cw ?? null;
		useCw.value = init.cw != null;
		quoteId.value = init.renote ? init.renote.id : null;

		// 書きかけの投稿を復元
		if (!props.instant && !props.mention && !props.specified && !props.mock) {
			const draft = JSON.parse(miLocalStorage.getItem('drafts') ?? '{}')[draftKey.value] as StoredDrafts[string] | undefined;
			if (draft != null) {
				text.value = draft.data.text;
				useCw.value = draft.data.useCw;
				cw.value = draft.data.cw;
				files.value = (draft.data.files || []).filter(draftFile => draftFile);
			}
		}

		autoResizeTextarea();

		nextTick(() => watchForDraft());
	});
});

onBeforeUnmount(() => {
	uploader.abortAll();
	if (textareaEl.value) autosize.destroy(textareaEl.value);
	textAutocomplete?.detach();
	cwAutocomplete?.detach();
	hashtagAutocomplete?.detach();
});

onUnmounted(() => {
	uploader.dispose();
});

async function canClose() {
	if (!uploader.allItemsUploaded.value) {
		const { canceled } = await os.confirm({
			type: 'question',
			text: i18n.ts._postForm.quitInspiteOfThereAreUnuploadedFilesConfirm,
			okText: i18n.ts.yes,
			cancelText: i18n.ts.no,
		});
		if (canceled) return false;
	}
	return true;
}

defineExpose({
	clear,
	canClose,
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	container-type: inline-size;

	&.modal {
		width: 100%;
		max-width: 520px;
		overflow-x: clip;
		overflow-y: auto;
	}
}

//#region header
.header {
	z-index: 1000;
	min-height: 50px;
	display: flex;
	flex-wrap: nowrap;
	gap: 4px;
}

.headerLeft {
	display: flex;
	flex: 1;
	flex-wrap: nowrap;
	align-items: center;
	gap: 6px;
	padding-left: 12px;
}

.cancel {
	padding: 8px;
}

.draftButton {
	padding: 8px;
	font-size: 90%;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:disabled {
		background: none;
	}
}

.headerRight {
	display: flex;
	min-height: 48px;
	font-size: 0.9em;
	flex-wrap: nowrap;
	align-items: center;
	margin-left: auto;
	gap: 4px;
	overflow: clip;
	padding-left: 4px;
}

.submit {
	margin: 12px 12px 12px 6px;
	vertical-align: bottom;

	&:focus-visible {
		outline: none;

		> .submitInner {
			outline: 2px solid var(--MI_THEME-fgOnAccent);
			outline-offset: -4px;
		}
	}

	&:disabled {
		opacity: 0.7;
	}

	&.posting {
		cursor: wait;
	}

	&:not(:disabled):hover {
		> .submitInner {
			background: linear-gradient(90deg, hsl(from var(--MI_THEME-accent) h s calc(l + 5)), hsl(from var(--MI_THEME-accent) h s calc(l + 5)));
		}
	}

	&:not(:disabled):active {
		> .submitInner {
			background: linear-gradient(90deg, hsl(from var(--MI_THEME-accent) h s calc(l + 5)), hsl(from var(--MI_THEME-accent) h s calc(l + 5)));
		}
	}
}

.colorBar {
	position: absolute;
	top: 0px;
	left: 12px;
	width: 5px;
	height: 100%;
	border-radius: 999px;
	pointer-events: none;
}

.submitInner {
	padding: 0 12px;
	line-height: 34px;
	font-weight: bold;
	border-radius: 6px;
	min-width: 90px;
	box-sizing: border-box;
	color: var(--MI_THEME-fgOnAccent);
	background: linear-gradient(90deg, var(--MI_THEME-buttonGradateA), var(--MI_THEME-buttonGradateB));
}

.headerRightItem {
	margin: 0;
	padding: 8px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:disabled {
		background: none;
	}

	&.danger {
		color: var(--MI_THEME-error);
	}
}

.headerRightButtonText {
	padding-left: 6px;
}

.visibility {
	overflow: clip;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 210px;

	&:enabled {
		> .headerRightButtonText {
			opacity: 0.8;
		}
	}
}

//#endregion

.preview {
	padding: 16px 20px 0 20px;
	min-height: 75px;
	max-height: 150px;
	overflow: auto;
	background-size: auto auto;
}

html[data-color-scheme=dark] .preview {
	background-image: repeating-linear-gradient(135deg, transparent, transparent 5px, color(from var(--MI_THEME-fg) srgb r g b / 0.12) 5px, color(from var(--MI_THEME-fg) srgb r g b / 0.12) 10px);
}

html[data-color-scheme=light] .preview {
	background-image: repeating-linear-gradient(135deg, transparent, transparent 5px, color(from var(--MI_THEME-fg) srgb r g b / 0.03) 5px, color(from var(--MI_THEME-fg) srgb r g b / 0.03) 10px);
}

.targetNote {
	padding: 0 20px 16px 20px;
}

.withQuote {
	margin: 0 0 8px 0;
	color: var(--MI_THEME-accent);
}

.toSpecified {
	padding: 6px 24px;
	margin-bottom: 8px;
	overflow: auto;
	white-space: nowrap;
}

.visibleUsers {
	display: inline;
	top: -1px;
	font-size: 14px;
}

.visibleUser {
	margin-right: 14px;
	padding: 8px 0 8px 8px;
	border-radius: 8px;
	background: color(from var(--MI_THEME-fg) srgb r g b / 0.1);
}

.hasNotSpecifiedMentions {
	margin: 0 20px 16px 20px;
}

.cw,
.hashtags,
.text {
	display: block;
	box-sizing: border-box;
	padding: 0 24px;
	margin: 0;
	width: 100%;
	font-size: 110%;
	border: none;
	border-radius: 0;
	background: transparent;
	color: var(--MI_THEME-fg);
	font-family: inherit;

	&:focus {
		outline: none;
	}

	&:disabled {
		opacity: 0.5;
	}
}

.cwOuter {
	width: 100%;
	position: relative;
}

.cw {
	z-index: 1;
	padding-bottom: 8px;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.cwTextCount {
	position: absolute;
	top: 0;
	right: 2px;
	padding: 2px 6px;
	font-size: .9em;
	color: var(--MI_THEME-warn);
	border-radius: 6px;
	max-width: 100%;
	min-width: 1.6em;
	text-align: center;

	&.cwTextOver {
		color: var(--MI_THEME-error);
	}
}

.hashtags {
	z-index: 1;
	padding-top: 8px;
	padding-bottom: 8px;
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.textOuter {
	width: 100%;
	position: relative;

	&.withCw {
		padding-top: 8px;
	}
}

.text {
	max-width: 100%;
	min-width: 100%;
	width: 100%;
	min-height: 90px;
	height: 100%;
	max-height: 75vh;
	overflow-x: hidden !important;
	resize: none;
}

.textCount {
	position: absolute;
	top: 0;
	right: 2px;
	padding: 4px 6px;
	font-size: .9em;
	color: var(--MI_THEME-warn);
	border-radius: 6px;
	min-width: 1.6em;
	text-align: center;

	&.textOver {
		color: var(--MI_THEME-error);
	}
}

.footer {
	display: flex;
	padding: 0 16px 16px 16px;
	font-size: 1em;
}

.footerLeft {
	flex: 1;
	display: grid;
	grid-auto-flow: row;
	grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
	grid-auto-rows: 40px;
}

.footerRight {
	flex: 0;
	margin-left: auto;
	display: grid;
	grid-auto-flow: row;
	grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
	grid-auto-rows: 40px;
	direction: rtl;
}

.footerButton {
	display: inline-block;
	padding: 0;
	margin: 0;
	font-size: 1em;
	width: auto;
	height: 100%;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&.footerButtonActive {
		color: var(--MI_THEME-accent);
	}
}

.previewButtonActive {
	color: var(--MI_THEME-accent);
}

@container (max-width: 500px) {
	.headerRight {
		font-size: .9em;
	}

	.headerRightButtonText {
		display: none;
	}

	.visibility {
		overflow: initial;
	}

	.submit {
		margin: 8px 8px 8px 4px;
	}

	.toSpecified {
		padding: 6px 16px;
	}

	.preview {
		padding: 16px 14px 0 14px;
	}

	.cw,
	.hashtags,
	.text {
		padding: 0 16px;
	}

	.text {
		min-height: 80px;
	}

	.footer {
		padding: 0 8px 8px 8px;
	}
}

@container (max-width: 350px) {
	.footer {
		font-size: 0.9em;
	}

	.footerLeft {
		grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
	}

	.footerRight {
		grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
	}

	.headerRight {
		gap: 0;
	}
}
</style>

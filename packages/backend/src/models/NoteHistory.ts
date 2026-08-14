/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, JoinColumn, Column, PrimaryColumn, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import type { MiDriveFile } from './DriveFile.js';

@Entity('note_history')
export class MiNoteHistory {
	@PrimaryColumn(id())
	public id: string;

	@Index('IDX_f23ad074619d2afe0f69da9a95')
	@Column({
		...id(),
	})
	public targetId: MiNote['id'];

	@ManyToOne(() => MiNote, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({
		name: 'targetId',
		foreignKeyConstraintName: 'FK_aacf2074601e204e0f69da9a954',
	})
	public target: MiNote | null;

	// TODO: varcharにしたい
	@Column('text', {
		nullable: true,
	})
	public text: string | null;

	@Column('varchar', {
		length: 256, nullable: true,
	})
	public name: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public cw: string | null;

	@Index('IDX_NOTE_FILE_IDS', { synchronize: false })
	@Column({
		...id(),
		array: true, default: '{}',
	})
	public fileIds: MiDriveFile['id'][];

	@Column('varchar', {
		length: 256, array: true, default: '{}',
	})
	public attachedFileTypes: string[];

	@Index('IDX_NOTE_MENTIONS', { synchronize: false })
	@Column({
		...id(),
		array: true, default: '{}',
	})
	public mentions: MiUser['id'][];

	@Column('text', {
		default: '[]',
	})
	public mentionedRemoteUsers: string;

	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public emojis: string[];

	@Index('IDX_NOTE_TAGS', { synchronize: false })
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public tags: string[];

	@Column('boolean', {
		default: false,
	})
	public hasPoll: boolean;

	constructor(data: Partial<MiNoteHistory>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}

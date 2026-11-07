/**
 * バックアップを文字のコードにして、メッセージアプリで送って貼り付けで戻せるようにする。
 * ファイルをダウンロードできない端末（保護者の制限など）向け。
 * 中身は圧縮した AppState。貼り付けられたものは外から来たデータなので、展開の上限と形のチェックを必ず通す
 */
import type { AppState } from '../domain/types.ts';
import { isAppState } from './validate.ts';
import { fromBase64Url, inflateLimited, toBase64Url } from './share.ts';

/** バックアップのコードだと見分けるための頭の文字 */
export const BACKUP_CODE_PREFIX = 'SSB1.';
/** 貼り付けられる長さの上限。細工された長い文字で端末に負担をかけないため */
const MAX_CODE_CHARS = 200_000;
const BASE64URL_CHAR = /[A-Za-z0-9_-]/;
/** 貼り付けで紛れ込むことがある、目に見えない文字（改行・空白に加えて取り除く） */
const INVISIBLE = /[\s​-‍⁠﻿]+/g;

/** 読めなかった理由。画面にそのまま出せる文にしてある */
export class BackupCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupCodeError';
  }
}

export async function encodeBackupCode(state: AppState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return BACKUP_CODE_PREFIX + toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** メッセージが長くて切れるとき用に、決まった長さで分ける（貼るときは順番に続けて貼ればよい） */
export function splitCode(code: string, partChars: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < code.length; i += partChars) parts.push(code.slice(i, i + partChars));
  return parts;
}

/** 目に見えない文字も分かるように表す */
function showChar(c: string): string {
  const cp = c.codePointAt(0) ?? 0;
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return cp < 0x20 || cp === 0x7f ? hex : `「${c}」(${hex})`;
}

/** 貼り付けの空白・改行・見えない文字を除いた、コードとして読む文字 */
export function normalizeCode(pasted: string): string {
  return pasted.replace(INVISIBLE, '');
}

/**
 * 貼り付けられた文字からバックアップを取り出す。
 * 2通に分けて貼ったときの改行や空白は取り除く。読めないときは、どこがおかしいかを BackupCodeError で返す
 */
export async function decodeBackupCode(pasted: string): Promise<AppState> {
  const text = normalizeCode(pasted);
  if (text.length === 0) throw new BackupCodeError('何も貼り付けられていない。');
  if (text.length > MAX_CODE_CHARS) throw new BackupCodeError(`長すぎる（${text.length}文字）。`);
  if (!text.startsWith(BACKUP_CODE_PREFIX)) {
    throw new BackupCodeError(
      `先頭が「${BACKUP_CODE_PREFIX}」になっていない（貼った先頭は「${text.slice(0, 12)}」）。1通目の最初から貼れているか確かめてね。`,
    );
  }
  const body = text.slice(BACKUP_CODE_PREFIX.length);
  const chars = [...body];
  const bad = chars.findIndex((c) => !BASE64URL_CHAR.test(c));
  if (bad >= 0) {
    const pos = BACKUP_CODE_PREFIX.length + bad + 1;
    const before = chars.slice(Math.max(0, bad - 8), bad).join('');
    throw new BackupCodeError(
      `${pos}文字目に、コードに使わない文字 ${showChar(chars[bad])} が入っている（直前は「${before}」）。メッセージの名前や時刻、2つに分ける目印まで一緒に貼っていないか確かめてね。`,
    );
  }
  let json: string;
  try {
    json = await inflateLimited(fromBase64Url(body));
  } catch (e) {
    if (e instanceof Error && e.message.includes('大きすぎ')) throw new BackupCodeError('中身が大きすぎる。');
    throw new BackupCodeError(
      `文字の種類は正しいけど、途中で切れているか、順番が入れ替わっているみたい（貼った長さは${text.length}文字）。全部の通を、1通目から順番に貼れているか確かめてね。`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BackupCodeError(`中身を読めなかった（貼った長さは${text.length}文字）。どこかの文字が変わっているかも。`);
  }
  if (!isAppState(parsed)) throw new BackupCodeError('中身がこのアプリのバックアップの形になっていない。');
  return parsed;
}

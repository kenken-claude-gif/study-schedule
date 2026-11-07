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
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

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

/**
 * 貼り付けられた文字からバックアップを取り出す。
 * 2通に分けて貼ったときの改行や空白は取り除く。読めないときは理由を例外で返す
 */
export async function decodeBackupCode(pasted: string): Promise<AppState> {
  const text = pasted.replace(/\s+/g, '');
  if (text.length > MAX_CODE_CHARS) throw new Error('コードが長すぎます');
  if (!text.startsWith(BACKUP_CODE_PREFIX)) throw new Error('バックアップのコードではありません');
  const body = text.slice(BACKUP_CODE_PREFIX.length);
  if (!BASE64URL_RE.test(body)) throw new Error('コードに使えない文字が入っています');
  const parsed: unknown = JSON.parse(await inflateLimited(fromBase64Url(body)));
  if (!isAppState(parsed)) throw new Error('コードの中身がバックアップの形式ではありません');
  return parsed;
}

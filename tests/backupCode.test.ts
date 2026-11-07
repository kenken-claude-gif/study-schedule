import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { BACKUP_CODE_PREFIX, BackupCodeError, decodeBackupCode, encodeBackupCode, splitCode } from '../src/app/backupCode.ts';
import type { AppState } from '../src/domain/types.ts';

function sampleState(): AppState {
  return {
    version: 1,
    exams: [
      {
        id: 'e1',
        name: '後期中間テスト',
        studyStart: '2026-11-07',
        subjects: [
          {
            id: 's1',
            name: '数学①',
            kind: 'understand',
            examDate: '2026-11-26',
            weakness: 3,
            materials: [
              { id: 'm1', name: '教科書', kind: 'textbook', unit: 'page', rangeStart: 10, rangeEnd: 40, minutesPerUnit: 4, isSubmission: false, passes: 3 },
            ],
          },
        ],
      },
    ],
    activeExamId: 'e1',
    weekly: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
    events: [],
    logs: [],
    dayPlans: {},
    settings: { loadFactor: 0.8, maxSubjectsPerDay: 3 },
  };
}

const b64url = (b: Buffer) => b.toString('base64url');

test('コードにして戻すと同じ中身になる', async () => {
  const s = sampleState();
  const code = await encodeBackupCode(s);
  assert.ok(code.startsWith(BACKUP_CODE_PREFIX));
  assert.deepEqual(await decodeBackupCode(code), s);
});

test('2つに分けて改行や空白をはさんで貼っても戻せる', async () => {
  const s = sampleState();
  const parts = splitCode(await encodeBackupCode(s), 50);
  assert.ok(parts.length >= 2);
  assert.deepEqual(await decodeBackupCode(` ${parts.join('\n\n')} \n`), s);
});

test('途中で切れたコードは、切れているみたいと理由を出して読み込まない', async () => {
  const code = await encodeBackupCode(sampleState());
  await assert.rejects(decodeBackupCode(code.slice(0, Math.floor(code.length / 2))), (e: unknown) =>
    e instanceof BackupCodeError && /途中で切れている/.test(e.message));
});

test('2通の順番が逆だと読み込まない', async () => {
  const [a, b] = splitCode(await encodeBackupCode(sampleState()), 60);
  await assert.rejects(decodeBackupCode(b + a), BackupCodeError);
});

test('バックアップのJSONをそのまま貼ったときは、先頭が違うと貼った先頭を見せる', async () => {
  await assert.rejects(decodeBackupCode(JSON.stringify(sampleState(), null, 2)), (e: unknown) =>
    e instanceof BackupCodeError && e.message.includes('先頭が「SSB1.」になっていない') && e.message.includes('{"version":1'));
});

test('使わない文字が入っていたら、何文字目に何が入っているかを出す', async () => {
  const code = await encodeBackupCode(sampleState());
  const pasted = `${code.slice(0, 20)}【1/2】${code.slice(20)}`;
  await assert.rejects(decodeBackupCode(pasted), (e: unknown) =>
    e instanceof BackupCodeError && e.message.includes('21文字目') && e.message.includes('「【」(U+3010)'));
});

test('貼り付けで紛れ込む目に見えない文字は取り除いて読める', async () => {
  const s = sampleState();
  const code = await encodeBackupCode(s);
  const pasted = `﻿${code.slice(0, 30)}​\r\n　${code.slice(30)}⁠`;
  assert.deepEqual(await decodeBackupCode(pasted), s);
});

test('形の正しくない中身は読み込まない', async () => {
  const bad = BACKUP_CODE_PREFIX + b64url(deflateRawSync(Buffer.from(JSON.stringify({ version: 1, exams: 'x' }))));
  await assert.rejects(decodeBackupCode(bad), /バックアップの形になっていない/);
});

test('小さなコードが巨大に膨らむ細工は途中でやめる', async () => {
  const bomb = BACKUP_CODE_PREFIX + b64url(deflateRawSync(Buffer.alloc(5_000_000, 0x20)));
  await assert.rejects(decodeBackupCode(bomb), /大きすぎる/);
});

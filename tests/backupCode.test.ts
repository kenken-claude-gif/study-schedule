import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { BACKUP_CODE_PREFIX, decodeBackupCode, encodeBackupCode, splitCode } from '../src/app/backupCode.ts';
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

test('途中で切れたコードは読み込まない', async () => {
  const code = await encodeBackupCode(sampleState());
  await assert.rejects(decodeBackupCode(code.slice(0, Math.floor(code.length / 2))));
});

test('頭の文字がないもの・使えない文字が入ったものは読み込まない', async () => {
  const code = await encodeBackupCode(sampleState());
  await assert.rejects(decodeBackupCode(code.slice(BACKUP_CODE_PREFIX.length)), /バックアップのコードではありません/);
  await assert.rejects(decodeBackupCode(`${code}<script>`), /使えない文字/);
});

test('形の正しくない中身は読み込まない', async () => {
  const bad = BACKUP_CODE_PREFIX + b64url(deflateRawSync(Buffer.from(JSON.stringify({ version: 1, exams: 'x' }))));
  await assert.rejects(decodeBackupCode(bad), /形式ではありません/);
});

test('小さなコードが巨大に膨らむ細工は途中でやめる', async () => {
  const bomb = BACKUP_CODE_PREFIX + b64url(deflateRawSync(Buffer.alloc(5_000_000, 0x20)));
  await assert.rejects(decodeBackupCode(bomb), /大きすぎます/);
});

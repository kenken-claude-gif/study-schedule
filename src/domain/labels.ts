import { isMemoryMaterial, taskRanges } from './scheduler.ts';
import { UNIT_LABEL } from './presets.ts';
import type { ExamSubject, Material, Pass, PlannedTask } from './types.ts';

export const PASS_NAME: Record<Pass, string> = {
  1: '1周目',
  2: '2周目',
  3: '仕上げ',
};

export const PASS_DESC: Record<Pass, string> = {
  1: 'まず全部やる（理解・提出物）',
  2: '×と△だけやり直す',
  3: 'テスト直前の最終チェック',
};

function rangeText(m: Material, from: number, to: number): string {
  if (from === to) {
    if (m.unit === 'page') return `p.${from}`;
    if (m.unit === 'problem') return `問${from}`;
    if (m.unit === 'sheet') return `${from}枚目`;
    return `No.${from}`;
  }
  if (m.unit === 'page') return `p.${from}〜${to}`;
  if (m.unit === 'problem') return `問${from}〜${to}`;
  if (m.unit === 'sheet') return `${from}〜${to}枚目`;
  return `No.${from}〜${to}`;
}

export function counter(m: Material): string {
  return UNIT_LABEL[m.unit].counter;
}

/** 報告画面で「できなかった量」をどう聞くか（単位によって数え方が違う） */
export function wrongLabel(m: Material, s: ExamSubject): string {
  if (isMemoryMaterial(m, s)) return `言えなかった数（${counter(m)}）`;
  if (m.unit === 'page') return '×・△があったページ数';
  if (m.unit === 'sheet') return '×・△があった枚数';
  return `×と△の数（${counter(m)}）`;
}

/** タスクの「何をどれだけ」を一文で */
export function taskTitle(t: PlannedTask, m: Material, s: ExamSubject): string {
  const memory = isMemoryMaterial(m, s);
  const c = counter(m);
  if (t.pass === 1) {
    const ranges = taskRanges(t);
    const r = ranges ? ranges.map(([a, b]) => rangeText(m, a, b)).join('と') : `${t.units}${c}`;
    return memory ? `${m.name} ${r} を覚える` : `${m.name} ${r} を解く`;
  }
  if (t.pass === 2) {
    return memory
      ? `${m.name} ×だった ${t.units}${c} を覚え直す`
      : m.unit === 'page' || m.unit === 'sheet'
        ? `${m.name} ×・△があった ${t.units}${c}分 の×と△を解き直す`
        : `${m.name} ×と△の ${t.units}${c} を解き直す`;
  }
  return memory
    ? `${m.name} ${t.units}${c}分 を最終テスト`
    : `${m.name} まだ×の ${t.units}${c}分 をもう一度`;
}

/** タスクのやり方（勉強のしかたがわからない子向けに、具体的な手順を出す） */
export function taskHowTo(t: PlannedTask, m: Material, s: ExamSubject): string[] {
  const memory = isMemoryMaterial(m, s);
  if (t.pass === 1) {
    if (memory) {
      return [
        '読むだけで終わらせない。見る→隠す→言えるかチェック',
        '言えなかったものに印をつけて、最後にもう一度だけ確認',
        '終わったら「言えなかった数」を×の数として記録',
      ];
    }
    return [
      'まず答えを見ずに自分で解く（わからなければ5分考えて解説へ）',
      '丸つけして ○（できた）△（あやしい）×（できない）を問題番号の横に書く',
      '×と△には解説を読んで、何がわからなかったかを一言メモ',
      '終わったら×と△の数を記録（これが2周目の量になる）',
    ];
  }
  if (t.pass === 2) {
    if (memory) {
      return [
        '印のついたものだけ。もう一度隠してテスト',
        'まだ言えないものは書いて覚え、少し時間をおいてもう一度隠してテスト',
        '最後まで言えなかった数を×として記録',
      ];
    }
    return [
      '×と△の問題だけを、答えを隠してもう一度解く',
      '解説を写すのではなく、閉じてから自分の手で解ききる',
      'まだできなかった問題に★をつけて数を記録（仕上げで使う）',
    ];
  }
  if (memory) {
    return [
      '範囲全部を、赤シートや手で隠して一気にテスト',
      '言えなかったものだけ寝る前にもう一度見る',
    ];
  }
  return [
    '★の問題をもう一度解く',
    '時間があれば、ワークの見開きごとに1問ずつ解いて全体を確認',
    '新しい問題集には手を出さない（今あるものを確実に）',
  ];
}

/** 勉強法のガイド（コツのページ） */
export const GUIDE: { title: string; body: string[] }[] = [
  {
    title: 'まず全体の量を見えるようにする',
    body: [
      'テスト範囲表を見ながら、教科ごとに「何を・どこからどこまで」をアプリに入れる。',
      '提出物（ワークなど）は、提出日も必ず入れる。',
      '量が見えると「今日これだけやればいい」がわかって、不安が減る。',
    ],
  },
  {
    title: '3周で仕上げる',
    body: [
      '1周目：全部やる。答えを見ずに解いて、○△×をつける。',
      '2周目：×と△だけやり直す。ここが一番点数が上がるところ。',
      '仕上げ：テスト前の2〜3日で、まだできない問題と暗記の最終チェック。',
      '1周目で終わりにしないのがポイント。できなかった問題をできるようにするのが「テスト勉強」。',
    ],
  },
  {
    title: '「読む」より「テストする」',
    body: [
      '教科書やノートを読むだけだと、わかった気になるけど覚えていない。',
      '隠して思い出す・問題を解く、という「自分テスト」が一番記憶に残る（想起練習）。',
    ],
  },
  {
    title: '1日に詰め込まず、何日かに分ける',
    body: [
      '同じ時間でも、何日かに分けて勉強した方が忘れにくい（分散学習）。',
      'だからアプリは暗記ものを1日40分までにして、何日かに分けて入れている。',
    ],
  },
  {
    title: '苦手な教科ほど早めに始める',
    body: [
      '苦手な教科は1周目に時間がかかるし、×も多い。',
      'アプリは苦手な教科の1周目を早めに終わらせて、解き直しの時間を多めに取るようにしている。',
    ],
  },
  {
    title: '終わらなかった日は',
    body: [
      'やった量だけ正直に記録すれば、残りは次の日以降に自動で組み直される。',
      '時間が足りなくなったら、点数につながりにくいもの（得意な教科の仕上げや読み直し）から削られて、苦手な教科の解き直しが残る。削ったものは「計画」画面に出る。',
      'それでも足りないときは、予定を家族と相談して見直そう。',
    ],
  },
];

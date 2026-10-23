/** 'YYYY-MM-DD' 形式の日付（ローカル日付） */
export type ISODate = string;
/** 'HH:MM' 形式の時刻 */
export type HHMM = string;

/** 教科のタイプ。理解系は早めに着手、暗記系は分散させて直前に最終確認する */
export type SubjectKind = 'understand' | 'memorize' | 'mixed';

export type MaterialKind = 'workbook' | 'print' | 'textbook' | 'notes' | 'vocab' | 'other';
export type Unit = 'page' | 'problem' | 'item' | 'sheet';
export type Pass = 1 | 2 | 3;
/** 範囲のリスト（例: [[1, 5], [9, 10]] = 1〜5と9〜10）。両端を含む */
export type Ranges = [number, number][];

/** 範囲に含まれる教材（ワーク・プリント・単語など） */
export interface Material {
  id: string;
  name: string;
  kind: MaterialKind;
  unit: Unit;
  rangeStart: number;
  rangeEnd: number;
  /** 1単位（1ページ・1問・1語）あたりの目安時間（分） */
  minutesPerUnit: number;
  /** 提出物かどうか。提出物の1周目は削らない */
  isSubmission: boolean;
  dueDate?: ISODate;
  /** 何周目まで回すか（1〜3） */
  passes: Pass;
}

export type Weakness = 1 | 2 | 3 | 4 | 5;

export interface ExamSubject {
  id: string;
  name: string;
  kind: SubjectKind;
  examDate: ISODate;
  /** 苦手意識 1=得意 〜 5=すごく苦手 */
  weakness: Weakness;
  lastScore?: number;
  targetScore?: number;
  materials: Material[];
}

export interface Exam {
  id: string;
  name: string;
  /** 勉強を始める日（計画の起点） */
  studyStart: ISODate;
  subjects: ExamSubject[];
  /** テスト後に入力する結果（subjectId → 点数） */
  results?: Record<string, number>;
  finished?: boolean;
}

export interface TimeWindow {
  start: HHMM;
  end: HHMM;
}

/** 曜日（0=日〜6=土）ごとの勉強できる時間帯 */
export type WeeklyPattern = Record<number, TimeWindow[]>;

export type EventCategory = '部活' | '塾' | '習い事' | '家族' | '遊び' | 'その他';

/** テスト勉強以外の予定 */
export interface LifeEvent {
  id: string;
  title: string;
  category: EventCategory;
  date: ISODate;
  allDay: boolean;
  start?: HHMM;
  end?: HHMM;
  /** 毎週くり返す（repeatUntil まで） */
  repeatWeekly?: boolean;
  repeatUntil?: ISODate;
}

/** 1日のやった量の報告 */
export interface ProgressLog {
  id: string;
  date: ISODate;
  examId: string;
  subjectId: string;
  materialId: string;
  pass: Pass;
  amount: number;
  /** ×と△の数（問題演習・暗記チェックで見つかった「できなかった数」） */
  wrong?: number;
  taskId?: string;
  /** 1周目でやった範囲。先取りなど順番どおりでない記録でも、どこが終わったかわかるように持つ */
  ranges?: Ranges;
}

/** スケジューラが作る1つのタスク */
export interface PlannedTask {
  id: string;
  date: ISODate;
  subjectId: string;
  materialId: string;
  pass: Pass;
  /** 1周目のみ：範囲の開始・終了 */
  from?: number;
  to?: number;
  /** 1周目のみ：やる範囲（途中に終わった部分があると複数になる） */
  ranges?: Ranges;
  units: number;
  minutes: number;
}

/** 模試の1教科分の結果。点数・満点・偏差値はどれも任意（返ってきたものだけ入れる） */
export interface MockScore {
  subject: string;
  score?: number;
  max?: number;
  deviation?: number;
}

/** 模試の結果 */
export interface MockExam {
  id: string;
  name: string;
  date: ISODate;
  scores: MockScore[];
}

export interface Settings {
  /** 使える時間のうち予定で埋める割合。残りは予備（遅れの吸収用） */
  loadFactor: number;
  /** 1日に扱う教科の上限（多すぎると集中が切れる） */
  maxSubjectsPerDay: number;
}

export interface AppState {
  version: 1;
  exams: Exam[];
  activeExamId?: string;
  weekly: WeeklyPattern;
  events: LifeEvent[];
  logs: ProgressLog[];
  /** その日の朝に確定した計画（examId → date → タスク）。遅れの判定に使う */
  dayPlans: Record<string, Record<ISODate, PlannedTask[]>>;
  settings: Settings;
  /** 模試の結果（後から追加した項目なので、古いデータにはない） */
  mockExams?: MockExam[];
}

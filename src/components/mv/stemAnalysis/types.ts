//==============================================================================
// ステム分離 (ボーカル / ドラム / ベース / その他) の型定義。
// spike-stem (Phase 0 ベンチスパイク) の実測結果を踏まえた本体統合契約。
//
// メモリ規律:
//   - StemBuffers (PCM) は分離直後の試聴・WAV 保存用のセッションキャッシュ。
//     長尺曲 (AUTO_PCM_RELEASE_SEC 超過) では解析完了後に自動解放する
//   - 描画 / AI への供給は小容量の StemAnalysis メタデータのみ。PCM は
//     AudioSignals 契約に一切含めない (トークン爆発・メモリ常駐の防止)
//==============================================================================

/** 分離される stem 種別 (分離エンジンの 4 出力に対応) */
export type StemKind = 'vocals' | 'drums' | 'bass' | 'other';

export const STEM_KINDS: readonly StemKind[] = ['vocals', 'drums', 'bass', 'other'] as const;

/** 分離出力のステレオ PCM (サンプルレートは STEM_SAMPLE_RATE 固定) */
export interface StemBuffers {
    left: Float32Array;
    right: Float32Array;
}

/** 分離結果一式 (PCM 含むため常駐させない) */
export interface StemSeparationResult {
    stems: Record<StemKind, StemBuffers>;
    sampleRate: number;
    /** 分離した音源の長さ (秒) */
    durationSec: number;
    /** 推論バックエンド表記 (例: webgpu / wasm) */
    backend: string;
    elapsedSec: number;
    speedX: number;
    /** 分離完了時刻 (epoch ms) */
    separatedAt: number;
    /** 元音源のフィンガープリント (名前+長さ)。不一致時の再分離判定に使用 */
    sourceFingerprint: string;
}

/** ドラム onset (打撃) の 1 件 */
export interface StemOnset {
    timeSec: number;
    /** 打撃強度 0..1 */
    strength: number;
}

/** ボーカル発声区間 */
export interface StemVocalSegment {
    startSec: number;
    endSec: number;
    /** 区間平均エネルギー 0..1 */
    meanEnergy: number;
}


/**
 * 分離 PCM から導出する小容量メタデータ。
 * 描画 (stemSignalsAtTime) と AI (WebMCP ツール) の共通データ源。
 * すべての要素が決定論的 (同一 PCM → 同一結果) であることをテストで保証する。
 */
export interface StemAnalysis {
    version: 1;
    sampleRate: number;
    durationSec: number;
    /** 拍検知から推定した BPM (提案値。既存 BPM の自動上書きはしない) */
    proposedBpm: number;
    /** 拍グリッド推定の信頼度 0..1 */
    beatConfidence: number;
    /** 拍グリッドの位相オフセット (秒)。最初の拍の位置 */
    beatOffsetSec: number;
    /** ドラム onset 列 (時刻昇順) */
    drumOnsets: StemOnset[];
    /** stem ごとのエネルギー包絡 (bandSec 刻みの正規化 RMS 0..1) */
    energy: Record<StemKind, number[]>;
    /** energy 配列の 1 バンド長 (秒) */
    bandSec: number;
    /** ボーカル発声区間 (開始時刻昇順) */
    vocalSegments: StemVocalSegment[];
}

/** AudioSignals.stem として供給するリアルタイム強化シグナル */
export interface StemSignals {
    /** ドラム onset 直後に 1.0 となり指数減衰するパルス 0..1 */
    drumPulse: number;
    /** 直近ドラム onset からの経過秒 (onset がまだ無い区間は durationSec 相当) */
    timeSinceDrumOnset: number;
    /** ボーカル発声エネルギー 0..1 (包絡補間) */
    vocalEnergy: number;
    /** 現在ボーカル発声中か (無音区間の口パク事故防止フラグ) */
    vocalActive: boolean;
    /** ベース低域エネルギー 0..1 (包絡補間) */
    bassEnergy: number;
}

//==============================================================================
// Worker メッセージ契約
//==============================================================================

export type StemWorkerRequest =
    | { type: 'load-model'; modelUrl: string; ortWasmUrl?: string }
    | { type: 'separate'; left: Float32Array; right: Float32Array; sampleRate: number }
    /** 分離済み PCM (worker 内キャッシュ) から 16bit WAV を生成して返す */
    | { type: 'export-wav'; kind: StemKind }
    /** ステムの波形ピーク配列を返す (数KB・WAV 生成不要) */
    | { type: 'get-peaks'; kind: StemKind; numPoints: number }
    /** worker 内 PCM キャッシュを解放する (メモリ規律) */
    | { type: 'release-pcm' };

export type StemWorkerResponse =
    | { type: 'log'; phase: string; message: string }
    | { type: 'model-progress'; loaded: number; total: number }
    | { type: 'model-ready'; backend: string }
    | { type: 'separate-progress'; progress: number; currentSegment: number; totalSegments: number }
    | {
        type: 'separate-done';
        stems: Record<StemKind, StemBuffers>;
        sampleRate: number;
        elapsedSec: number;
        audioSec: number;
        speedX: number;
        backend: string;
    }
    | { type: 'analysis-done'; analysis: StemAnalysis }
    | { type: 'wav-ready'; kind: StemKind; wav: ArrayBuffer }
    /** ステムの波形ピーク配列 (ミニ波形描画用・数KB) */
    | { type: 'peaks-ready'; kind: StemKind; peaks: Float32Array }
    | { type: 'error'; message: string };


/** 分離エンジンが固定で出力するサンプルレート */
export const STEM_SAMPLE_RATE = 44100;

/** この秒数を超える楽曲では解析完了後に PCM を自動解放する (メモリ規律) */
export const AUTO_PCM_RELEASE_SEC = 180;

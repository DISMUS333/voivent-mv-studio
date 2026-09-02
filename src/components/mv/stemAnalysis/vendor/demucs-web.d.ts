//==============================================================================
// demucs-web (MIT ライセンスの JS モジュール) の最小型宣言。
// spike-stem ベンチスパイクと同一の使用面のみを宣言する。
//==============================================================================
declare module '*/demucs-web/src/index.js' {
    export interface DemucsProgressInfo {
        progress: number;
        currentSegment: number;
        totalSegments: number;
    }

    export interface DemucsProcessorOptions {
        ort: any;
        sessionOptions: Record<string, unknown>;
        onProgress?: (info: DemucsProgressInfo) => void;
        onLog?: (phase: string, message: string) => void;
    }

    export class DemucsProcessor {
        constructor(opts: DemucsProcessorOptions);
        loadModel(modelBuffer: ArrayBuffer): Promise<void>;
        separate(left: Float32Array, right: Float32Array): Promise<Record<string, { left: Float32Array; right: Float32Array }>>;
    }

    export const CONSTANTS: {
        SAMPLE_RATE: number;
    };
}

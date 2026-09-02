//==============================================================================
// カウントイン (Count-In) & メトロノームクリック音生成器
// Web Audio API のオシレーターによる超低レイテンシ・ゼロ負荷クリック
//==============================================================================

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

export function playClickSound(isAccent: boolean = false) {
    try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // ウッドブロック / 電子クリック
        const freq = isAccent ? 1600 : 1000;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.type = 'sine';

        gain.gain.setValueAtTime(isAccent ? 0.6 : 0.35, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.05);
    } catch (_) {}
}

export interface CountInOptions {
    bpm: number;
    beats?: number; // default: 4 (1 measure in 4/4)
    onTick: (remainingBeat: number) => void;
    onComplete: () => void;
}

export function startCountIn({ bpm, beats = 4, onTick, onComplete }: CountInOptions): () => void {
    const intervalMs = (60 / Math.max(20, Math.min(400, bpm))) * 1000;
    let currentBeat = beats;

    // 最初の拍
    playClickSound(true);
    onTick(currentBeat);

    const timer = setInterval(() => {
        currentBeat -= 1;
        if (currentBeat <= 0) {
            clearInterval(timer);
            onComplete();
        } else {
            playClickSound(false);
            onTick(currentBeat);
        }
    }, intervalMs);

    return () => clearInterval(timer);
}

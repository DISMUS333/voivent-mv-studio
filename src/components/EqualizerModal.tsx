import React, { useEffect, useMemo, useRef, useState } from 'react';
import { native } from '../native';
import { FloatingWindow } from './FloatingWindow';
import { IconSliders, IconPower, IconCheck, IconUndo } from './Icons';
import { ParametricEqParams } from '../types';

interface EqualizerModalProps {
    trackIndex: number;
    clipIndex?: number;
    clipName?: string;
    initialParams?: ParametricEqParams;
    onClose: () => void;
    onApplied?: () => void;
}

const defaultEqParams: ParametricEqParams = {
    bands: [
        { freq: 80, gainDb: 0, q: 0.7, type: 1, enabled: true },   // Low Shelf
        { freq: 450, gainDb: 0, q: 1.2, type: 0, enabled: true },  // Low-Mid Bell
        { freq: 2800, gainDb: 0, q: 1.2, type: 0, enabled: true }, // High-Mid Bell
        { freq: 10000, gainDb: 0, q: 0.7, type: 2, enabled: true },// High Shelf
    ],
    outputGainDb: 0,
    bypass: false,
};

// 洗練されたプロスタジオ・アクセントカラーパレット
const bandColors = ['#38bdf8', '#818cf8', '#fb7185', '#34d399'];
const bandNames = ['1. LOW', '2. LOW-MID', '3. HIGH-MID', '4. HIGH'];
const bandTypeLabels = ['BELL / PEAK', 'LOW SHELF', 'HIGH SHELF', 'HPF (LOW CUT)', 'LPF (HIGH CUT)'];

//==============================================================================
// 高密度ハードウェア・アナログノブ（洗練されたダークメタル仕様）
//==============================================================================
interface HardwareDialProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    accentColor?: string;
    curve?: 'linear' | 'logarithmic';
    format?: (value: number) => string;
    disabled?: boolean;
    onChange: (value: number) => void;
}

function HardwareDial({ label, value, min, max, step, accentColor = '#38bdf8', curve = 'linear', format, disabled = false, onChange }: HardwareDialProps) {
    const dragStart = useRef<{ y: number; value: number } | null>(null);

    const activeRatio = curve === 'logarithmic'
        ? Math.max(0, Math.min(1, (Math.log(Math.max(value, min)) - Math.log(min)) / (Math.log(max) - Math.log(min) || 1)))
        : Math.max(0, Math.min(1, (value - min) / (max - min || 1)));

    const angle = -135 + activeRatio * 270;
    const clampValue = (next: number) => Math.max(min, Math.min(max, next));

    const changeFromDrag = (clientY: number) => {
        if (!dragStart.current || disabled) return;
        const normalizedDelta = (dragStart.current.y - clientY) / 200;
        const startRatio = curve === 'logarithmic'
            ? (Math.log(Math.max(dragStart.current.value, min)) - Math.log(min)) / (Math.log(max) - Math.log(min) || 1)
            : (dragStart.current.value - min) / (max - min || 1);
        const nextRatio = Math.max(0, Math.min(1, startRatio + normalizedDelta));
        const next = curve === 'logarithmic'
            ? Math.exp(Math.log(min) + nextRatio * (Math.log(max) - Math.log(min)))
            : min + nextRatio * (max - min);
        const snapped = min + Math.round((next - min) / step) * step;
        onChange(Number(clampValue(snapped).toFixed(4)));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40, gap: 2, opacity: disabled ? 0.35 : 1 }}>
            <span style={{ fontSize: 7.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.05em' }}>{label}</span>
            <div
                onWheel={(e) => {
                    if (disabled) return;
                    // WebView のパッシブリスナー警告を避けるため preventDefault しない
                    const direction = e.deltaY < 0 ? 1 : -1;
                    const next = clampValue(value + direction * step);
                    onChange(Number(next.toFixed(4)));
                }}
                onPointerDown={(e) => {
                    if (disabled) return;
                    e.preventDefault();
                    dragStart.current = { y: e.clientY, value };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => changeFromDrag(e.clientY)}
                onPointerUp={(e) => {
                    dragStart.current = null;
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                style={{
                    position: 'relative',
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: `conic-gradient(from 225deg, ${accentColor} 0deg, ${accentColor}88 ${Math.max(2, activeRatio * 270)}deg, #1e2630 ${Math.max(2, activeRatio * 270)}deg 270deg, transparent 270deg)`,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.6)',
                    cursor: disabled ? 'default' : 'ns-resize',
                    touchAction: 'none',
                    userSelect: 'none',
                }}
            >
                {/* ノブ本体キャップ */}
                <div style={{ position: 'absolute', inset: 2.5, borderRadius: '50%', background: 'radial-gradient(circle at 35% 25%, #2a3441, #13181f 80%)', border: '1px solid #334155' }} />
                {/* アクセントカラーポインタ針 */}
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 3,
                    width: 1.5,
                    height: 10,
                    transformOrigin: '50% 11px',
                    transform: `translateX(-50%) rotate(${angle}deg)`,
                    background: accentColor,
                    borderRadius: 1,
                    boxShadow: `0 0 3px ${accentColor}`,
                }} />
            </div>
            {/* デジタル数値バッジ */}
            <span style={{ minWidth: 40, padding: '1px 2px', border: '1px solid #232d3b', borderRadius: 2, background: '#0b0f14', color: accentColor, fontFamily: 'monospace', fontSize: 8, textAlign: 'center', lineHeight: 1 }}>
                {format ? format(value) : value.toFixed(step < 0.1 ? 1 : 0)}
            </span>
        </div>
    );
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({
    trackIndex,
    clipIndex,
    clipName,
    initialParams,
    onClose,
    onApplied,
}) => {
    const [params, setParams] = useState<ParametricEqParams>(initialParams || defaultEqParams);
    const [selectedBand, setSelectedBand] = useState<number>(0);
    const [isApplying, setIsApplying] = useState(false);
    const [appliedSuccess, setAppliedSuccess] = useState(false);

    const svgRef = useRef<SVGSVGElement | null>(null);
    const draggingBand = useRef<number | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const [realSpectrum, setRealSpectrum] = useState<number[]>([]);

    // C++ からの実音リアルタイム FFT スペクトラム取得ループ（60fps）
    useEffect(() => {
        let active = true;
        const fetchSpectrum = async () => {
            if (!active) return;
            try {
                const data = await native.getTrackSpectrum(trackIndex);
                if (active && Array.isArray(data)) {
                    setRealSpectrum(data);
                }
            } catch { /* noop */ }
            if (active) {
                animFrameRef.current = requestAnimationFrame(fetchSpectrum);
            }
        };
        animFrameRef.current = requestAnimationFrame(fetchSpectrum);
        return () => {
            active = false;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [trackIndex]);

    // 初期化時にトラックEQの最新パラメータを取得
    useEffect(() => {
        const initEq = async () => {
            try {
                if (clipIndex !== undefined && clipIndex >= 0) {
                    const clipEq = await native.sessionGetClipEqParams(trackIndex, clipIndex);
                    if (clipEq && clipEq.bands) setParams(clipEq as ParametricEqParams);
                } else {
                    const trackEq = await native.getTrackEq(trackIndex);
                    if (trackEq && trackEq.bands) setParams(trackEq as ParametricEqParams);
                }
            } catch { /* noop */ }
        };
        void initEq();
    }, [trackIndex, clipIndex]);

    // パラメータ変更時に C++ のトラックDSPへ即時リアルタイム反映
    const updateParamsAndSyncDsp = (newParams: ParametricEqParams) => {
        setParams(newParams);
        void native.setTrackEq(trackIndex, newParams);
    };

    // プリセット定義
    const presets = [
        { name: 'フラット (Default)', params: defaultEqParams },
        {
            name: 'ボーカル / 抜け感ブースト',
            params: {
                bands: [
                    { freq: 100, gainDb: -4.5, q: 0.8, type: 3, enabled: true },
                    { freq: 500, gainDb: -2.5, q: 1.5, type: 0, enabled: true },
                    { freq: 3500, gainDb: 4.0, q: 1.2, type: 0, enabled: true },
                    { freq: 12000, gainDb: 3.0, q: 0.7, type: 2, enabled: true },
                ],
                outputGainDb: 0.5,
                bypass: false,
            }
        },
        {
            name: 'シンセ / 極太ベースブースト',
            params: {
                bands: [
                    { freq: 65, gainDb: 5.5, q: 1.1, type: 1, enabled: true },
                    { freq: 300, gainDb: -3.0, q: 1.4, type: 0, enabled: true },
                    { freq: 2200, gainDb: 2.0, q: 1.0, type: 0, enabled: true },
                    { freq: 8000, gainDb: -2.0, q: 0.8, type: 2, enabled: true },
                ],
                outputGainDb: -1.0,
                bypass: false,
            }
        },
        {
            name: 'アコースティック / クリーン',
            params: {
                bands: [
                    { freq: 80, gainDb: -6.0, q: 0.7, type: 3, enabled: true },
                    { freq: 400, gainDb: -3.5, q: 1.8, type: 0, enabled: true },
                    { freq: 4500, gainDb: 3.5, q: 1.1, type: 0, enabled: true },
                    { freq: 10000, gainDb: 2.5, q: 0.7, type: 2, enabled: true },
                ],
                outputGainDb: 0.0,
                bypass: false,
            }
        },
        {
            name: 'ローファイ (Lo-Fi Vintage)',
            params: {
                bands: [
                    { freq: 350, gainDb: -12.0, q: 0.7, type: 3, enabled: true },
                    { freq: 1200, gainDb: 4.5, q: 2.0, type: 0, enabled: true },
                    { freq: 3500, gainDb: -4.0, q: 1.0, type: 0, enabled: true },
                    { freq: 4500, gainDb: -14.0, q: 0.7, type: 4, enabled: true },
                ],
                outputGainDb: 2.0,
                bypass: false,
            }
        },
    ];

    // 周波数カーブの計算（20Hz〜20000Hz、対数軸）
    const graphWidth = 590;
    const graphHeight = 150;
    const minFreq = 20;
    const maxFreq = 20000;
    const minDb = -18;
    const maxDb = 18;

    const freqToX = (f: number) => {
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const logF = Math.log10(Math.max(minFreq, Math.min(maxFreq, f)));
        return ((logF - logMin) / (logMax - logMin)) * graphWidth;
    };

    const xToFreq = (x: number) => {
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const ratio = Math.max(0, Math.min(1, x / graphWidth));
        return Math.round(Math.pow(10, logMin + ratio * (logMax - logMin)));
    };

    const dbToY = (db: number) => {
        const ratio = (db - minDb) / (maxDb - minDb);
        return graphHeight - ratio * graphHeight;
    };

    const yToDb = (y: number) => {
        const ratio = 1 - Math.max(0, Math.min(1, y / graphHeight));
        return Number((minDb + ratio * (maxDb - minDb)).toFixed(1));
    };

    // 周波数応答曲線の SVG パス生成
    const curvePath = useMemo(() => {
        if (params.bypass) {
            const y0 = dbToY(params.outputGainDb);
            return `M 0 ${y0} L ${graphWidth} ${y0}`;
        }

        const points: string[] = [];
        const numSteps = 120;
        for (let i = 0; i <= numSteps; ++i) {
            const ratio = i / numSteps;
            const logMin = Math.log10(minFreq);
            const logMax = Math.log10(maxFreq);
            const freq = Math.pow(10, logMin + ratio * (logMax - logMin));

            let totalDb = params.outputGainDb;
            for (const b of params.bands) {
                if (!b.enabled) continue;
                const f0 = b.freq;
                const g = b.gainDb;
                const q = Math.max(0.1, b.q);

                if (b.type === 0) { // Bell
                    const dist = Math.abs(Math.log2(freq / f0));
                    const width = 1.0 / q;
                    const response = Math.exp(-0.5 * Math.pow(dist / (width * 0.5), 2));
                    totalDb += g * response;
                } else if (b.type === 1) { // Low shelf
                    if (freq < f0) {
                        totalDb += g;
                    } else if (freq < f0 * 2) {
                        const t = (freq - f0) / f0;
                        totalDb += g * (1 - t);
                    }
                } else if (b.type === 2) { // High shelf
                    if (freq > f0) {
                        totalDb += g;
                    } else if (freq > f0 * 0.5) {
                        const t = (f0 - freq) / (f0 * 0.5);
                        totalDb += g * (1 - t);
                    }
                } else if (b.type === 3) { // HPF
                    if (freq < f0) {
                        const octaves = Math.log2(f0 / freq);
                        totalDb -= octaves * 12.0;
                    }
                } else if (b.type === 4) { // LPF
                    if (freq > f0) {
                        const octaves = Math.log2(freq / f0);
                        totalDb -= octaves * 12.0;
                    }
                }
            }

            const x = ratio * graphWidth;
            const y = Math.max(0, Math.min(graphHeight, dbToY(totalDb)));
            points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
        }
        return points.join(' ');
    }, [params]);

    // リアルタイム FFT 実音スペクトラムの SVG パス生成（ダイナミックな波打ち）
    const spectrumPath = useMemo(() => {
        if (params.bypass || realSpectrum.length === 0) return '';

        const hasSound = realSpectrum.some((db) => db > -48.0);
        if (!hasSound) return '';

        const points: string[] = [];
        const numBands = realSpectrum.length;

        for (let i = 0; i < numBands; ++i) {
            // C++ 側はバンド b を [b/n, (b+1)/n] の対数区間に割り当てるため、
            // 区間中心に対応させると EQ カーブ軸と正確に揃う
            const ratio = (i + 0.5) / numBands;
            const x = ratio * graphWidth;
            const db = Math.max(minDb, Math.min(maxDb, realSpectrum[i]));
            const y = Math.max(0, Math.min(graphHeight, dbToY(db)));
            points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
        }
        return points.join(' ');
    }, [realSpectrum, params.bypass]);

    // ドラッグ操作による周波数＆ゲイン変更
    const handlePointerDown = (bandIdx: number, e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        draggingBand.current = bandIdx;
        setSelectedBand(bandIdx);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (draggingBand.current === null || !svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const newFreq = xToFreq(mouseX);
        const newDb = yToDb(mouseY);

        const nextBands = [...params.bands];
        const b = nextBands[draggingBand.current!];
        if (b) {
            nextBands[draggingBand.current!] = {
                ...b,
                freq: newFreq,
                gainDb: b.type === 3 || b.type === 4 ? 0 : newDb,
            };
        }
        updateParamsAndSyncDsp({ ...params, bands: nextBands });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        draggingBand.current = null;
        if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

    // クリップ波形へのオフライン確定（クリップ指定時のみ）
    const handleApplyToClip = async () => {
        if (clipIndex === undefined || clipIndex < 0) return;
        setIsApplying(true);
        try {
            const ok = await native.sessionApplyClipEq(trackIndex, clipIndex, params);
            if (ok) {
                setAppliedSuccess(true);
                setTimeout(() => setAppliedSuccess(false), 2000);
                onApplied?.();
            }
        } finally {
            setIsApplying(false);
        }
    };

    const headerTitle = clipIndex !== undefined && clipIndex >= 0
        ? `4-BAND PARAMETRIC EQ — Track ${trackIndex + 1} : ${clipName || `Clip ${clipIndex + 1}`}`
        : `4-BAND PARAMETRIC EQ — Track ${trackIndex + 1}`;

    return (
        <FloatingWindow
            isOpen={true}
            title={headerTitle}
            onClose={onClose}
            initialWidth={640}
            initialHeight={470}
            minWidth={610}
            minHeight={450}
        >
            <div style={{
                padding: '10px 12px',
                background: 'linear-gradient(180deg, #13171c 0%, #0d1014 100%)',
                color: '#e2e8f0',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                width: '100%',
                boxSizing: 'border-box',
                border: '1px solid #232d3b',
                borderRadius: 4,
                boxShadow: '0 16px 40px rgba(0,0,0,0.9)',
            }}>
                {/* 上部ヘッダー：実機ディスプレイ風プリセット ＆ 電源スイッチ ＆ クリップ反映 */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                    background: '#161d26',
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #283344',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.04em' }}>プリセット:</span>
                        <select
                            onChange={(e) => {
                                const idx = Number(e.target.value);
                                if (presets[idx]) updateParamsAndSyncDsp(presets[idx].params);
                            }}
                            style={{
                                background: '#0b0f14',
                                color: '#e2e8f0',
                                border: '1px solid #334155',
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 6px',
                                borderRadius: 3,
                                outline: 'none',
                                cursor: 'pointer',
                            }}
                        >
                            {presets.map((p, idx) => (
                                <option key={p.name} value={idx}>{p.name}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* EQ ON/OFF 電源スイッチ */}
                        <button
                            onClick={() => updateParamsAndSyncDsp({ ...params, bypass: !params.bypass })}
                            style={{
                                background: params.bypass ? '#3b1c1c' : '#143828',
                                color: params.bypass ? '#f87171' : '#34d399',
                                border: `1px solid ${params.bypass ? '#ef4444' : '#10b981'}`,
                                borderRadius: 3,
                                padding: '3px 8px',
                                fontSize: 9.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                boxShadow: params.bypass ? 'none' : '0 0 6px rgba(16, 185, 129, 0.3)',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <IconPower size={11} color={params.bypass ? '#f87171' : '#34d399'} />
                            {params.bypass ? 'BYPASS' : 'EQ ON'}
                        </button>

                        {clipIndex !== undefined && clipIndex >= 0 && (
                            <button
                                onClick={handleApplyToClip}
                                disabled={isApplying}
                                style={{
                                    background: appliedSuccess ? '#10b981' : 'linear-gradient(180deg, #2563eb, #1d4ed8)',
                                    color: '#fff',
                                    border: '1px solid #3b82f6',
                                    borderRadius: 3,
                                    padding: '3px 10px',
                                    fontSize: 9.5,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                }}
                            >
                                {appliedSuccess ? <IconCheck size={11} color="#fff" /> : <IconSliders size={11} color="#fff" />}
                                {isApplying ? '処理中...' : appliedSuccess ? '完了' : '波形に反映'}
                            </button>
                        )}
                    </div>
                </div>

                {/* 実機オシロスコープ風 CRT 周波数レスポンス ＆ リアルタイム・スペクトラムアナライザー */}
                <div style={{
                    position: 'relative',
                    width: '100%',
                    height: graphHeight,
                    background: 'radial-gradient(ellipse at center, #111a24 0%, #070a0f 100%)',
                    border: '1px solid #283548',
                    borderRadius: 4,
                    overflow: 'hidden',
                    marginBottom: 8,
                    boxShadow: 'inset 0 0 16px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.6)',
                }}>
                    {/* 周波数グリッド線 ＆ dB 目盛り */}
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        {[50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(f => {
                            const x = freqToX(f);
                            return (
                                <div key={f} style={{ position: 'absolute', left: x, top: 0, bottom: 0, borderLeft: '1px dashed rgba(71, 85, 105, 0.25)' }}>
                                    <span style={{ fontSize: 7.5, color: '#64748b', paddingLeft: 2, fontFamily: 'monospace' }}>
                                        {f >= 1000 ? `${f / 1000}k` : `${f}`}
                                    </span>
                                </div>
                            );
                        })}
                        {/* 0dB センターライン */}
                        <div style={{ position: 'absolute', left: 0, right: 0, top: dbToY(0), borderTop: '1px solid rgba(148, 163, 184, 0.35)' }}>
                            <span style={{ fontSize: 7.5, color: '#94a3b8', paddingLeft: 4, fontFamily: 'monospace' }}>0 dB</span>
                        </div>
                        {/* +12dB / -12dB ガイド */}
                        <div style={{ position: 'absolute', left: 0, right: 0, top: dbToY(12), borderTop: '1px dotted rgba(71, 85, 105, 0.2)' }}>
                            <span style={{ fontSize: 7, color: '#64748b', paddingLeft: 4, fontFamily: 'monospace' }}>+12</span>
                        </div>
                        <div style={{ position: 'absolute', left: 0, right: 0, top: dbToY(-12), borderTop: '1px dotted rgba(71, 85, 105, 0.2)' }}>
                            <span style={{ fontSize: 7, color: '#64748b', paddingLeft: 4, fontFamily: 'monospace' }}>-12</span>
                        </div>
                    </div>

                    {/* SVG 曲線 ＆ リアルタイム・スペクトラムアナライザー ＆ コントロールポイント */}
                    <svg
                        ref={svgRef}
                        width="100%"
                        height="100%"
                        viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
                    >
                        <defs>
                            {/* EQ カーブのシアン塗りつぶしグラデーション */}
                            <linearGradient id="eqFillGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
                                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                            </linearGradient>
                            {/* リアルタイム・スペクトラムアナライザーの発光グラデーション */}
                            <linearGradient id="spectrumGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#34d399" stopOpacity="0.45" />
                                <stop offset="40%" stopColor="#38bdf8" stopOpacity="0.25" />
                                <stop offset="100%" stopColor="#0b0f14" stopOpacity="0.0" />
                            </linearGradient>
                        </defs>

                        {/* 🌊 リアルタイム・実音スペクトラムアナライザー（力強く跳ね上がる波形） */}
                        {spectrumPath && (
                            <>
                                <path d={`${spectrumPath} L ${graphWidth} ${graphHeight} L 0 ${graphHeight} Z`} fill="url(#spectrumGrad)" />
                                <path d={spectrumPath} fill="none" stroke="#34d399" strokeWidth="1.5" strokeOpacity="0.8" style={{ filter: 'drop-shadow(0 0 3px #34d399)' }} />
                            </>
                        )}

                        {/* EQ レスポンス曲線 */}
                        <path d={`${curvePath} L ${graphWidth} ${graphHeight} L 0 ${graphHeight} Z`} fill="url(#eqFillGrad)" />
                        <path d={curvePath} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.6))' }} />

                        {/* 4つのバンドコントロールポイント（●） */}
                        {params.bands.map((band, idx) => {
                            const cx = freqToX(band.freq);
                            const cy = dbToY(band.gainDb);
                            const isSelected = selectedBand === idx;
                            const col = bandColors[idx];

                            return (
                                <g key={idx} style={{ cursor: 'grab' }}>
                                    <circle
                                        cx={cx}
                                        cy={cy}
                                        r={isSelected ? 10 : 8}
                                        fill={band.enabled ? col : '#475569'}
                                        stroke="#ffffff"
                                        strokeWidth={isSelected ? 2 : 1}
                                        onPointerDown={(e) => handlePointerDown(idx, e)}
                                        style={{ filter: `drop-shadow(0 0 ${isSelected ? 6 : 3}px ${col})` }}
                                    />
                                    <text
                                        x={cx}
                                        y={cy + 3}
                                        fill="#0f172a"
                                        fontSize="8"
                                        fontWeight="900"
                                        textAnchor="middle"
                                        pointerEvents="none"
                                    >
                                        {idx + 1}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                </div>

                {/* 4バンド独立モジュールストリップ（洗練されたダークメタル） */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 8 }}>
                    {params.bands.map((band, idx) => {
                        const isSelected = selectedBand === idx;
                        const col = bandColors[idx];

                        return (
                            <div
                                key={idx}
                                onClick={() => setSelectedBand(idx)}
                                style={{
                                    background: isSelected ? '#1c2430' : '#141a22',
                                    border: `1px solid ${isSelected ? col : '#263342'}`,
                                    borderRadius: 4,
                                    padding: '6px 4px',
                                    boxShadow: isSelected ? `0 0 8px ${col}33` : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                {/* バンドヘッダー：名前 ＆ ON/OFF LED */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, borderBottom: '1px solid #232d3b', paddingBottom: 3 }}>
                                    <span style={{ fontSize: 9, fontWeight: 800, color: col, letterSpacing: '0.03em' }}>{bandNames[idx]}</span>
                                    <input
                                        type="checkbox"
                                        checked={band.enabled}
                                        onChange={(e) => {
                                            const enabled = e.target.checked;
                                            const nextB = [...params.bands];
                                            nextB[idx] = { ...nextB[idx], enabled };
                                            updateParamsAndSyncDsp({ ...params, bands: nextB });
                                        }}
                                        style={{ cursor: 'pointer', accentColor: col }}
                                    />
                                </div>

                                {/* フィルタータイプセレクター */}
                                <div style={{ marginBottom: 6 }}>
                                    <select
                                        value={band.type}
                                        onChange={(e) => {
                                            const type = Number(e.target.value);
                                            const nextB = [...params.bands];
                                            nextB[idx] = { ...nextB[idx], type };
                                            updateParamsAndSyncDsp({ ...params, bands: nextB });
                                        }}
                                        style={{
                                            width: '100%',
                                            background: '#0b0f14',
                                            color: '#cbd5e1',
                                            border: '1px solid #263342',
                                            fontSize: 7.5,
                                            fontWeight: 700,
                                            padding: '2px',
                                            borderRadius: 2,
                                            outline: 'none',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {bandTypeLabels.map((lbl, tIdx) => (
                                            <option key={lbl} value={tIdx}>{lbl}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* 3連ハードウェアノブ（FREQ / GAIN / Q） */}
                                <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                                    <HardwareDial
                                        label="FREQ"
                                        value={band.freq}
                                        min={20}
                                        max={20000}
                                        step={1}
                                        curve="logarithmic"
                                        accentColor={col}
                                        format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`)}
                                        onChange={(freq) => {
                                            const nextB = [...params.bands];
                                            nextB[idx] = { ...nextB[idx], freq };
                                            updateParamsAndSyncDsp({ ...params, bands: nextB });
                                        }}
                                    />

                                    <HardwareDial
                                        label="GAIN"
                                        value={band.gainDb}
                                        min={-18}
                                        max={18}
                                        step={0.5}
                                        accentColor={col}
                                        disabled={band.type === 3 || band.type === 4}
                                        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
                                        onChange={(gainDb) => {
                                            const nextB = [...params.bands];
                                            nextB[idx] = { ...nextB[idx], gainDb };
                                            updateParamsAndSyncDsp({ ...params, bands: nextB });
                                        }}
                                    />

                                    <HardwareDial
                                        label="Q"
                                        value={band.q}
                                        min={0.1}
                                        max={10}
                                        step={0.1}
                                        accentColor={col}
                                        format={(v) => v.toFixed(2)}
                                        onChange={(q) => {
                                            const nextB = [...params.bands];
                                            nextB[idx] = { ...nextB[idx], q };
                                            updateParamsAndSyncDsp({ ...params, bands: nextB });
                                        }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 下段：マスター出力ゲイン (GAIN) ＆ リセット */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#161d26',
                    padding: '6px 12px',
                    borderRadius: 4,
                    border: '1px solid #283344',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.04em' }}>GAIN:</span>
                        <input
                            type="range"
                            min={-24}
                            max={12}
                            step={0.5}
                            value={params.outputGainDb}
                            onChange={(e) => updateParamsAndSyncDsp({ ...params, outputGainDb: Number(e.target.value) })}
                            style={{ width: 240, cursor: 'pointer', accentColor: '#38bdf8' }}
                        />
                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace', minWidth: 48 }}>
                            {params.outputGainDb > 0 ? `+${params.outputGainDb.toFixed(1)}` : params.outputGainDb.toFixed(1)} dB
                        </span>
                    </div>

                    <button
                        onClick={() => updateParamsAndSyncDsp({ ...params, outputGainDb: 0 })}
                        style={{
                            background: '#232d3b',
                            color: '#94a3b8',
                            border: '1px solid #334155',
                            fontSize: 8.5,
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 3,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                        }}
                    >
                        <IconUndo size={10} color="#94a3b8" />
                        リセット
                    </button>
                </div>
            </div>
        </FloatingWindow>
    );
};

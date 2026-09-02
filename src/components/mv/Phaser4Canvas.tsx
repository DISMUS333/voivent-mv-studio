//==============================================================================
// Phaser 4 WebGL オーディオリアクティブ ＆ 真のピクセル物理文字エンジン
//
// 市販プロ機材仕様（Trapcode Form / TouchDesigner 相当）：
//   - 文字グリフのピクセル座標をリアルタイム解析（字形サンプリング）
//   - 数千個のピクセル粒子による物理シミュレーション
//   - 粒子崩壊: 文字そのものが砂塵（チリ）となって物理的に上空へ舞い上がり散華
//   - 幾何学合体: 散らばった数千の粒子が文字の形へ一斉に超高速飛来してドッキング
//   - 液体モーフィング: 文字のピクセルそのものがサイン波流体演算でドロドロと波打つ
//   - 衝撃波バウンド: キックで粒子が爆発拡散し、スプリング物理で文字の形へ引き戻される
//==============================================================================
import React, { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import type { AudioSignals, LyricEffectKind, LyricItem, PhaserThemeKind } from './types';
import { fxAdvanceSeconds, clampCameraZoom } from './mvFxTime';
import { resolvePhaserTheme, markPhaserCanvasFresh } from './mvPhaserFallback';

interface Phaser4CanvasProps {
    signals: AudioSignals;
    theme?: PhaserThemeKind;
    lyricEffect?: LyricEffectKind;
    lyrics?: LyricItem[];
    /**
     * Phaser が生成した内部 <canvas> ノードを親へ forward するための ref。
     * MV 動画エクスポートの Phaser canvas 直接 drawImage キャプチャに使用する。
     * 省略時は接続しない。
     */
    canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
}

interface PixelParticle {
    targetX: number;
    targetY: number;
    curX: number;
    curY: number;
    vx: number;
    vy: number;
    initOffsetX: number;
    initOffsetY: number;
    randomDelay: number;
    alpha: number;
    size: number;
    color: number;
}

export const Phaser4Canvas: React.FC<Phaser4CanvasProps> = ({
    signals,
    theme = 'oscilloscope',
    lyricEffect = 'particle_disintegrate',
    lyrics = [],
    canvasRef,
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const gameRef = useRef<Phaser.Game | null>(null);
    const signalsRef = useRef<AudioSignals>(signals);
    const lyricsRef = useRef<LyricItem[]>(lyrics);
    const lyricEffectRef = useRef<LyricEffectKind>(lyricEffect);

    useEffect(() => {
        signalsRef.current = signals;
    }, [signals]);

    useEffect(() => {
        lyricsRef.current = lyrics;
    }, [lyrics]);

    useEffect(() => {
        lyricEffectRef.current = lyricEffect;
    }, [lyricEffect]);

    useEffect(() => {
        if (!containerRef.current) return;
        if (theme === 'none' && lyricEffect === undefined) {
            if (gameRef.current) {
                gameRef.current.destroy(true);
                gameRef.current = null;
            }
            return;
        }

        if (gameRef.current) {
            gameRef.current.destroy(true);
            gameRef.current = null;
        }

        const currentTheme = resolvePhaserTheme(theme);

        class MvTruePixelEngineScene extends Phaser.Scene {
            private bgGraphics!: Phaser.GameObjects.Graphics;
            private glowGraphics!: Phaser.GameObjects.Graphics;
            private pixelGraphics!: Phaser.GameObjects.Graphics;
            private warpGraphics!: Phaser.GameObjects.Graphics;
            private dustEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

            // オシロスコープ用残光履歴
            private lissajousHistory: Array<{ points: Array<{ x: number; y: number }>; alpha: number }> = [];

            /**
             * 装飾アニメーション用内部時計（delta 積算）。
             * タイムライン時計 (signals.timeSeconds) と分離しており、
             * 一時停止・停止中も演出が呼吸し続ける。カラオケ同期判定は引き続き
             * タイムライン時計を使用するため整合性は損なわれない。
             */
            private fxClock: number = 0;

            /** カメラズームの安全適用（非数・異常値ガード ＋ 冗書き込み抑制） */
            private applyCameraZoom(targetZoom: number): void {
                const safe = clampCameraZoom(targetZoom);
                if (Math.abs(this.cameras.main.zoom - safe) > 0.0005) {
                    this.cameras.main.setZoom(safe);
                }
            }

            // 流体オーロラ用位相
            private auroraPhases: number[] = [0, 1.2, 2.5, 3.8];

            // 3D ワープ星屑ライン
            private warpStars: Array<{ x: number; y: number; z: number; pz: number }> = [];

            // 文字ピクセル粒子群
            private lyricParticles: PixelParticle[] = [];
            private currentRenderedText: string = '';
            private activePhraseIndex: number = -1;

            create() {
                this.bgGraphics = this.add.graphics();
                this.glowGraphics = this.add.graphics();
                this.warpGraphics = this.add.graphics();
                this.pixelGraphics = this.add.graphics();
                const width = this.scale.width;
                const height = this.scale.height;

                // ── 1. 大気ダスト用テクスチャ ──────────────────────────────
                if (!this.textures.exists('ambient_soft_dust')) {
                    const canvas = this.textures.createCanvas('ambient_soft_dust', 64, 64);
                    if (canvas) {
                        const ctx = canvas.getContext();
                        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
                        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
                        grad.addColorStop(0.3, 'rgba(224, 231, 255, 0.6)');
                        grad.addColorStop(0.7, 'rgba(148, 163, 184, 0.15)');
                        grad.addColorStop(1, 'rgba(148, 163, 184, 0)');
                        ctx.fillStyle = grad;
                        ctx.fillRect(0, 0, 64, 64);
                        canvas.refresh();
                    }
                }

                // ── 2. 大気ダストエミッター ────────────────────────────────
                if (currentTheme === 'ambient_bokeh') {
                    try {
                        this.dustEmitter = this.add.particles(width / 2, height / 2, 'ambient_soft_dust', {
                            x: { min: 0, max: width },
                            y: { min: 0, max: height },
                            speedX: { min: -12, max: 12 },
                            speedY: { min: -20, max: -4 },
                            lifespan: { min: 4000, max: 8000 },
                            scale: { start: 0.2, end: 0.7 },
                            alpha: { start: 0, end: 0.8 },
                            blendMode: Phaser.BlendModes.ADD,
                            frequency: 50,
                            quantity: 2,
                        });
                    } catch (e) {
                        console.warn('[Phaser4Canvas] Emitter setup fallback:', e);
                    }
                }

                // ── リサイズイベントでカメラとビューポートを自動追従 ────────
                this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
                    const nw = gameSize.width;
                    const nh = gameSize.height;
                    if (this.cameras?.main) {
                        this.cameras.main.setViewport(0, 0, nw, nh);
                        this.cameras.main.setSize(nw, nh);
                    }
                });

                // ── 3. 3D ワープ星屑ライン ─────────────────────────────────
                for (let i = 0; i < 120; i++) {
                    this.warpStars.push({
                        x: (Math.random() - 0.5) * width * 2,
                        y: (Math.random() - 0.5) * height * 2,
                        z: Math.random() * width,
                        pz: Math.random() * width,
                    });
                }
            }

            // ── オフスクリーンで字形をスキャンし、ピクセル座標を抽出 ────────
            private sampleLyricPixels(text: string, centerX: number, targetY: number) {
                if (!text || text.trim() === '') {
                    this.lyricParticles = [];
                    this.currentRenderedText = '';
                    return;
                }

                const offCanvas = document.createElement('canvas');
                const offCtx = offCanvas.getContext('2d');
                if (!offCtx) return;

                const fontSize = 42;
                offCtx.font = `900 ${fontSize}px "Helvetica Neue", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif`;
                const textMetrics = offCtx.measureText(text);
                const textWidth = Math.ceil(textMetrics.width) + 40;
                const textHeight = Math.ceil(fontSize * 1.5) + 30;

                offCanvas.width = textWidth;
                offCanvas.height = textHeight;

                offCtx.font = `900 ${fontSize}px "Helvetica Neue", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif`;
                offCtx.fillStyle = '#ffffff';
                offCtx.textAlign = 'center';
                offCtx.textBaseline = 'middle';
                offCtx.fillText(text, textWidth / 2, textHeight / 2);

                const imgData = offCtx.getImageData(0, 0, textWidth, textHeight);
                const data = imgData.data;
                const particles: PixelParticle[] = [];

                // 3px 間隔でグリッドスキャン（高密度サンプリング）
                const step = 3;
                for (let y = 0; y < textHeight; y += step) {
                    for (let x = 0; x < textWidth; x += step) {
                        const idx = (y * textWidth + x) * 4;
                        const alpha = data[idx + 3];
                        if (alpha > 128) {
                            const worldTargetX = centerX - textWidth / 2 + x;
                            const worldTargetY = targetY - textHeight / 2 + y;

                            const angle = Math.random() * Math.PI * 2;
                            const dist = 300 + Math.random() * 450;

                            particles.push({
                                targetX: worldTargetX,
                                targetY: worldTargetY,
                                curX: worldTargetX,
                                curY: worldTargetY,
                                vx: (Math.random() - 0.5) * 60,
                                vy: -80 - Math.random() * 180, // 上向きの崩壊初速
                                initOffsetX: Math.cos(angle) * dist,
                                initOffsetY: Math.sin(angle) * dist,
                                randomDelay: Math.random() * 0.15,
                                alpha: 1.0,
                                size: step * 0.95,
                                color: 0xffffff,
                            });
                        }
                    }
                }

                this.lyricParticles = particles;
                this.currentRenderedText = text;
            }

            update(_time: number, delta: number) {
                const sig = signalsRef.current;
                const lyricLines = lyricsRef.current;
                const activeStyle = lyricEffectRef.current ?? 'particle_disintegrate';

                // 親コンテナおよび Phaser Scale の実ピクセル幅・高さを正確に取得
                // （縦動画 9:16 や正方形 1:1、小型プレビュー時も完全フルスクリーン追従）
                const width = this.scale.width > 50 ? this.scale.width : (containerRef.current?.clientWidth || 1280);
                const height = this.scale.height > 50 ? this.scale.height : (containerRef.current?.clientHeight || 720);
                const centerX = width / 2;
                const centerY = height / 2;
                const dt = Math.min(delta / 16.666, 2.0);
                // 内部時計を進める（再生中のみ進め、停止時はそのフレームで静止画ホールド）
                if (sig.isPlaying) {
                    this.fxClock += fxAdvanceSeconds(delta);
                }
                const fxTime = this.fxClock; // 装飾用時計（波形位相等に使用）

                // ライブ canvas の鮮度を記録（オフライン書き出し側が
                // drawImage して良い状態かの判定に使用する）
                markPhaserCanvasFresh(this.game?.canvas ?? null);

                this.bgGraphics.clear();
                this.glowGraphics.clear();
                this.warpGraphics.clear();
                this.pixelGraphics.clear();

                // =========================================================================
                // 🎨 A. バックグラウンド描画
                // =========================================================================
                if (currentTheme === 'oscilloscope') {
                    const t = this.fxClock;
                    const freq1 = 2.0 + sig.mid * 2.5;
                    const freq2 = 3.0 + sig.high * 3.5;
                    const phase = t * 2.0;
                    const radiusX = Math.min(width, height) * (0.26 + sig.low * 0.10);
                    const radiusY = Math.min(width, height) * (0.26 + sig.mid * 0.10);

                    const pointsCount = 200;
                    const currentPoints: Array<{ x: number; y: number }> = [];
                    for (let i = 0; i <= pointsCount; i++) {
                        const theta = (i / pointsCount) * Math.PI * 2;
                        const x = centerX + Math.sin(theta * freq1 + phase) * radiusX;
                        const y = centerY * 0.78 + Math.sin(theta * freq2) * radiusY;
                        currentPoints.push({ x, y });
                    }

                    this.lissajousHistory.unshift({ points: currentPoints, alpha: 1.0 });
                    if (this.lissajousHistory.length > 14) this.lissajousHistory.pop();

                    for (let h = this.lissajousHistory.length - 1; h >= 0; h--) {
                        const trail = this.lissajousHistory[h];
                        trail.alpha *= 0.84;
                        const pts = trail.points;
                        if (pts.length < 2) continue;

                        const isLatest = h === 0;
                        const alphaVal = isLatest ? 0.95 : trail.alpha * 0.4;
                        const lineWidth = isLatest ? (2.2 + sig.peak * 1.8) : (1.0 + trail.alpha * 1.2);
                        const lineColor = isLatest ? 0xa7f3d0 : 0x059669;

                        this.bgGraphics.lineStyle(lineWidth, lineColor, alphaVal);
                        this.bgGraphics.beginPath();
                        this.bgGraphics.moveTo(pts[0].x, pts[0].y);
                        for (let p = 1; p < pts.length; p++) {
                            this.bgGraphics.lineTo(pts[p].x, pts[p].y);
                        }
                        this.bgGraphics.strokePath();

                        if (isLatest) {
                            this.glowGraphics.lineStyle(lineWidth * 3.5, 0x34d399, alphaVal * 0.3);
                            this.glowGraphics.beginPath();
                            this.glowGraphics.moveTo(pts[0].x, pts[0].y);
                            for (let p = 1; p < pts.length; p++) {
                                this.glowGraphics.lineTo(pts[p].x, pts[p].y);
                            }
                            this.glowGraphics.strokePath();
                        }
                    }

                    this.bgGraphics.lineStyle(1, 0x064e3b, 0.35);
                    this.bgGraphics.lineBetween(centerX - radiusX * 1.15, centerY * 0.78, centerX + radiusX * 1.15, centerY * 0.78);
                    this.bgGraphics.lineBetween(centerX, centerY * 0.78 - radiusY * 1.15, centerX, centerY * 0.78 + radiusY * 1.15);
                } else if (currentTheme === 'fluid_aurora') {
                    const layers = 4;
                    for (let l = 0; l < layers; l++) {
                        this.auroraPhases[l] += (0.006 + l * 0.003) * (1.0 + sig.low * 1.8) * dt;
                        const phase = this.auroraPhases[l];
                        const baseAmp = 30 + l * 16 + sig.low * 50 + sig.mid * 35;
                        const yOffset = height * (0.35 + l * 0.08);

                        const colors = [0x4338ca, 0x0284c7, 0x059669, 0x7c3aed];
                        const col = colors[l % colors.length];
                        const alpha = Math.min(0.6, (0.12 + sig.peak * 0.3) * (1.0 - l * 0.15));

                        this.glowGraphics.fillStyle(col, alpha * 0.35);
                        this.glowGraphics.beginPath();
                        this.glowGraphics.moveTo(0, height);
                        this.glowGraphics.lineTo(0, yOffset);

                        for (let x = 0; x <= width; x += 20) {
                            const normX = x / width;
                            const wave1 = Math.sin(normX * 3.0 + phase) * baseAmp;
                            const wave2 = Math.cos(normX * 6.0 - phase * 0.7) * (baseAmp * 0.35);
                            const y = yOffset + wave1 + wave2;
                            this.glowGraphics.lineTo(x, y);
                        }

                        this.glowGraphics.lineTo(width, height);
                        this.glowGraphics.closePath();
                        this.glowGraphics.fillPath();

                        this.bgGraphics.lineStyle(1.5 + sig.high * 1.5, col, alpha * 0.8);
                        this.bgGraphics.beginPath();
                        for (let x = 0; x <= width; x += 15) {
                            const normX = x / width;
                            const wave1 = Math.sin(normX * 3.0 + phase) * baseAmp;
                            const wave2 = Math.cos(normX * 6.0 - phase * 0.7) * (baseAmp * 0.35);
                            const y = yOffset + wave1 + wave2;
                            if (x === 0) this.bgGraphics.moveTo(x, y);
                            else this.bgGraphics.lineTo(x, y);
                        }
                        this.bgGraphics.strokePath();
                    }
                } else if (currentTheme === 'ambient_bokeh') {
                    if (this.dustEmitter) {
                        const boost = 1.0 + sig.low * 2.2 + sig.beat * 1.5;
                        this.dustEmitter.speedY = { min: -30 * boost, max: -8 * boost } as never;
                    }
                    const glowRadius = Math.min(width, height) * (0.2 + sig.low * 0.15);
                    this.glowGraphics.fillStyle(0x38bdf8, 0.04 + sig.peak * 0.08);
                    this.glowGraphics.fillCircle(centerX, centerY * 0.78, glowRadius);
                } else if (currentTheme === 'spectrum_bars') {
                    const barCount = 32;
                    const barWidth = width / (barCount * 1.4);
                    const gap = barWidth * 0.4;
                    const startX = (width - (barCount * (barWidth + gap))) / 2;

                    for (let i = 0; i < barCount; i++) {
                        const normI = i / barCount;
                        const weight = normI < 0.3 ? (1 - normI / 0.3) * sig.low
                                     : normI < 0.7 ? (1 - Math.abs(normI - 0.5) / 0.2) * sig.mid
                                     : (normI - 0.7) / 0.3 * sig.high;
                        const dynamicAmp = Math.sin(i * 0.3 + this.fxClock * 5) * 0.15;
                        const finalAmp = Math.max(0.04, Math.min(1.0, weight * 0.85 + dynamicAmp + sig.peak * 0.1));
                        const barH = finalAmp * height * 0.35;
                        const x = startX + i * (barWidth + gap);
                        const y = height * 0.62 - barH;

                        const isHighLevel = finalAmp > 0.7;
                        const barColor = isHighLevel ? 0xf59e0b : 0x10b981;

                        this.bgGraphics.fillStyle(barColor, 0.85);
                        this.bgGraphics.fillRect(x, y, barWidth, barH);
                        this.bgGraphics.fillStyle(0xffffff, 0.9);
                        this.bgGraphics.fillRect(x, y - 4, barWidth, 2);
                    }
                }

                // =========================================================================
                // ⚡️ B. 真のピクセル物理文字演算（字形そのものの崩壊＆変形）
                // =========================================================================
                const curTime = sig.timeSeconds;
                let activePhrase: LyricItem | null = null;
                let activeIndex = -1;

                if (activeStyle === 'none') {
                    this.lyricParticles = [];
                    this.currentRenderedText = '';
                    this.activePhraseIndex = -1;
                    return;
                }

                for (let i = 0; i < lyricLines.length; i++) {
                    const line = lyricLines[i];
                    const dur = line.duration ?? 4.0;
                    if (curTime >= line.time && curTime <= line.time + dur) {
                        activePhrase = line;
                        activeIndex = i;
                        break;
                    }
                }

                const lyricY = height * 0.75; // 文字の中心Y座標

                if (activePhrase) {
                    const dur = activePhrase.duration ?? 4.0;
                    const elapsedInPhrase = curTime - activePhrase.time;
                    const phraseProgress = Math.min(1.0, Math.max(0.0, elapsedInPhrase / dur));

                    // 新フレーズ突入時に文字グリフをピクセル解析
                    if (this.currentRenderedText !== activePhrase.text || this.activePhraseIndex !== activeIndex) {
                        this.activePhraseIndex = activeIndex;
                        this.sampleLyricPixels(activePhrase.text, centerX, lyricY);
                    }

                    // ─────────────────────────────────────────────────────────────
                    // 1. 💥 真の粒子崩壊（文字そのものが砂塵となって舞い上がり崩壊）
                    // ─────────────────────────────────────────────────────────────
                    if (activeStyle === 'particle_disintegrate') {
                        const inTime = 0.20;
                        const disintegrateThreshold = 0.72; // 残り 28% から物理崩壊開始

                        if (phraseProgress < disintegrateThreshold) {
                            // 歌唱中: 文字の形をピタッと保持しながら、音圧で微粒子呼吸
                            const inProgress = Math.min(1.0, elapsedInPhrase / inTime);
                            for (let i = 0; i < this.lyricParticles.length; i++) {
                                const p = this.lyricParticles[i];
                                p.curX = p.targetX;
                                p.curY = p.targetY + Math.sin(fxTime * 8 + p.targetX * 0.05) * (sig.low * 4);
                                p.alpha = inProgress;
                            }
                        } else {
                            // 崩壊中: 文字を構成するピクセルが1つずつ解き放たれ、重力・風・乱気流で散華！
                            const disProgress = (phraseProgress - disintegrateThreshold) / (1.0 - disintegrateThreshold);
                            for (let i = 0; i < this.lyricParticles.length; i++) {
                                const p = this.lyricParticles[i];
                                if (disProgress > p.randomDelay) {
                                    const t = disProgress - p.randomDelay;
                                    // 物理位置更新（上向きの風 ＋ 乱気流サイン波）
                                    p.curX = p.targetX + p.vx * t * 3.5 + Math.sin(t * 12 + p.targetY) * 20;
                                    p.curY = p.targetY + p.vy * t * 3.5 + Math.pow(t, 2) * 50; // 重力加速
                                    p.alpha = Math.max(0, 1.0 - t * 1.8);
                                }
                            }
                        }
                    }

                    // ─────────────────────────────────────────────────────────────
                    // 2. 🧩 真の幾何学合体（四方から飛来して文字の形にガシッとスナップ合体）
                    // ─────────────────────────────────────────────────────────────
                    else if (activeStyle === 'kinetic_assembly') {
                        const assembleDuration = 0.28;
                        if (elapsedInPhrase < assembleDuration) {
                            const pNorm = elapsedInPhrase / assembleDuration;
                            // Back.easeOut イージング（少し行き過ぎて戻る）
                            const s = 1.70158;
                            const ease = 1 + (s + 1) * Math.pow(pNorm - 1, 3) + s * Math.pow(pNorm - 1, 2);

                            for (let i = 0; i < this.lyricParticles.length; i++) {
                                const p = this.lyricParticles[i];
                                p.curX = p.targetX + p.initOffsetX * (1 - ease);
                                p.curY = p.targetY + p.initOffsetY * (1 - ease);
                                p.alpha = Math.min(1.0, pNorm * 1.5);
                            }
                            this.cameras.main.setZoom(1.0 + (1 - pNorm) * 0.08);
                        } else {
                            for (let i = 0; i < this.lyricParticles.length; i++) {
                                const p = this.lyricParticles[i];
                                p.curX = p.targetX;
                                p.curY = p.targetY;
                                p.alpha = phraseProgress > 0.88 ? Math.max(0, (1 - phraseProgress) / 0.12) : 1.0;
                            }
                            this.cameras.main.setZoom(1.0 + sig.beat * 0.03);
                        }
                    }

                    // ─────────────────────────────────────────────────────────────
                    // 3. 💧 真の液体モーフィング（文字の線そのものが流体サイン波でうねる）
                    // ─────────────────────────────────────────────────────────────
                    else if (activeStyle === 'liquid_morph') {
                        const waveSpeed = this.fxClock * 8.0;
                        const amp = 12 + sig.low * 28 + sig.mid * 16;
                        for (let i = 0; i < this.lyricParticles.length; i++) {
                            const p = this.lyricParticles[i];
                            p.curX = p.targetX + Math.sin(p.targetY * 0.06 + waveSpeed) * amp;
                            p.curY = p.targetY + Math.cos(p.targetX * 0.04 + waveSpeed * 0.7) * (amp * 0.4);
                            p.alpha = phraseProgress > 0.88 ? Math.max(0, (1 - phraseProgress) / 0.12) : 1.0;
                        }
                    }

                    // ─────────────────────────────────────────────────────────────
                    // 4. 🎛️ 真の衝撃波バウンド（キックで外側へ爆散し、スプリングで戻る）
                    // ─────────────────────────────────────────────────────────────
                    else if (activeStyle === 'impact_reactive') {
                        const kickForce = sig.beat * 45;
                        for (let i = 0; i < this.lyricParticles.length; i++) {
                            const p = this.lyricParticles[i];
                            const dx = p.targetX - centerX;
                            const dy = p.targetY - lyricY;
                            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                            // 衝撃波ベクトル
                            p.curX = p.targetX + (dx / dist) * kickForce;
                            p.curY = p.targetY + (dy / dist) * kickForce;
                            p.alpha = phraseProgress > 0.88 ? Math.max(0, (1 - phraseProgress) / 0.12) : 1.0;
                        }
                        if (sig.beat > 0.75) {
                            this.cameras.main.shake(90, 0.012);
                        }
                    }

                    // ─────────────────────────────────────────────────────────────
                    // 5. ⚡️ 真のRGB色収差グリッチ（赤と青にピクセルが引き裂かれる）
                    // ─────────────────────────────────────────────────────────────
                    else if (activeStyle === 'glitch_neon') {
                        const splitShift = (sig.peak > 0.6 || sig.beat > 0.7) ? (sig.peak * 18) : (Math.sin(this.fxClock * 25) * 4);
                        for (let i = 0; i < this.lyricParticles.length; i++) {
                            const p = this.lyricParticles[i];
                            p.curX = p.targetX;
                            p.curY = p.targetY;
                            p.alpha = phraseProgress > 0.88 ? Math.max(0, (1 - phraseProgress) / 0.12) : 1.0;
                        }

                        // 赤と青のゴーストピクセル描画
                        this.pixelGraphics.fillStyle(0xf43f5e, 0.75);
                        for (let i = 0; i < this.lyricParticles.length; i += 2) {
                            const p = this.lyricParticles[i];
                            if (p.alpha > 0) {
                                this.pixelGraphics.fillRect(p.curX - splitShift, p.curY, p.size, p.size);
                            }
                        }
                        this.pixelGraphics.fillStyle(0x38bdf8, 0.75);
                        for (let i = 1; i < this.lyricParticles.length; i += 2) {
                            const p = this.lyricParticles[i];
                            if (p.alpha > 0) {
                                this.pixelGraphics.fillRect(p.curX + splitShift, p.curY, p.size, p.size);
                            }
                        }
                    }

                    // ─────────────────────────────────────────────────────────────
                    // 6. 🚀 3D空間ハイパーワープ
                    // ─────────────────────────────────────────────────────────────
                    else if (activeStyle === 'camera_warp') {
                        const warpInTime = 0.28;
                        const warpSpeed = (elapsedInPhrase < warpInTime) ? 45 : (phraseProgress > 0.85 ? 60 : 15 + sig.beat * 25);

                        this.warpGraphics.lineStyle(1.5, 0xffffff, 0.7);
                        for (let i = 0; i < this.warpStars.length; i++) {
                            const star = this.warpStars[i];
                            star.pz = star.z;
                            star.z -= warpSpeed * dt;
                            if (star.z <= 0) {
                                star.z = width;
                                star.pz = width;
                                star.x = (Math.random() - 0.5) * width * 2;
                                star.y = (Math.random() - 0.5) * height * 2;
                            }
                            const k = 250 / star.z;
                            const px = centerX + star.x * k;
                            const py = centerY + star.y * k;

                            const pk = 250 / star.pz;
                            const prevX = centerX + star.x * pk;
                            const prevY = centerY + star.y * pk;

                            if (px >= 0 && px <= width && py >= 0 && py <= height) {
                                this.warpGraphics.lineBetween(prevX, prevY, px, py);
                            }
                        }

                        const scale = elapsedInPhrase < warpInTime ? (0.2 + (elapsedInPhrase / warpInTime) * 0.8) : (phraseProgress > 0.85 ? 1.0 + ((phraseProgress - 0.85) / 0.15) * 1.5 : 1.0);
                        for (let i = 0; i < this.lyricParticles.length; i++) {
                            const p = this.lyricParticles[i];
                            p.curX = centerX + (p.targetX - centerX) * scale;
                            p.curY = lyricY + (p.targetY - lyricY) * scale;
                            p.alpha = phraseProgress > 0.85 ? Math.max(0, 1.0 - (phraseProgress - 0.85) / 0.15) : Math.min(1.0, elapsedInPhrase / warpInTime);
                        }
                    }

                    // ── メインピクセル粒子群の一括 GPU 描画 ────────────────────
                    for (let i = 0; i < this.lyricParticles.length; i++) {
                        const p = this.lyricParticles[i];
                        if (p.alpha > 0.01) {
                            this.pixelGraphics.fillStyle(p.color, p.alpha);
                            this.pixelGraphics.fillRect(p.curX, p.curY, p.size, p.size);
                        }
                    }
                } else {
                    this.activePhraseIndex = -1;
                    this.currentRenderedText = '';
                    this.lyricParticles = [];
                    this.cameras.main.setZoom(1.0);
                    this.cameras.main.setRotation(0);
                }
            }
        }

        const w = (containerRef.current.clientWidth > 50) ? containerRef.current.clientWidth : 1280;
        const h = (containerRef.current.clientHeight > 50) ? containerRef.current.clientHeight : 720;

        const config: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: containerRef.current,
            width: w,
            height: h,
            transparent: true,
            scale: {
                mode: Phaser.Scale.RESIZE,
                autoCenter: Phaser.Scale.CENTER_BOTH,
            },
            render: {
                antialias: true,
                // 🎬 MV 動画エクスポート対応: WebGL バッファをフレーム間で保持。
                // これを true にしないと requestAnimationFrame の直後に
                // drawImage しても透明な canvas がコピーされる（真っ暗の原因）。
                preserveDrawingBuffer: true,
                powerPreference: 'high-performance',
            },
            scene: [MvTruePixelEngineScene],
        };

        try {
            gameRef.current = new Phaser.Game(config);
        } catch (err) {
            console.warn('[Phaser4Canvas] WebGL initialization fallback:', err);
        }

        // 🎬 Phaser canvas ノードを親 ref へ forward。
        // Phaser 4 は `parent: containerRef.current` へ canvas を挿入するため、
        // 次の requestAnimationFrame で container 直下の canvas を探して渡す。
        if (canvasRef) {
            const tryAttachCanvas = () => {
                const c = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
                if (c) {
                    canvasRef.current = c;
                } else {
                    // まだ挿入されていなければ次フレーム再試行（最大 30 フレーム）
                    if (++attachAttempt < 30) {
                        requestAnimationFrame(tryAttachCanvas);
                    }
                }
            };
            let attachAttempt = 0;
            requestAnimationFrame(tryAttachCanvas);
        }

        // 親コンテナのリサイズ（メイン画面・小窓・解像度切替）を自動追従。
        // フルスクリーン解除時はブラウザのレイアウト確定と resize 通知に
        // 数フレームのずれが出るため、同じサイズ同期を複数フレーム再試行する。
        let resizeRaf = 0;
        let resizePass = 0;
        const resizeTimeouts: number[] = [];
        const syncSize = () => {
            const host = containerRef.current;
            const game = gameRef.current;
            if (!host || !game) return;

            const nw = Math.floor(host.getBoundingClientRect().width);
            const nh = Math.floor(host.getBoundingClientRect().height);
            if (nw <= 20 || nh <= 20) return;

            if (game.scale.width !== nw || game.scale.height !== nh) {
                game.scale.resize(nw, nh);
            }
            const scene = game.scene.scenes[0];
            if (scene && scene.cameras?.main) {
                scene.cameras.main.setViewport(0, 0, nw, nh);
                scene.cameras.main.setSize(nw, nh);
            }
        };
        const runStableResize = () => {
            cancelAnimationFrame(resizeRaf);
            resizePass = 0;
            const step = () => {
                syncSize();
                resizePass += 1;
                if (resizePass < 6) resizeRaf = requestAnimationFrame(step);
            };
            resizeRaf = requestAnimationFrame(step);
        };
        const resizeObserver = new ResizeObserver(runStableResize);

        const onWindowResize = () => runStableResize();
        const onFullscreenChange = () => {
            runStableResize();
            resizeTimeouts.push(
                window.setTimeout(runStableResize, 120),
                window.setTimeout(runStableResize, 320),
            );
        };

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }
        window.addEventListener('resize', onWindowResize);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        window.visualViewport?.addEventListener('resize', onWindowResize);
        runStableResize();

        return () => {
            resizeObserver.disconnect();
            cancelAnimationFrame(resizeRaf);
            resizeTimeouts.forEach((id) => window.clearTimeout(id));
            window.removeEventListener('resize', onWindowResize);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            window.visualViewport?.removeEventListener('resize', onWindowResize);
            if (canvasRef) canvasRef.current = null;
            if (gameRef.current) {
                gameRef.current.destroy(true);
                gameRef.current = null;
            }
        };
    }, [theme, lyricEffect, canvasRef]);

    if (theme === 'none' && lyricEffect === undefined) return null;

    return (
        <div
            ref={containerRef}
            className="phaser-canvas-host"
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                zIndex: 10,
                pointerEvents: 'none',
                overflow: 'hidden',
                mixBlendMode: 'screen',
            }}
        >
            <style>{`
                .phaser-canvas-host canvas {
                    width: 100% !important;
                    height: 100% !important;
                    display: block !important;
                    position: absolute !important;
                    inset: 0 !important;
                }
            `}</style>
        </div>
    );
};

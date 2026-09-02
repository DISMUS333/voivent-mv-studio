// トラックヘッダー右クリックメニュー（トラック追加・削除・音源切替）。
import { IconPiano, IconPlus, IconTrash, IconWaveform } from '../Icons';

export type TrackInstrumentKind = 'none' | 'va' | 'voice';

const instrumentOptions: Array<{
    value: TrackInstrumentKind;
    label: string;
    description: string;
}> = [
        { value: 'none', label: '内蔵音源なし', description: 'プラグインのみ' },
        { value: 'va', label: 'VA シンセ', description: 'アナログ風エンジン' },
        { value: 'voice', label: '声シンセ', description: '録音声を音源化' },
    ];

export function TrackContextMenu(props: {
    x: number;
    y: number;
    track: number;
    trackName?: string;
    isMidiTrack?: boolean;
    currentInstrument?: TrackInstrumentKind;
    currentVoicePresetIdx?: number;
    currentVaPresetIdx?: number;
    presets?: Array<{ name: string; duration?: number }>;
    vaPresets?: Array<{ name: string; params?: Record<string, number> }>;
    onAddTrack?: () => void;
    onDeleteTrack?: (track: number) => void;
    onSetInstrument?: (track: number, kind: TrackInstrumentKind, presetIdx?: number) => void;
    onClose: () => void;
}) {
    const {
        x,
        y,
        track,
        trackName,
        isMidiTrack = false,
        currentInstrument = 'none',
        currentVoicePresetIdx = -1,
        currentVaPresetIdx = -1,
        presets = [],
        vaPresets = [],
        onAddTrack,
        onDeleteTrack,
        onSetInstrument,
        onClose,
    } = props;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'transparent',
            }}
            onClick={onClose}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: Math.min(x, window.innerWidth - 240),
                    top: Math.min(y, window.innerHeight - 300),
                    background: '#181c24',
                    border: '1px solid #3d4a5d',
                    borderRadius: 8,
                    padding: 6,
                    boxShadow:
                        '0 8px 24px rgba(0,0,0,0.8), 0 0 1px rgba(255,255,255,0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    minWidth: 210,
                    zIndex: 10000,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    style={{
                        padding: '4px 8px',
                        fontSize: 10,
                        fontWeight: 900,
                        color: '#70a1ff',
                        letterSpacing: '0.5px',
                        borderBottom: '1px solid #283344',
                        marginBottom: 2,
                    }}
                >
                    {trackName || `TRACK ${track + 1}`}
                </div>

                {/* 🎹 インストゥルメント（MIDIトラックのみ表示） */}
                {isMidiTrack && (
                    <>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 8px',
                                fontSize: 9,
                                fontWeight: 900,
                                color: '#8b98a9',
                                letterSpacing: '0.8px',
                            }}
                        >
                            <IconPiano size={11} color="#f0b429" />
                            <span>インストゥルメント</span>
                        </div>
                        {instrumentOptions.map((opt) => {
                            const selected = currentInstrument === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => {
                                        const defaultIdx = opt.value === 'voice'
                                            ? (currentVoicePresetIdx >= 0 ? currentVoicePresetIdx : 0)
                                            : opt.value === 'va'
                                                ? (currentVaPresetIdx >= 0 ? currentVaPresetIdx : 0)
                                                : -1;
                                        onSetInstrument?.(track, opt.value, defaultIdx);
                                        if ((opt.value === 'voice' && presets.length > 0) || (opt.value === 'va' && vaPresets.length > 0)) {
                                            // プリセット一覧がある場合は展開したまま維持
                                        } else {
                                            onClose();
                                        }
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 8,
                                        background: selected
                                            ? 'rgba(112,161,255,0.16)'
                                            : '#1c222e',
                                        color: selected ? '#a7c4ff' : '#c6cedb',
                                        border: selected
                                            ? '1px solid rgba(112,161,255,0.45)'
                                            : '1px solid transparent',
                                        borderRadius: 5,
                                        padding: '5px 10px',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                    }}
                                >
                                    <span>{opt.label}</span>
                                    <span
                                        style={{
                                            fontSize: 9,
                                            color: selected
                                                ? '#70a1ff'
                                                : '#5d6b7e',
                                            fontWeight: 600,
                                        }}
                                    >
                                        {opt.description}
                                    </span>
                                </button>
                            );
                        })}

                        {/* 🎛️ VAシンセ選択時の個別プリセット選択リスト */}
                        {currentInstrument === 'va' && vaPresets.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, paddingLeft: 6, borderLeft: '2px solid rgba(220,226,138,0.5)' }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: '#dce28a', padding: '2px 4px' }}>
                                    割り当てるVA音色プリセット:
                                </div>
                                <div style={{ maxHeight: 130, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {vaPresets.map((pr, pIdx) => {
                                        const isPrSelected = currentVaPresetIdx === pIdx;
                                        return (
                                            <button
                                                key={pIdx}
                                                onClick={() => {
                                                    onSetInstrument?.(track, 'va', pIdx);
                                                    onClose();
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    background: isPrSelected ? '#333822' : '#141820',
                                                    color: isPrSelected ? '#f1f3ba' : '#9aa7b8',
                                                    border: isPrSelected ? '1px solid #dce28a' : '1px solid #232a36',
                                                    borderRadius: 4,
                                                    padding: '3px 8px',
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                <span>{pIdx < 10 ? `0${pIdx}` : pIdx}: {pr.name}</span>
                                                {isPrSelected && <span style={{ fontSize: 8, color: '#dce28a' }}>適用中</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 🎙️ 声シンセ選択時の個別プリセット選択リスト */}
                        {currentInstrument === 'voice' && presets.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, paddingLeft: 6, borderLeft: '2px solid rgba(112,161,255,0.4)' }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: '#70a1ff', padding: '2px 4px' }}>
                                    割り当てる声プリセット:
                                </div>
                                <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {presets.map((pr, pIdx) => {
                                        const isPrSelected = currentVoicePresetIdx === pIdx;
                                        return (
                                            <button
                                                key={pIdx}
                                                onClick={() => {
                                                    onSetInstrument?.(track, 'voice', pIdx);
                                                    onClose();
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    background: isPrSelected ? '#2b3648' : '#141820',
                                                    color: isPrSelected ? '#00f2fe' : '#9aa7b8',
                                                    border: isPrSelected ? '1px solid #00f2fe' : '1px solid #232a36',
                                                    borderRadius: 4,
                                                    padding: '3px 8px',
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                <span>{pr.name}</span>
                                                {isPrSelected && <span style={{ fontSize: 8, color: '#00f2fe' }}>適用中</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* MIDI トラック以外は案内のみ */}
                {!isMidiTrack && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 8px',
                            color: '#5d6b7e',
                            fontSize: 10,
                            fontWeight: 700,
                        }}
                    >
                        <IconWaveform size={12} />
                        <span>オーディオトラック</span>
                    </div>
                )}

                <div style={{ height: 1, background: '#283344', margin: '2px 0' }} />

                {/* トラックを追加 */}
                <button
                    onClick={() => {
                        onAddTrack?.();
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: '#1c222e',
                        color: '#e0e6ed',
                        border: 'none',
                        borderRadius: 5,
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <IconPlus size={13} color="#2ed573" />
                    <span>トラックを追加</span>
                </button>

                <div style={{ height: 1, background: '#283344', margin: '2px 0' }} />

                {/* トラックを削除 */}
                <button
                    onClick={() => {
                        onDeleteTrack?.(track);
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: '#2b1d20',
                        color: '#ff6b81',
                        border: '1px solid rgba(255, 71, 87, 0.3)',
                        borderRadius: 5,
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <IconTrash size={13} color="#ff6b81" />
                    <span>トラックを削除</span>
                </button>
            </div>
        </div>
    );
}
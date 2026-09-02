import { normalizeMv3DSceneGraph, validateMv3DSceneGraph, type Mv3DSceneGraph } from './mv3dSceneGraph';

export const MV_3D_SCENE_TYPES = [
    'procedural_tunnel',
    'procedural_room',
    'liminal_space',
    'scene_graph',
] as const;

export type Mv3DSceneType = typeof MV_3D_SCENE_TYPES[number];

export interface Mv3DFogConfig {
    color: string;
    near: number;
    far: number;
    density: number;
}

export interface Mv3DCameraConfig {
    fov: number;
    path: 'forward_dolly' | 'orbit' | 'static';
    speed: number;
    parallax: number;
    cameraHeight: number;
    lookAhead: number;
    lookAt: 'forward' | 'tunnel_center' | 'room_center';
    shake: number;
}

export interface Mv3DLightingConfig {
    keyColor: string;
    keyIntensity: number;
    fillColor: string;
    fillIntensity: number;
    rimColor: string;
    rimIntensity: number;
    lightIntensityCap: number;
    shadows: boolean;
    bloomStrength: number;
}

export interface Mv3DAudioBinding {
    amount: number;
    smoothing: number;
    maxChangePerSecond: number;
}

export interface Mv3DAudioReactiveConfig {
    bass: Mv3DAudioBinding;
    beat: Mv3DAudioBinding;
    energy: Mv3DAudioBinding;
}

export interface Mv3DSceneConfig {
    sceneType: Mv3DSceneType;
    seed: number;
    palette: string[];
    density: number;
    fog: Mv3DFogConfig;
    environment: {
        type: 'dark' | 'space' | 'indoor';
        intensity: number;
    };
    geometry: {
        radius: number;
        length: number;
        segments: number;
        twist: number;
        ceilingHeight: number;
        wallDistance: number;
        floorWidth: number;
        floor: boolean;
        walls: boolean;
        ceiling: boolean;
        tunnelSurface: boolean;
        tunnelRings: boolean;
        tunnelStrips: boolean;
    };
    camera: Mv3DCameraConfig;
    lighting: Mv3DLightingConfig;
    audioReactive: Mv3DAudioReactiveConfig;
    lyricSafeZone: 'bottom' | 'center' | 'top';
    sceneGraph?: Mv3DSceneGraph;
}

export interface Mv3DValidationResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
    scene?: Mv3DSceneConfig;
}

const DEFAULT_SCENE: Mv3DSceneConfig = {
    sceneType: 'procedural_tunnel',
    seed: 42,
    palette: ['#07152f', '#6d28d9', '#38bdf8', '#f472b6'],
    density: 0.72,
    fog: { color: '#080b18', near: 8, far: 90, density: 0.035 },
    environment: { type: 'space', intensity: 0.3 },
    geometry: {
        radius: 8,
        length: 120,
        segments: 120,
        twist: 0.12,
        ceilingHeight: 8,
        wallDistance: 8,
        floorWidth: 16,
        floor: false,
        walls: false,
        ceiling: false,
        tunnelSurface: true,
        tunnelRings: true,
        tunnelStrips: true,
    },
    camera: { fov: 58, path: 'forward_dolly', speed: 1.2, parallax: 0.35, cameraHeight: 0, lookAhead: 14, lookAt: 'tunnel_center', shake: 0.08 },
    lighting: {
        keyColor: '#a855f7', keyIntensity: 2, fillColor: '#172554', fillIntensity: 0.65,
        rimColor: '#67e8f9', rimIntensity: 1.2, shadows: false, bloomStrength: 0.45,
        lightIntensityCap: 8,
    },
    audioReactive: {
        bass: { amount: 0.25, smoothing: 0.85, maxChangePerSecond: 1.6 },
        beat: { amount: 0.08, smoothing: 0.92, maxChangePerSecond: 2.4 },
        energy: { amount: 0.12, smoothing: 0.9, maxChangePerSecond: 0.8 },
    },
    lyricSafeZone: 'bottom',
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function boolIn(value: unknown, fallback: boolean): boolean {
    if (value && typeof value === 'object' && 'enabled' in value) {
        return boolIn((value as { enabled?: unknown }).enabled, fallback);
    }
    return typeof value === 'boolean' ? value : fallback;
}

function colorIn(value: unknown, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

function bindingIn(value: unknown, fallback: Mv3DAudioBinding): Mv3DAudioBinding {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
        amount: numberIn(raw.amount, fallback.amount, 0, 2),
        smoothing: numberIn(raw.smoothing, fallback.smoothing, 0, 0.99),
        maxChangePerSecond: numberIn(raw.maxChangePerSecond, fallback.maxChangePerSecond, 0.05, 20),
    };
}

export function normalizeMv3DScene(input: unknown): Mv3DSceneConfig {
    const raw = input && typeof input === 'object' ? input as Record<string, any> : {};
    const rawGeometry = raw.geometry && typeof raw.geometry === 'object' ? raw.geometry : {};
    const rawTunnel = rawGeometry.tunnel && typeof rawGeometry.tunnel === 'object' ? rawGeometry.tunnel : rawGeometry;
    const rawCamera = raw.camera && typeof raw.camera === 'object' ? raw.camera : {};
    const rawFog = raw.fog && typeof raw.fog === 'object' ? raw.fog : {};
    const rawEnvironment = raw.environment && typeof raw.environment === 'object' ? raw.environment : {};
    const rawLighting = raw.lighting && typeof raw.lighting === 'object' ? raw.lighting : {};
    const rawAudio = raw.audioReactive && typeof raw.audioReactive === 'object' ? raw.audioReactive : {};
    const legacyShellValues = [rawGeometry.floor, rawGeometry.walls, rawGeometry.ceiling];
    const hasExplicitLegacyShell = legacyShellValues.every((value) => (
        typeof value === 'boolean'
        || (value && typeof value === 'object' && typeof (value as { enabled?: unknown }).enabled === 'boolean')
    ));
    const legacyOpenTunnel = hasExplicitLegacyShell && legacyShellValues.every((value) => !boolIn(value, false));
    const hasExplicitTunnelRings = rawTunnel.rings !== undefined || rawGeometry.tunnelRings !== undefined;
    const hasExplicitTunnelStrips = rawTunnel.strips !== undefined || rawGeometry.tunnelStrips !== undefined;
    const sceneType = raw.sceneType === 'tunnel' ? 'procedural_tunnel'
        : raw.sceneType === 'room' ? 'procedural_room'
            : raw.sceneType === 'liminal' ? 'liminal_space'
                : MV_3D_SCENE_TYPES.includes(raw.sceneType) ? raw.sceneType : DEFAULT_SCENE.sceneType;
    const palette = Array.isArray(raw.palette)
        ? raw.palette.filter((c: unknown): c is string => typeof c === 'string' && HEX_COLOR.test(c)).slice(0, 6)
        : [];
    return {
        sceneType,
        seed: Math.floor(numberIn(raw.seed, DEFAULT_SCENE.seed, 0, 0x7fffffff)),
        palette: palette.length > 0 ? palette : [...DEFAULT_SCENE.palette],
        density: numberIn(raw.density, DEFAULT_SCENE.density, 0, 1),
        fog: {
            color: colorIn(rawFog.color, DEFAULT_SCENE.fog.color),
            near: numberIn(rawFog.near, DEFAULT_SCENE.fog.near, 0.1, 200),
            far: numberIn(rawFog.far, DEFAULT_SCENE.fog.far, 1, 500),
            density: numberIn(rawFog.density, DEFAULT_SCENE.fog.density, 0, 0.2),
        },
        environment: {
            type: rawEnvironment.type === 'space' || rawEnvironment.type === 'indoor' ? rawEnvironment.type : DEFAULT_SCENE.environment.type,
            intensity: numberIn(rawEnvironment.intensity, DEFAULT_SCENE.environment.intensity, 0, 2),
        },
        geometry: {
            radius: numberIn(rawTunnel.radius, DEFAULT_SCENE.geometry.radius, 2, 24),
            length: numberIn(rawTunnel.length, DEFAULT_SCENE.geometry.length, 20, 240),
            segments: Math.round(numberIn(rawTunnel.segments, DEFAULT_SCENE.geometry.segments, 8, 240)),
            twist: numberIn(rawTunnel.twist, DEFAULT_SCENE.geometry.twist, -0.8, 0.8),
            ceilingHeight: numberIn(rawGeometry.ceilingHeight ?? rawTunnel.radius, DEFAULT_SCENE.geometry.ceilingHeight, 2, 40),
            wallDistance: numberIn(rawGeometry.wallDistance ?? rawTunnel.radius, DEFAULT_SCENE.geometry.wallDistance, 2, 40),
            floorWidth: numberIn(rawGeometry.floorWidth ?? Number(rawTunnel.radius) * 2, DEFAULT_SCENE.geometry.floorWidth, 2, 80),
            floor: boolIn(rawGeometry.floor?.enabled ?? rawGeometry.floor, DEFAULT_SCENE.geometry.floor),
            walls: boolIn(rawGeometry.walls?.enabled ?? rawGeometry.walls, DEFAULT_SCENE.geometry.walls),
            ceiling: boolIn(rawGeometry.ceiling?.enabled ?? rawGeometry.ceiling, DEFAULT_SCENE.geometry.ceiling),
            tunnelSurface: boolIn(rawTunnel.surface ?? rawGeometry.tunnelSurface, DEFAULT_SCENE.geometry.tunnelSurface),
            tunnelRings: boolIn(rawTunnel.rings ?? rawGeometry.tunnelRings, legacyOpenTunnel && !hasExplicitTunnelRings ? false : DEFAULT_SCENE.geometry.tunnelRings),
            tunnelStrips: boolIn(rawTunnel.strips ?? rawGeometry.tunnelStrips, legacyOpenTunnel && !hasExplicitTunnelStrips ? false : DEFAULT_SCENE.geometry.tunnelStrips),
        },
        camera: {
            fov: numberIn(rawCamera.fov, DEFAULT_SCENE.camera.fov, 35, 90),
            path: rawCamera.path === 'orbit' || rawCamera.path === 'static' ? rawCamera.path : DEFAULT_SCENE.camera.path,
            speed: numberIn(rawCamera.speed, DEFAULT_SCENE.camera.speed, 0, 5),
            parallax: numberIn(rawCamera.parallax, DEFAULT_SCENE.camera.parallax, 0, 1),
            cameraHeight: numberIn(rawCamera.cameraHeight, DEFAULT_SCENE.camera.cameraHeight, -20, 20),
            lookAhead: numberIn(rawCamera.lookAhead, DEFAULT_SCENE.camera.lookAhead, 2, 80),
            lookAt: rawCamera.lookAt === 'forward' || rawCamera.lookAt === 'room_center' ? rawCamera.lookAt : DEFAULT_SCENE.camera.lookAt,
            shake: numberIn(rawCamera.shake, DEFAULT_SCENE.camera.shake, 0, 0.5),
        },
        lighting: {
            keyColor: colorIn(rawLighting.keyColor ?? rawLighting.key?.color, DEFAULT_SCENE.lighting.keyColor),
            keyIntensity: numberIn(rawLighting.keyIntensity ?? rawLighting.key?.intensity, DEFAULT_SCENE.lighting.keyIntensity, 0, 8),
            fillColor: colorIn(rawLighting.fillColor ?? rawLighting.fill?.color, DEFAULT_SCENE.lighting.fillColor),
            fillIntensity: numberIn(rawLighting.fillIntensity ?? rawLighting.fill?.intensity, DEFAULT_SCENE.lighting.fillIntensity, 0, 5),
            rimColor: colorIn(rawLighting.rimColor ?? rawLighting.rim?.color, DEFAULT_SCENE.lighting.rimColor),
            rimIntensity: numberIn(rawLighting.rimIntensity ?? rawLighting.rim?.intensity, DEFAULT_SCENE.lighting.rimIntensity, 0, 8),
            lightIntensityCap: numberIn(rawLighting.lightIntensityCap, DEFAULT_SCENE.lighting.lightIntensityCap, 0.5, 20),
            shadows: boolIn(rawLighting.shadows?.enabled ?? rawLighting.shadows, DEFAULT_SCENE.lighting.shadows),
            bloomStrength: numberIn(rawLighting.bloomStrength ?? rawLighting.bloom?.strength, DEFAULT_SCENE.lighting.bloomStrength, 0, 1),
        },
        audioReactive: {
            bass: bindingIn(rawAudio.bass, DEFAULT_SCENE.audioReactive.bass),
            beat: bindingIn(rawAudio.beat, DEFAULT_SCENE.audioReactive.beat),
            energy: bindingIn(rawAudio.energy, DEFAULT_SCENE.audioReactive.energy),
        },
        lyricSafeZone: raw.lyricSafeZone === 'center' || raw.lyricSafeZone === 'top' ? raw.lyricSafeZone : DEFAULT_SCENE.lyricSafeZone,
        sceneGraph: raw.sceneGraph ? normalizeMv3DSceneGraph(raw.sceneGraph) : undefined,
    };
}

export interface Mv3DDiagnostics {
    timeSec: number;
    cameraPosition: { x: number; y: number; z: number };
    lookAt: { x: number; y: number; z: number };
    ceilingDistance: number;
    floorDistance: number;
    wallDistance: number;
    lyricSafeZone: string;
    lyricSafeZoneIntrusion: boolean;
    warnings: string[];
}

export function diagnoseMv3DScene(input: unknown, timeSec = 0): Mv3DDiagnostics {
    const scene = normalizeMv3DScene(input);
    const travel = scene.camera.path === 'static' ? 0 : (Math.max(0, timeSec) * scene.camera.speed * 4) % Math.max(20, scene.geometry.length);
    const orbitX = scene.camera.path === 'orbit' ? Math.sin(timeSec * 0.2) * scene.geometry.radius * 0.28 : 0;
    const orbitY = scene.camera.path === 'orbit' ? Math.cos(timeSec * 0.17) * scene.geometry.radius * 0.12 : 0;
    const x = orbitX + Math.sin(timeSec * 0.23) * scene.camera.parallax * 0.65;
    const y = scene.camera.cameraHeight + orbitY + Math.cos(timeSec * 0.19) * scene.camera.parallax * 0.45;
    const z = 2.8 - travel;
    const lookZ = scene.camera.lookAt === 'room_center' ? -scene.geometry.length * 0.22 : z - scene.camera.lookAhead;
    const ceilingDistance = scene.geometry.ceilingHeight - y;
    const floorDistance = scene.geometry.ceilingHeight + y;
    const wallDistance = Math.max(0, scene.geometry.wallDistance - Math.abs(x));
    const safeBand = scene.lyricSafeZone === 'bottom' ? floorDistance : scene.lyricSafeZone === 'top' ? ceilingDistance : Math.min(floorDistance, ceilingDistance);
    const warnings: string[] = [];
    if (ceilingDistance < 1.5) warnings.push(`天井がカメラから ${ceilingDistance.toFixed(1)}m で近すぎます。ceilingHeight または cameraHeight を調整してください。`);
    if (floorDistance < 1.5) warnings.push(`床がカメラから ${floorDistance.toFixed(1)}m で近すぎます。cameraHeight を調整してください。`);
    if (wallDistance < 1.5) warnings.push(`壁がカメラから ${wallDistance.toFixed(1)}m で近すぎます。wallDistance を調整してください。`);
    if (safeBand < 1.5) warnings.push('指定した歌詞セーフゾーンへ近接ジオメトリが侵入しています。');
    return {
        timeSec: Math.max(0, timeSec),
        cameraPosition: { x, y, z },
        lookAt: { x: x * 0.2, y: y * 0.2, z: lookZ },
        ceilingDistance,
        floorDistance,
        wallDistance,
        lyricSafeZone: scene.lyricSafeZone,
        lyricSafeZoneIntrusion: safeBand < 1.5,
        warnings,
    };
}

export function validateMv3DScene(input: unknown): Mv3DValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const raw = input && typeof input === 'object' ? input as Record<string, any> : {};
    const acceptedTypes = [...MV_3D_SCENE_TYPES, 'tunnel', 'room', 'liminal'];
    if (!acceptedTypes.includes(raw.sceneType)) {
        errors.push(`sceneType は ${acceptedTypes.join(' / ')} のいずれかを指定してください。`);
    }
    if (Array.isArray(raw.palette) && raw.palette.some((c: unknown) => typeof c !== 'string' || !HEX_COLOR.test(c))) {
        errors.push('palette には #RRGGBB 形式の色だけを指定してください。');
    }
    if (Array.isArray(raw.palette) && raw.palette.length > 6) {
        errors.push('palette は6色以内で指定してください。');
    }
    const normalized = normalizeMv3DScene(input);
    if (raw.sceneGraph) {
        const graphResult = validateMv3DSceneGraph(raw.sceneGraph);
        errors.push(...graphResult.errors);
        warnings.push(...graphResult.warnings);
    }
    if (normalized.geometry.segments > 160 || normalized.density > 0.9) {
        warnings.push('ジオメトリ密度が高いため、低性能端末ではフレームレートが下がる可能性があります。');
    }
    if (normalized.lighting.shadows) warnings.push('影を有効にすると描画負荷が上がります。');
    if (normalized.lighting.bloomStrength > 0.7) warnings.push('発光強度が高いため、歌詞の視認性を確認してください。');
    if (normalized.fog.far <= normalized.fog.near) errors.push('fog.far は fog.near より大きくしてください。');
    return { ok: errors.length === 0, errors, warnings, scene: errors.length === 0 ? normalized : undefined };
}

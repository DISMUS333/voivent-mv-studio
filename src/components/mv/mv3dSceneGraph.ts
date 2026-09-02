const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export type Mv3DVector3 = [number, number, number];
export type Mv3DGraphGeometryType = 'box' | 'sphere' | 'torus' | 'cylinder' | 'plane' | 'icosahedron' | 'text' | 'gltf';
export type Mv3DGraphLightType = 'ambient' | 'point' | 'directional' | 'spot';

export interface Mv3DGraphMaterial {
    type: 'standard' | 'physical' | 'emissive' | 'voxel' | 'toon' | 'unlit' | 'glass' | 'water';
    color: string;
    metalness: number;
    roughness: number;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
    transparent: boolean;
    side: 'front' | 'back' | 'double';
}

export interface Mv3DGraphGeometry {
    type: Mv3DGraphGeometryType;
    size: Mv3DVector3;
    radius: number;
    height: number;
    tube: number;
    radialSegments: number;
    tubularSegments: number;
    detail: number;
    bevel: number;
    text?: string;
    url?: string;
    fontUrl?: string;
    fontData?: Record<string, unknown>;
    bevelSize?: number;
    depth?: number;
}

export interface Mv3DGraphNode {
    id: string;
    parent?: string;
    geometry: Mv3DGraphGeometry;
    material: Mv3DGraphMaterial;
    transform: {
        position: Mv3DVector3;
        rotation: Mv3DVector3;
        scale: Mv3DVector3;
    };
    repeat?: {
        count: number;
        axis: 'x' | 'y' | 'z';
        spacing: number;
    };
}

export interface Mv3DGraphGroup {
    id: string;
    parent?: string;
    transform: {
        position: Mv3DVector3;
        rotation: Mv3DVector3;
        scale: Mv3DVector3;
    };
}

export interface Mv3DVoxelWorld {
    seed: number;
    size: [number, number];
    maxHeight: number;
    waterLevel: number;
    mountainDensity: number;
    caveDensity: number;
    water: boolean;
    trees: number;
    buildings: number;
    blockSize: number;
    streaming: boolean;
    chunkSize: number;
    viewDistance: number;
}

export interface Mv3DCameraPath {
    points: Mv3DVector3[];
    lookAt?: Mv3DVector3[];
    loop: boolean;
}

export interface Mv3DGraphLight {
    id?: string;
    type: Mv3DGraphLightType;
    color: string;
    intensity: number;
    position: Mv3DVector3;
    distance: number;
    decay: number;
    angle: number;
    penumbra: number;
    castShadow: boolean;
}

export interface Mv3DSceneGraph {
    renderer: {
        toneMapping: 'aces' | 'none';
        exposure: number;
        bloom: {
            strength: number;
            threshold: number;
        };
    };
    environment: {
        background: string;
        fog: {
            color: string;
            near: number;
            far: number;
            density: number;
        };
    };
    camera: {
        type: 'perspective';
        fov: number;
        position: Mv3DVector3;
        lookAt: Mv3DVector3;
        motion: {
            type: 'static' | 'dolly' | 'orbit';
            speed: number;
            parallax: number;
        };
        path?: Mv3DCameraPath;
    };
    lights: Mv3DGraphLight[];
    groups: Mv3DGraphGroup[];
    nodes: Mv3DGraphNode[];
    voxelWorld?: Mv3DVoxelWorld;
}

export interface Mv3DGraphRenderManifest {
    renderedNodes: string[];
    ignoredFields: string[];
    triangles: number;
    drawCalls: number;
}

export interface Mv3DSceneGraphValidationResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
    sceneGraph?: Mv3DSceneGraph;
    manifest: Mv3DGraphRenderManifest;
}

export type Mv3DSceneGraphOperation =
    | { op: 'addNode'; node: unknown }
    | { op: 'updateNode'; id: string; patch: unknown }
    | { op: 'removeNode'; id: string };

const DEFAULT_GRAPH: Mv3DSceneGraph = {
    renderer: { toneMapping: 'aces', exposure: 1.1, bloom: { strength: 0.35, threshold: 0.7 } },
    environment: {
        background: '#020617',
        fog: { color: '#09162d', near: 8, far: 140, density: 0.015 },
    },
    camera: {
        type: 'perspective',
        fov: 58,
        position: [0, 2, 18],
        lookAt: [0, 1, -20],
        motion: { type: 'dolly', speed: 0.18, parallax: 0.22 },
    },
    lights: [],
    groups: [],
    nodes: [],
};

function recordIn(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function boolIn(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function colorIn(value: unknown, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

function vectorIn(value: unknown, fallback: Mv3DVector3, min = -1000, max = 1000): Mv3DVector3 {
    const raw = Array.isArray(value) ? value : [];
    return [
        numberIn(raw[0], fallback[0], min, max),
        numberIn(raw[1], fallback[1], min, max),
        numberIn(raw[2], fallback[2], min, max),
    ];
}

function normalizeMaterial(input: unknown): Mv3DGraphMaterial {
    const raw = recordIn(input);
    const materialTypes: Mv3DGraphMaterial['type'][] = ['standard', 'physical', 'emissive', 'voxel', 'toon', 'unlit', 'glass', 'water'];
    const type = materialTypes.includes(raw.type) ? raw.type : 'standard';
    return {
        type,
        color: colorIn(raw.color, '#64748b'),
        metalness: numberIn(raw.metalness, 0.25, 0, 1),
        roughness: numberIn(raw.roughness, 0.62, 0.04, 1),
        emissive: colorIn(raw.emissive, colorIn(raw.color, '#000000')),
        emissiveIntensity: numberIn(raw.emissiveIntensity ?? raw.intensity, type === 'emissive' ? 1.5 : 0, 0, 8),
        opacity: numberIn(raw.opacity, 1, 0, 1),
        transparent: boolIn(raw.transparent, Number(raw.opacity) < 1),
        side: raw.side === 'back' || raw.side === 'double' ? raw.side : 'front',
    };
}

function normalizeGeometry(input: unknown): Mv3DGraphGeometry {
    const raw = recordIn(input);
    const type: Mv3DGraphGeometryType = ['box', 'sphere', 'torus', 'cylinder', 'plane', 'icosahedron', 'text', 'gltf'].includes(raw.type) ? raw.type : 'box';
    const size = vectorIn(raw.size, [1, 1, 1], 0.01, 200);
    return {
        type,
        size,
        radius: numberIn(raw.radius, 1, 0.01, 100),
        height: numberIn(raw.height, size[1], 0.01, 200),
        tube: numberIn(raw.tube, 0.08, 0.005, 20),
        radialSegments: Math.round(numberIn(raw.radialSegments, 32, 3, 128)),
        tubularSegments: Math.round(numberIn(raw.tubularSegments, 48, 3, 160)),
        detail: Math.round(numberIn(raw.detail, 1, 0, 5)),
        bevel: numberIn(raw.bevel, 0, 0, 2),
        text: typeof raw.text === 'string' ? raw.text.slice(0, 200) : undefined,
        url: typeof raw.url === 'string' ? raw.url.slice(0, 2000) : undefined,
        fontUrl: typeof raw.fontUrl === 'string' ? raw.fontUrl.slice(0, 2000) : undefined,
        fontData: raw.fontData && typeof raw.fontData === 'object' && !Array.isArray(raw.fontData) ? raw.fontData : undefined,
        bevelSize: numberIn(raw.bevelSize, 0.02, 0, 1),
        depth: numberIn(raw.depth, 0.12, 0.01, 4),
    };
}

function normalizeNode(input: unknown, fallbackId: string): Mv3DGraphNode {
    const raw = recordIn(input);
    const transform = recordIn(raw.transform);
    const repeat = raw.repeat && typeof raw.repeat === 'object' ? recordIn(raw.repeat) : null;
    return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : fallbackId,
        parent: typeof raw.parent === 'string' && raw.parent.trim() ? raw.parent.trim().slice(0, 80) : undefined,
        geometry: normalizeGeometry(raw.geometry),
        material: normalizeMaterial(raw.material),
        transform: {
            position: vectorIn(transform.position, [0, 0, 0]),
            rotation: vectorIn(transform.rotation, [0, 0, 0], -Math.PI * 8, Math.PI * 8),
            scale: vectorIn(transform.scale, [1, 1, 1], 0.001, 100),
        },
        repeat: repeat ? {
            count: Math.round(numberIn(repeat.count, 1, 1, 256)),
            axis: repeat.axis === 'x' || repeat.axis === 'y' ? repeat.axis : 'z',
            spacing: numberIn(repeat.spacing, 1, -200, 200),
        } : undefined,
    };
}

function normalizeGroup(input: unknown, fallbackId: string): Mv3DGraphGroup {
    const raw = recordIn(input);
    const transform = recordIn(raw.transform);
    return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : fallbackId,
        parent: typeof raw.parent === 'string' && raw.parent.trim() ? raw.parent.trim().slice(0, 80) : undefined,
        transform: {
            position: vectorIn(transform.position, [0, 0, 0]),
            rotation: vectorIn(transform.rotation, [0, 0, 0], -Math.PI * 8, Math.PI * 8),
            scale: vectorIn(transform.scale, [1, 1, 1], 0.001, 100),
        },
    };
}

function normalizeVoxelWorld(input: unknown): Mv3DVoxelWorld | undefined {
    const raw = recordIn(input);
    if (Object.keys(raw).length === 0) return undefined;
    const size = Array.isArray(raw.size) ? raw.size : [48, 48];
    return {
        seed: Math.round(numberIn(raw.seed, 42, 0, 0xffffffff)),
        size: [Math.round(numberIn(size[0], 48, 8, 128)), Math.round(numberIn(size[1], 48, 8, 128))],
        maxHeight: Math.round(numberIn(raw.maxHeight, 12, 1, 48)),
        waterLevel: Math.round(numberIn(raw.waterLevel, 3, 0, 48)),
        mountainDensity: numberIn(raw.mountainDensity, 0.62, 0, 1),
        caveDensity: numberIn(raw.caveDensity, 0.08, 0, 0.7),
        water: boolIn(raw.water, true),
        trees: numberIn(raw.trees, 0.12, 0, 1),
        buildings: numberIn(raw.buildings, 0.025, 0, 1),
        blockSize: numberIn(raw.blockSize, 1, 0.25, 4),
        streaming: boolIn(raw.streaming, false),
        chunkSize: Math.round(numberIn(raw.chunkSize, 16, 8, 32)),
        viewDistance: Math.round(numberIn(raw.viewDistance, 2, 1, 6)),
    };
}

function normalizeLight(input: unknown): Mv3DGraphLight {
    const raw = recordIn(input);
    return {
        id: typeof raw.id === 'string' ? raw.id.trim().slice(0, 80) : undefined,
        type: raw.type === 'point' || raw.type === 'directional' || raw.type === 'spot' ? raw.type : 'ambient',
        color: colorIn(raw.color, '#ffffff'),
        intensity: numberIn(raw.intensity, 1, 0, 20),
        position: vectorIn(raw.position, [0, 3, 0]),
        distance: numberIn(raw.distance, 0, 0, 500),
        decay: numberIn(raw.decay, 1, 0, 4),
        angle: numberIn(raw.angle, Math.PI / 5, 0.01, Math.PI / 2),
        penumbra: numberIn(raw.penumbra, 0.35, 0, 1),
        castShadow: boolIn(raw.castShadow, false),
    };
}

export function normalizeMv3DSceneGraph(input: unknown): Mv3DSceneGraph {
    const raw = recordIn(input);
    const renderer = recordIn(raw.renderer);
    const bloom = recordIn(renderer.bloom);
    const environment = recordIn(raw.environment);
    const fog = recordIn(environment.fog);
    const camera = recordIn(raw.camera);
    const motion = recordIn(camera.motion);
    const rawPath = recordIn(camera.path);
    const rawPathPoints = Array.isArray(rawPath.points) ? rawPath.points : [];
    const rawLookAtPoints = Array.isArray(rawPath.lookAt) ? rawPath.lookAt : [];
    const nodes = Array.isArray(raw.nodes) ? raw.nodes.map((node, index) => normalizeNode(node, `node_${index + 1}`)) : [];
    const groups = Array.isArray(raw.groups) ? raw.groups.map((group, index) => normalizeGroup(group, `group_${index + 1}`)) : [];
    const lights = Array.isArray(raw.lights) ? raw.lights.map(normalizeLight) : [];
    return {
        renderer: {
            toneMapping: renderer.toneMapping === 'none' ? 'none' : 'aces',
            exposure: numberIn(renderer.exposure, DEFAULT_GRAPH.renderer.exposure, 0.1, 4),
            bloom: {
                strength: numberIn(bloom.strength, DEFAULT_GRAPH.renderer.bloom.strength, 0, 2),
                threshold: numberIn(bloom.threshold, DEFAULT_GRAPH.renderer.bloom.threshold, 0, 2),
            },
        },
        environment: {
            background: colorIn(environment.background, DEFAULT_GRAPH.environment.background),
            fog: {
                color: colorIn(fog.color, DEFAULT_GRAPH.environment.fog.color),
                near: numberIn(fog.near, DEFAULT_GRAPH.environment.fog.near, 0.1, 500),
                far: numberIn(fog.far, DEFAULT_GRAPH.environment.fog.far, 1, 1000),
                density: numberIn(fog.density, DEFAULT_GRAPH.environment.fog.density, 0, 0.2),
            },
        },
        camera: {
            type: 'perspective',
            fov: numberIn(camera.fov, DEFAULT_GRAPH.camera.fov, 30, 110),
            position: vectorIn(camera.position, DEFAULT_GRAPH.camera.position),
            lookAt: vectorIn(camera.lookAt, DEFAULT_GRAPH.camera.lookAt),
            motion: {
                type: motion.type === 'static' || motion.type === 'orbit' ? motion.type : 'dolly',
                speed: numberIn(motion.speed, DEFAULT_GRAPH.camera.motion.speed, 0, 10),
                parallax: numberIn(motion.parallax, DEFAULT_GRAPH.camera.motion.parallax, 0, 2),
            },
            path: rawPathPoints.length >= 2 ? {
                points: rawPathPoints.map((point) => vectorIn(point, [0, 0, 0])),
                lookAt: rawLookAtPoints.length >= 2 ? rawLookAtPoints.map((point) => vectorIn(point, [0, 0, 0])) : undefined,
                loop: boolIn(rawPath.loop, false),
            } : undefined,
        },
        lights,
        groups,
        nodes,
        voxelWorld: normalizeVoxelWorld(raw.voxelWorld ?? raw.voxelTerrain),
    };
}

function triangleCount(geometry: Mv3DGraphGeometry): number {
    switch (geometry.type) {
        case 'sphere': return geometry.radialSegments * geometry.tubularSegments * 2;
        case 'torus': return geometry.radialSegments * geometry.tubularSegments * 2;
        case 'cylinder': return geometry.radialSegments * 4;
        case 'plane': return 2;
        case 'icosahedron': return 20 * (4 ** geometry.detail);
        case 'text': return 0;
        default: return 12;
    }
}

export function buildMv3DGraphManifest(sceneGraph: Mv3DSceneGraph): Mv3DGraphRenderManifest {
    const renderedNodes: string[] = [];
    const ignoredFields: string[] = [];
    let triangles = 0;
    let drawCalls = 0;
    for (const node of sceneGraph.nodes) {
        const repeatCount = node.repeat?.count ?? 1;
        if (node.geometry.type === 'text' && (!node.geometry.text || (!node.geometry.fontUrl && !node.geometry.fontData))) {
            ignoredFields.push(`nodes.${node.id}.geometry.type=text (font source missing)`);
            continue;
        }
        if (node.geometry.type === 'gltf' && !node.geometry.url) {
            ignoredFields.push(`nodes.${node.id}.geometry.type=gltf (url missing)`);
            continue;
        }
        renderedNodes.push(node.id);
        triangles += triangleCount(node.geometry) * repeatCount;
        drawCalls += repeatCount;
        if (node.geometry.bevel > 0) ignoredFields.push(`nodes.${node.id}.geometry.bevel`);
    }
    return { renderedNodes, ignoredFields, triangles, drawCalls };
}

export function validateMv3DSceneGraph(input: unknown): Mv3DSceneGraphValidationResult {
    const raw = recordIn(input);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (raw.camera && recordIn(raw.camera).type && recordIn(raw.camera).type !== 'perspective') {
        errors.push('camera.type は perspective のみ対応しています。');
    }
    const sceneGraph = normalizeMv3DSceneGraph(input);
    const ids = new Set<string>();
    const groupIds = new Set<string>();
    for (const group of sceneGraph.groups) {
        if (groupIds.has(group.id)) errors.push(`グループIDが重複しています: ${group.id}`);
        groupIds.add(group.id);
        if (group.parent === group.id) errors.push(`グループ自身を親にはできません: ${group.id}`);
    }
    for (const node of sceneGraph.nodes) {
        if (ids.has(node.id)) errors.push(`ノードIDが重複しています: ${node.id}`);
        ids.add(node.id);
        if (node.parent && node.parent === node.id) errors.push(`ノード自身を親にはできません: ${node.id}`);
        if (node.geometry.type === 'text' && (!node.geometry.text || (!node.geometry.fontUrl && !node.geometry.fontData))) {
            warnings.push(`ノード「${node.id}」の3DテキストにはtextとfontUrlまたはfontDataが必要です。`);
        }
        if (node.geometry.type === 'gltf' && !node.geometry.url) warnings.push(`ノード「${node.id}」のGLTF geometryにはurlが必要です。`);
        if (node.geometry.type === 'torus' && node.repeat?.axis === 'z' && Math.abs(Math.abs(node.transform.rotation[0]) - Math.PI / 2) < 0.12) {
            warnings.push(`ノード「${node.id}」はZ軸反復のトーラスをX方向へ90度回転しています。横帯に見える場合はrotation.xを0にしてください。`);
        }
    }
    for (const group of sceneGraph.groups) {
        if (group.parent && !groupIds.has(group.parent)) warnings.push(`親グループ「${group.parent}」が見つからないため、ルートに配置されます。`);
    }
    for (const node of sceneGraph.nodes) {
        if (node.parent && !groupIds.has(node.parent) && !ids.has(node.parent)) warnings.push(`親「${node.parent}」が見つからないため、ルートに配置されます。`);
    }
    if (sceneGraph.voxelWorld) {
        const [width, depth] = sceneGraph.voxelWorld.size;
        if (width * depth > 8192) warnings.push('ボクセル地形のセル数が多いため、InstancedMeshでも低性能端末では負荷が上がる可能性があります。');
        if (sceneGraph.voxelWorld.caveDensity > 0.45) warnings.push('洞窟密度が高いため、地形が分断される可能性があります。');
    }
    if (sceneGraph.nodes.length > 256) warnings.push('ノード数が多いため、低性能端末ではフレームレートが下がる可能性があります。');
    if (sceneGraph.renderer.bloom.strength > 0.8) warnings.push('Bloom強度が高いため、歌詞の視認性を確認してください。');
    if (sceneGraph.lights.length > 12) warnings.push('ライト数が多いため、描画負荷が上がる可能性があります。');
    if (sceneGraph.environment.fog.far <= sceneGraph.environment.fog.near) errors.push('environment.fog.far は near より大きくしてください。');
    const manifest = buildMv3DGraphManifest(sceneGraph);
    return { ok: errors.length === 0, errors, warnings, sceneGraph: errors.length === 0 ? sceneGraph : undefined, manifest };
}

function mergeRecord(base: unknown, patch: unknown): any {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const output = { ...recordIn(base) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
        output[key] = value && typeof value === 'object' && !Array.isArray(value)
            ? mergeRecord(output[key], value)
            : value;
    }
    return output;
}

export function applyMv3DSceneGraphOperations(input: unknown, operations: unknown): { sceneGraph?: Mv3DSceneGraph; errors: string[] } {
    const graph = normalizeMv3DSceneGraph(input);
    const errors: string[] = [];
    const next = { ...graph, nodes: [...graph.nodes] };
    if (!Array.isArray(operations)) return { errors: ['operations は配列で指定してください。'] };
    for (const operation of operations as Mv3DSceneGraphOperation[]) {
        const raw = recordIn(operation);
        if (raw.op === 'addNode') {
            const node = normalizeNode(raw.node, `node_${next.nodes.length + 1}`);
            if (next.nodes.some((candidate) => candidate.id === node.id)) errors.push(`追加するノードIDが重複しています: ${node.id}`);
            else next.nodes.push(node);
        } else if (raw.op === 'updateNode') {
            const id = typeof raw.id === 'string' ? raw.id : '';
            const index = next.nodes.findIndex((node) => node.id === id);
            if (index < 0) errors.push(`更新対象のノードが見つかりません: ${id}`);
            else next.nodes[index] = normalizeNode(mergeRecord(next.nodes[index], raw.patch), id);
        } else if (raw.op === 'removeNode') {
            const id = typeof raw.id === 'string' ? raw.id : '';
            const filtered = next.nodes.filter((node) => node.id !== id);
            if (filtered.length === next.nodes.length) errors.push(`削除対象のノードが見つかりません: ${id}`);
            next.nodes = filtered;
        } else {
            errors.push(`未対応のScene Graph操作です: ${String(raw.op ?? '')}`);
        }
    }
    return errors.length > 0 ? { errors } : { sceneGraph: next, errors: [] };
}

export function createMv3DSceneGraphFromPreset(preset: {
    palette: string[];
    fog: { color: string; near: number; far: number; density: number };
    environment: { intensity: number };
    geometry: {
        radius: number;
        length: number;
        segments: number;
        floorWidth: number;
        ceilingHeight: number;
        wallDistance: number;
        floor: boolean;
        walls: boolean;
        ceiling: boolean;
        tunnelSurface: boolean;
        tunnelRings: boolean;
        tunnelStrips: boolean;
    };
    camera: { fov: number; path: string; speed: number; parallax: number; cameraHeight: number; lookAhead: number };
    lighting: { keyColor: string; keyIntensity: number; fillColor: string; fillIntensity: number; rimColor: string; rimIntensity: number; bloomStrength: number };
}): Mv3DSceneGraph {
    const { geometry, palette, lighting } = preset;
    const color = (index: number, fallback: string) => palette[index % Math.max(1, palette.length)] ?? fallback;
    const nodes: unknown[] = [];
    const addBox = (id: string, size: Mv3DVector3, position: Mv3DVector3, materialColor: string) => nodes.push({
        id,
        geometry: { type: 'box', size },
        material: { type: 'standard', color: materialColor, metalness: 0.25, roughness: 0.7 },
        transform: { position },
    });

    if (geometry.tunnelSurface) nodes.push({
        id: 'tunnel-surface',
        geometry: { type: 'cylinder', radius: geometry.radius, height: geometry.length, radialSegments: 64 },
        material: { type: 'standard', color: color(0, '#07152f'), metalness: 0.18, roughness: 0.84, side: 'back' },
        transform: { position: [0, 0, -geometry.length / 2], rotation: [Math.PI / 2, 0, 0] },
    });
    if (geometry.tunnelRings) nodes.push({
        id: 'tunnel-rings',
        geometry: { type: 'torus', radius: geometry.radius, tube: Math.max(0.035, geometry.radius * 0.018), radialSegments: 8, tubularSegments: 40 },
        material: { type: 'emissive', color: color(1, '#38bdf8'), intensity: 1.2 },
        transform: { position: [0, 0, -geometry.length / Math.max(geometry.segments, 1)] },
        repeat: { count: geometry.segments, axis: 'z', spacing: -geometry.length / Math.max(geometry.segments, 1) },
    });
    if (geometry.tunnelStrips) {
        const stripSpacing = -geometry.length / Math.max(geometry.segments, 1);
        for (let index = 0; index < 4; index++) {
            const angle = index * Math.PI / 2;
            nodes.push({
                id: `tunnel-strip-${index + 1}`,
                geometry: { type: 'box', size: [0.08, 0.08, Math.abs(stripSpacing) * 0.72] },
                material: { type: 'emissive', color: color(2, '#67e8f9'), intensity: 1.5 },
                transform: { position: [Math.cos(angle) * geometry.radius * 0.98, Math.sin(angle) * geometry.radius * 0.98, stripSpacing * 1.05], rotation: [0, angle, -angle] },
                repeat: { count: geometry.segments, axis: 'z', spacing: stripSpacing },
            });
        }
    }
    if (geometry.floor) addBox('floor', [geometry.floorWidth, 0.12, geometry.length], [0, -geometry.ceilingHeight, -geometry.length / 2], color(0, '#07152f'));
    if (geometry.ceiling) addBox('ceiling', [geometry.floorWidth, 0.12, geometry.length], [0, geometry.ceilingHeight, -geometry.length / 2], color(0, '#07152f'));
    if (geometry.walls) {
        addBox('wall-left', [0.12, geometry.ceilingHeight * 2, geometry.length], [-geometry.wallDistance, 0, -geometry.length / 2], color(0, '#07152f'));
        addBox('wall-right', [0.12, geometry.ceilingHeight * 2, geometry.length], [geometry.wallDistance, 0, -geometry.length / 2], color(0, '#07152f'));
    }
    return normalizeMv3DSceneGraph({
        renderer: { toneMapping: 'aces', exposure: 1, bloom: { strength: lighting.bloomStrength, threshold: 0.55 } },
        environment: { background: preset.fog.color, fog: preset.fog },
        camera: {
            type: 'perspective',
            fov: preset.camera.fov,
            position: [0, preset.camera.cameraHeight, 2.8],
            lookAt: [0, 0, 2.8 - preset.camera.lookAhead],
            motion: { type: preset.camera.path === 'orbit' ? 'orbit' : preset.camera.path === 'static' ? 'static' : 'dolly', speed: preset.camera.speed, parallax: preset.camera.parallax },
        },
        lights: [
            { id: 'preset-fill', type: 'ambient', color: lighting.fillColor, intensity: lighting.fillIntensity * preset.environment.intensity + 0.08 },
            { id: 'preset-key', type: 'point', color: lighting.keyColor, intensity: lighting.keyIntensity, position: [-geometry.radius * 0.5, geometry.radius * 0.45, 3] },
            { id: 'preset-rim', type: 'point', color: lighting.rimColor, intensity: lighting.rimIntensity, position: [geometry.radius * 0.5, -geometry.radius * 0.25, -geometry.length * 0.45] },
        ],
        nodes,
    });
}

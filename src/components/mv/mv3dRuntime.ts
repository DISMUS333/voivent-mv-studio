import type { AudioSignals } from './types';
import type { Mv3DSceneConfig } from './mv3dScene';
import { buildMv3DGraphManifest, type Mv3DGraphRenderManifest } from './mv3dSceneGraph';
import { addMv3DSceneGraph } from './mv3dGraphRuntime';
import { createShaderBackendOptions } from './mvShaderBackend';

export interface Mv3DWorld {
    renderer: any;
    pipeline: any | null;
    scene: any;
    camera: any;
    root: any;
    lights: any[];
    animated: any[];
    voxelStreamers: any[];
    spec: Mv3DSceneConfig;
    renderManifest: Mv3DGraphRenderManifest;
    signalState: { bass: number; beat: number; energy: number };
}

function seeded(seed: number) {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function samplePath(points: [number, number, number][], distance: number, loop: boolean): [number, number, number] {
    if (points.length < 2) return points[0] ?? [0, 0, 0];
    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i][0] - points[i - 1][0];
        const dy = points[i][1] - points[i - 1][1];
        const dz = points[i][2] - points[i - 1][2];
        const length = Math.hypot(dx, dy, dz);
        lengths.push(length);
        total += length;
    }
    if (total <= 0) return points[0];
    const target = loop ? ((distance % total) + total) % total : Math.max(0, Math.min(total, distance));
    let traversed = 0;
    for (let i = 0; i < lengths.length; i++) {
        const segmentLength = lengths[i];
        if (target <= traversed + segmentLength || i === lengths.length - 1) {
            const p = segmentLength > 0 ? (target - traversed) / segmentLength : 0;
            return [
                points[i][0] + (points[i + 1][0] - points[i][0]) * p,
                points[i][1] + (points[i + 1][1] - points[i][1]) * p,
                points[i][2] + (points[i + 1][2] - points[i][2]) * p,
            ];
        }
        traversed += segmentLength;
    }
    return points[points.length - 1];
}

function material(THREE: any, value: string, emissive = 0, roughness = 0.62, metalness = 0.25) {
    const c = new THREE.Color(value);
    return new THREE.MeshStandardMaterial({
        color: c,
        roughness,
        metalness,
        emissive: c,
        emissiveIntensity: emissive,
    });
}

function addBox(THREE: any, root: any, size: [number, number, number], position: [number, number, number], mat: any) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...position);
    root.add(mesh);
    return mesh;
}

function addTunnel(THREE: any, world: Mv3DWorld) {
    const { spec, root } = world;
    const random = seeded(spec.seed);
    const { radius, length, segments, twist } = spec.geometry;
    const spacing = length / Math.max(segments, 1);
    const ringMat = material(THREE, spec.palette[1 % spec.palette.length], 0.72, 0.34, 0.72);
    const trimMat = material(THREE, spec.palette[2 % spec.palette.length], 1.2, 0.26, 0.8);
    if (spec.geometry.tunnelSurface) {
        const shell = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, length, 64, 1, true),
            new THREE.MeshStandardMaterial({
                color: new THREE.Color(spec.palette[0]),
                roughness: 0.84,
                metalness: 0.18,
                emissive: new THREE.Color(spec.palette[0]),
                emissiveIntensity: 0.08,
                side: THREE.BackSide,
            }),
        );
        shell.rotation.x = Math.PI / 2;
        shell.position.z = -length / 2;
        root.add(shell);
    }
    for (let i = 0; i < segments; i++) {
        const z = -i * spacing - spacing;
        if (spec.geometry.tunnelRings) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, Math.max(0.035, radius * 0.018), 8, 40), ringMat.clone());
            ring.position.set(Math.sin(i * 0.18) * radius * 0.12, Math.cos(i * 0.13) * radius * 0.1, z);
            ring.rotation.z = i * twist;
            ring.userData.baseZ = z;
            ring.userData.baseX = ring.position.x;
            ring.userData.baseY = ring.position.y;
            root.add(ring);
            world.animated.push(ring);
        }

        if (spec.geometry.tunnelStrips) {
            const stripCount = 2 + Math.floor(random() * 3);
            for (let j = 0; j < stripCount; j++) {
                const a = (j / stripCount) * Math.PI * 2 + (random() - 0.5) * 0.15;
                const strip = addBox(THREE, root, [0.08, 0.08, spacing * 0.72], [
                    Math.cos(a) * (radius * 0.98), Math.sin(a) * (radius * 0.98), z - spacing * 0.05,
                ], trimMat.clone());
                strip.rotation.z = -a;
                strip.rotation.y = a;
                strip.userData.baseZ = z - spacing * 0.05;
                strip.userData.baseX = strip.position.x;
                strip.userData.baseY = strip.position.y;
                world.animated.push(strip);
            }
        }
    }
    if (spec.geometry.floor) addBox(THREE, root, [spec.geometry.floorWidth, 0.12, length], [0, -spec.geometry.ceilingHeight, -length / 2], material(THREE, spec.palette[0], 0.1, 0.9, 0.2));
    if (spec.geometry.ceiling) addBox(THREE, root, [spec.geometry.floorWidth, 0.12, length], [0, spec.geometry.ceilingHeight, -length / 2], material(THREE, spec.palette[0], 0.1, 0.9, 0.2));
    if (spec.geometry.walls) {
        addBox(THREE, root, [0.12, spec.geometry.ceilingHeight * 2, length], [-spec.geometry.wallDistance, 0, -length / 2], material(THREE, spec.palette[0], 0.12, 0.82, 0.3));
        addBox(THREE, root, [0.12, spec.geometry.ceilingHeight * 2, length], [spec.geometry.wallDistance, 0, -length / 2], material(THREE, spec.palette[0], 0.12, 0.82, 0.3));
    }
}

function addRoom(THREE: any, world: Mv3DWorld, liminal: boolean) {
    const { spec, root } = world;
    const random = seeded(spec.seed);
    const width = spec.geometry.radius * (liminal ? 2.9 : 2.5);
    const height = spec.geometry.radius * (liminal ? 1.55 : 1.35);
    const depth = spec.geometry.length;
    const wallMat = material(THREE, spec.palette[0], 0.05, 0.88, 0.18);
    const trimMat = material(THREE, spec.palette[1 % spec.palette.length], 0.65, 0.5, 0.55);
    addBox(THREE, root, [width, 0.12, depth], [0, -height / 2, -depth / 2], wallMat);
    addBox(THREE, root, [width, 0.12, depth], [0, height / 2, -depth / 2], wallMat);
    addBox(THREE, root, [0.12, height, depth], [-width / 2, 0, -depth / 2], wallMat);
    addBox(THREE, root, [0.12, height, depth], [width / 2, 0, -depth / 2], wallMat);
    const count = Math.max(8, Math.round(spec.geometry.segments * (liminal ? 0.7 : 0.45)));
    for (let i = 0; i < count; i++) {
        const z = -2 - i * (depth / count);
        const panel = addBox(THREE, root, [width * 0.72, height * 0.018, 0.07], [0, height * 0.32, z], trimMat.clone());
        panel.userData.baseZ = z;
        panel.userData.baseX = 0;
        panel.userData.baseY = height * 0.32;
        world.animated.push(panel);
        if (liminal || random() > 0.35) {
            const side = random() > 0.5 ? -1 : 1;
            const column = addBox(THREE, root, [0.12, height * 0.9, 0.12], [side * width * 0.34, 0, z], trimMat.clone());
            column.userData.baseZ = z;
            column.userData.baseX = column.position.x;
            column.userData.baseY = 0;
            world.animated.push(column);
        }
    }
    const lightMat = material(THREE, spec.palette[2 % spec.palette.length], 2.2, 0.25, 0.3);
    const fixtureCount = Math.max(4, Math.round(count / 5));
    for (let i = 0; i < fixtureCount; i++) {
        const z = -4 - i * (depth / fixtureCount);
        const fixture = addBox(THREE, root, [width * 0.28, 0.055, 0.16], [0, height * 0.47, z], lightMat.clone());
        fixture.userData.baseZ = z;
        fixture.userData.baseX = 0;
        fixture.userData.baseY = height * 0.47;
        world.animated.push(fixture);
    }
}

function addStars(THREE: any, world: Mv3DWorld) {
    const random = seeded(world.spec.seed + 97);
    const count = Math.max(120, Math.round(220 * world.spec.density));
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = (random() - 0.5) * 120;
        positions[i * 3 + 1] = (random() - 0.5) * 70;
        positions[i * 3 + 2] = -random() * world.spec.geometry.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
        color: new THREE.Color(world.spec.palette[2 % world.spec.palette.length]),
        size: 0.08,
        transparent: true,
        opacity: 0.82,
    }));
    world.root.add(points);
    world.animated.push(points);
}

export async function createMv3DWorld(spec: Mv3DSceneConfig): Promise<Mv3DWorld> {
    const THREE = await import('three/webgpu');
    const renderer = new THREE.WebGPURenderer(createShaderBackendOptions());
    await renderer.init();
    const scene = new THREE.Scene();
    const graph = spec.sceneGraph;
    const graphFog = graph?.environment.fog;
    scene.background = new THREE.Color(graph?.environment.background ?? spec.fog.color);
    scene.fog = graphFog
        ? new THREE.Fog(graphFog.color, graphFog.near, graphFog.far)
        : new THREE.FogExp2(spec.fog.color, spec.fog.density);
    const camera = new THREE.PerspectiveCamera(graph?.camera.fov ?? spec.camera.fov, 1, 0.05, 500);
    if (graph) camera.position.set(...graph.camera.position);
    else camera.position.set(0, 0, 2.8);
    const root = new THREE.Group();
    scene.add(root);
    const world: Mv3DWorld = {
        renderer,
        pipeline: null,
        scene,
        camera,
        root,
        lights: [],
        animated: [],
        voxelStreamers: [],
        spec,
        renderManifest: graph ? buildMv3DGraphManifest(graph) : { renderedNodes: [], ignoredFields: [], triangles: 0, drawCalls: 0 },
        signalState: { bass: 0, beat: 0, energy: 0 },
    };
    if (graph?.renderer.toneMapping === 'aces') renderer.toneMapping = (THREE as any).ACESFilmicToneMapping;
    if (graph) renderer.toneMappingExposure = graph.renderer.exposure;
    if (graph) {
        world.renderManifest = await addMv3DSceneGraph(THREE, world, graph);
    }
    if (!graph) {
    const ambient = new THREE.AmbientLight(new THREE.Color(spec.lighting.fillColor), spec.lighting.fillIntensity * spec.environment.intensity + 0.08);
    scene.add(ambient);
    const key = new THREE.PointLight(new THREE.Color(spec.lighting.keyColor), spec.lighting.keyIntensity, spec.geometry.length * 0.65, 1.5);
    key.position.set(-spec.geometry.radius * 0.5, spec.geometry.radius * 0.45, 3);
    scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color(spec.lighting.rimColor), spec.lighting.rimIntensity, spec.geometry.length * 0.5, 1.2);
    rim.position.set(spec.geometry.radius * 0.5, -spec.geometry.radius * 0.25, -spec.geometry.length * 0.45);
    scene.add(rim);
    world.lights.push(ambient, key, rim);
        if (spec.sceneType === 'procedural_tunnel') addTunnel(THREE, world);
        else addRoom(THREE, world, spec.sceneType === 'liminal_space');
        if (spec.environment.type === 'space' || spec.sceneType === 'liminal_space') addStars(THREE, world);
    }
    try {
        const [{ bloom }, TSL] = await Promise.all([
            import('three/addons/tsl/display/BloomNode.js'),
            import('three/tsl'),
        ]);
        const scenePass = TSL.pass(scene, camera);
        const sceneColor = scenePass.getTextureNode('output');
        const renderPipeline = new (THREE as any).RenderPipeline(renderer);
        const bloomStrength = graph?.renderer.bloom.strength ?? spec.lighting.bloomStrength;
        const bloomThreshold = graph?.renderer.bloom.threshold ?? 0.55;
        renderPipeline.outputNode = sceneColor.add(bloom(sceneColor, bloomStrength, bloomThreshold, 0.2));
        world.pipeline = renderPipeline;
    } catch {
        // Bloom is optional; the lit 3D scene remains available when post-processing is unavailable.
    }
    return world;
}

function smoothSignal(current: number, target: number, amount: number, smoothing: number, maxChange: number, dt: number) {
    const blended = current + (target - current) * Math.max(0.01, 1 - smoothing);
    return current + Math.max(-maxChange * dt, Math.min(maxChange * dt, blended - current)) * Math.max(0.1, amount);
}

/** Scene Graphアニメーションをシーン開始時基準の時刻へ変換する。 */
export function resolveMv3DSceneTime(timeSec: number, sceneStartTime = 0): number {
    if (!Number.isFinite(timeSec)) return 0;
    return Math.max(0, timeSec - (Number.isFinite(sceneStartTime) ? sceneStartTime : 0));
}

export function updateMv3DWorld(world: Mv3DWorld, signals: AudioSignals, timeSec: number, width: number, height: number) {
    const spec = world.spec;
    const state = world.signalState;
    const dt = 1 / 60;
    state.bass = smoothSignal(state.bass, signals.low, spec.audioReactive.bass.amount, spec.audioReactive.bass.smoothing, spec.audioReactive.bass.maxChangePerSecond, dt);
    state.beat = smoothSignal(state.beat, signals.beat, spec.audioReactive.beat.amount, spec.audioReactive.beat.smoothing, spec.audioReactive.beat.maxChangePerSecond, dt);
    state.energy = smoothSignal(state.energy, (signals.low + signals.mid + signals.high) / 3, spec.audioReactive.energy.amount, spec.audioReactive.energy.smoothing, spec.audioReactive.energy.maxChangePerSecond, dt);
    world.camera.aspect = Math.max(0.1, width / Math.max(1, height));
    world.camera.updateProjectionMatrix();
    if (spec.sceneGraph) {
        const graphCamera = spec.sceneGraph.camera;
        if (graphCamera.path) {
            const distance = Math.max(0, timeSec) * Math.max(0.01, graphCamera.motion.speed);
            const position = samplePath(graphCamera.path.points, distance, graphCamera.path.loop);
            const target = graphCamera.path.lookAt
                ? samplePath(graphCamera.path.lookAt, distance, graphCamera.path.loop)
                : graphCamera.lookAt;
            world.camera.position.set(...position);
            world.camera.lookAt(...target);
            for (const streamer of world.voxelStreamers) streamer.update(world.camera.position);
            return;
        }
        const motion = graphCamera.motion;
        const travel = motion.type === 'dolly'
            ? (Math.max(0, timeSec) * motion.speed * 4) % Math.max(20, spec.geometry.length)
            : 0;
        const orbitX = motion.type === 'orbit' ? Math.sin(timeSec * 0.2) * motion.parallax * 4 : 0;
        const orbitY = motion.type === 'orbit' ? Math.cos(timeSec * 0.17) * motion.parallax * 2 : 0;
        const x = graphCamera.position[0] + orbitX;
        const y = graphCamera.position[1] + orbitY;
        const z = graphCamera.position[2] - travel;
        world.camera.position.set(x, y, z);
        world.camera.lookAt(
            graphCamera.lookAt[0] + orbitX * 0.2,
            graphCamera.lookAt[1] + orbitY * 0.2,
            graphCamera.lookAt[2] - travel,
        );
        for (const streamer of world.voxelStreamers) streamer.update(world.camera.position);
        return;
    }
    const travel = spec.camera.path === 'static'
        ? 0
        : (timeSec * spec.camera.speed * 4) % Math.max(20, spec.geometry.length);
    world.camera.position.z = 2.8 - travel;
    const orbitX = spec.camera.path === 'orbit' ? Math.sin(timeSec * 0.2) * spec.geometry.radius * 0.28 : 0;
    const orbitY = spec.camera.path === 'orbit' ? Math.cos(timeSec * 0.17) * spec.geometry.radius * 0.12 : 0;
    world.camera.position.x = orbitX + Math.sin(timeSec * 0.23) * spec.camera.parallax * 0.65 + Math.sin(timeSec * 5.5) * state.beat * spec.camera.shake;
    world.camera.position.y = spec.camera.cameraHeight + orbitY + Math.cos(timeSec * 0.19) * spec.camera.parallax * 0.45 + Math.cos(timeSec * 6.2) * state.beat * spec.camera.shake;
    const lookZ = spec.camera.lookAt === 'room_center' ? -spec.geometry.length * 0.22 : world.camera.position.z - spec.camera.lookAhead;
    world.camera.lookAt(world.camera.position.x * 0.2, world.camera.position.y * 0.2, lookZ);
    for (const object of world.animated) {
        if (object.userData.baseZ !== undefined) {
            let z = object.userData.baseZ + travel;
            const span = Math.max(20, spec.geometry.length);
            while (z > 5) z -= span;
            object.position.z = z;
            object.position.x = object.userData.baseX + Math.sin(timeSec * 0.7 + object.userData.baseZ * 0.03) * state.bass * 0.12;
            object.position.y = object.userData.baseY + Math.cos(timeSec * 0.6 + object.userData.baseZ * 0.02) * state.energy * 0.08;
        } else if (object.isPoints) {
            object.rotation.y = timeSec * 0.015;
            object.material.opacity = 0.55 + state.energy * 0.35;
        }
    }
    const ambient = world.lights[0];
    const key = world.lights[1];
    const rim = world.lights[2];
    if (ambient) ambient.intensity = spec.lighting.fillIntensity * spec.environment.intensity + 0.08 + state.energy * 0.18;
    if (key) key.intensity = Math.min(spec.lighting.lightIntensityCap, spec.lighting.keyIntensity * (1 + state.bass * 0.8 + state.beat * 0.25));
    if (rim) rim.intensity = Math.min(spec.lighting.lightIntensityCap, spec.lighting.rimIntensity * (1 + state.beat * 0.55));
    if (world.scene.fog) world.scene.fog.density = spec.fog.density * (1 + state.energy * 0.35);
}

export function renderMv3DWorld(world: Mv3DWorld) {
    if (world.pipeline) world.pipeline.render();
    else world.renderer.render(world.scene, world.camera);
}

export async function disposeMv3DWorld(world: Mv3DWorld) {
    for (const streamer of world.voxelStreamers) {
        try { streamer.dispose(); } catch { /* chunk cleanup is best effort */ }
    }
    try { world.pipeline?.dispose(); } catch { /* pipeline cleanup is best effort */ }
    try { await world.renderer.dispose(); } catch { /* renderer cleanup is best effort */ }
}

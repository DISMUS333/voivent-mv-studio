import type {
    Mv3DGraphLight,
    Mv3DGraphMaterial,
    Mv3DGraphNode,
    Mv3DSceneGraph,
    Mv3DGraphRenderManifest,
} from './mv3dSceneGraph';
import { addMv3DVoxelWorld } from './mv3dVoxelRuntime';

interface Mv3DGraphRuntimeHost {
    root: any;
    camera: any;
    lights: any[];
    animated: any[];
    voxelStreamers: any[];
}

function createMaterial(THREE: any, spec: Mv3DGraphMaterial) {
    const color = new THREE.Color(spec.color);
    const emissive = new THREE.Color(spec.emissive);
    const options = {
        color,
        metalness: spec.metalness,
        roughness: spec.roughness,
        emissive,
        emissiveIntensity: spec.emissiveIntensity,
        opacity: spec.opacity,
        transparent: spec.transparent,
        side: spec.side === 'back' ? THREE.BackSide : spec.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
    };
    if (spec.type === 'physical' || spec.type === 'glass' || spec.type === 'water') {
        return new THREE.MeshPhysicalMaterial({
            ...options,
            clearcoat: 0.18,
            clearcoatRoughness: 0.28,
            transmission: spec.type === 'glass' ? 0.92 : spec.type === 'water' ? 0.22 : 0,
            thickness: spec.type === 'glass' ? 0.6 : 0.1,
        });
    }
    if (spec.type === 'emissive' || spec.type === 'unlit') return new THREE.MeshBasicMaterial({
        color: color.clone().multiplyScalar(Math.max(1, spec.emissiveIntensity)),
        opacity: spec.opacity,
        transparent: spec.transparent,
        side: options.side,
    });
    if (spec.type === 'toon') return new THREE.MeshToonMaterial({ ...options, flatShading: true });
    if (spec.type === 'voxel') return new THREE.MeshStandardMaterial({ ...options, flatShading: true, roughness: Math.max(spec.roughness, 0.78) });
    return new THREE.MeshStandardMaterial(options);
}

function createGeometry(THREE: any, node: Mv3DGraphNode) {
    const spec = node.geometry;
    switch (spec.type) {
        case 'sphere':
            return new THREE.SphereGeometry(spec.radius, spec.radialSegments, spec.tubularSegments);
        case 'torus':
            return new THREE.TorusGeometry(spec.radius, spec.tube, spec.radialSegments, spec.tubularSegments);
        case 'cylinder':
            return new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, spec.radialSegments, 1, true);
        case 'plane':
            return new THREE.PlaneGeometry(spec.size[0], spec.size[1], spec.radialSegments, spec.tubularSegments);
        case 'icosahedron':
            return new THREE.IcosahedronGeometry(spec.radius, spec.detail);
        case 'box':
            return new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
        default:
            return null;
    }
}

async function loadExternalObject(THREE: any, node: Mv3DGraphNode): Promise<any | null> {
    if (node.geometry.type === 'gltf') {
        if (!node.geometry.url) return null;
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const loaded = await new GLTFLoader().loadAsync(node.geometry.url);
        return loaded.scene;
    }
    if (node.geometry.type === 'text') {
        if (!node.geometry.text || (!node.geometry.fontUrl && !node.geometry.fontData)) return null;
        const [{ FontLoader }, { TextGeometry }] = await Promise.all([
            import('three/addons/loaders/FontLoader.js'),
            import('three/addons/geometries/TextGeometry.js'),
        ]);
        const fontLoader = new FontLoader();
        const font = node.geometry.fontData
            ? fontLoader.parse(node.geometry.fontData as any)
            : await fontLoader.loadAsync(node.geometry.fontUrl!);
        const geometry = new TextGeometry(node.geometry.text, {
            font,
            size: node.geometry.size[0],
            depth: node.geometry.depth,
            bevelEnabled: node.geometry.bevel > 0,
            bevelSize: node.geometry.bevelSize,
            bevelThickness: node.geometry.bevelSize,
            bevelSegments: 2,
        });
        return new THREE.Mesh(geometry, createMaterial(THREE, node.material));
    }
    return null;
}

function applyTransform(object: any, node: Mv3DGraphNode, index: number) {
    const { position, rotation, scale } = node.transform;
    object.position.set(position[0], position[1], position[2]);
    object.rotation.set(rotation[0], rotation[1], rotation[2]);
    object.scale.set(scale[0], scale[1], scale[2]);
    if (node.repeat && index > 0) {
        const offset = index * node.repeat.spacing;
        if (node.repeat.axis === 'x') object.position.x += offset;
        else if (node.repeat.axis === 'y') object.position.y += offset;
        else object.position.z += offset;
    }
}

function addGraphLight(THREE: any, host: Mv3DGraphRuntimeHost, spec: Mv3DGraphLight) {
    let light: any;
    if (spec.type === 'point') {
        light = new THREE.PointLight(new THREE.Color(spec.color), spec.intensity, spec.distance, spec.decay);
    } else if (spec.type === 'directional') {
        light = new THREE.DirectionalLight(new THREE.Color(spec.color), spec.intensity);
    } else if (spec.type === 'spot') {
        light = new THREE.SpotLight(new THREE.Color(spec.color), spec.intensity, spec.distance, spec.angle, spec.penumbra, spec.decay);
    } else {
        light = new THREE.AmbientLight(new THREE.Color(spec.color), spec.intensity);
    }
    light.position.set(spec.position[0], spec.position[1], spec.position[2]);
    light.castShadow = spec.castShadow;
    host.root.parent?.add(light);
    host.lights.push(light);
}

export async function addMv3DSceneGraph(THREE: any, host: Mv3DGraphRuntimeHost, graph: Mv3DSceneGraph): Promise<Mv3DGraphRenderManifest> {
    const renderedNodes: string[] = [];
    const ignoredFields: string[] = [];
    let triangles = 0;
    let drawCalls = 0;

    const groups = new Map<string, any>();
    for (const group of graph.groups) {
        const object = new THREE.Group();
        object.name = group.id;
        object.position.set(...group.transform.position);
        object.rotation.set(...group.transform.rotation);
        object.scale.set(...group.transform.scale);
        groups.set(group.id, object);
    }
    for (const group of graph.groups) {
        const parent = group.parent ? groups.get(group.parent) : undefined;
        (parent ?? host.root).add(groups.get(group.id));
    }

    for (const light of graph.lights) addGraphLight(THREE, host, light);

    const nodeParents = new Map<string, any>();
    for (const node of graph.nodes) {
        const container = new THREE.Group();
        container.name = node.id;
        container.userData.sceneGraphNodeId = node.id;
        const parent = node.parent ? groups.get(node.parent) ?? nodeParents.get(node.parent) : undefined;
        (parent ?? host.root).add(container);
        nodeParents.set(node.id, container);
        const count = node.repeat?.count ?? 1;
        const external = node.geometry.type === 'gltf' || node.geometry.type === 'text'
            ? await loadExternalObject(THREE, node).catch(() => null)
            : null;
        const geometry = external ? null : createGeometry(THREE, node);
        if (!external && !geometry) {
            ignoredFields.push(`nodes.${node.id}.geometry`);
            continue;
        }
        const material = geometry ? createMaterial(THREE, node.material) : null;
        for (let index = 0; index < count; index++) {
            const object = external?.clone?.(true) ?? external ?? new THREE.Mesh(geometry, material);
            applyTransform(object, node, index);
            object.castShadow = true;
            object.receiveShadow = true;
            object.userData.sceneGraphNodeId = node.id;
            object.traverse?.((child: any) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.userData.sceneGraphNodeId = node.id;
                }
            });
            container.add(object);
            host.animated.push(object);
        }
        renderedNodes.push(node.id);
        drawCalls += count;
        const primitiveTriangles = node.geometry.type === 'gltf' || node.geometry.type === 'text' ? 0 : node.geometry.type === 'box'
            ? 12
            : node.geometry.type === 'plane'
                ? 2
                : node.geometry.type === 'icosahedron'
                    ? 20 * (4 ** node.geometry.detail)
                    : node.geometry.type === 'cylinder'
                        ? node.geometry.radialSegments * 4
                        : node.geometry.radialSegments * node.geometry.tubularSegments * 2;
        triangles += primitiveTriangles * count;
        if (node.geometry.bevel > 0) ignoredFields.push(`nodes.${node.id}.geometry.bevel`);
    }

    if (graph.voxelWorld) {
        const voxelManifest = addMv3DVoxelWorld(THREE, host, graph.voxelWorld);
        renderedNodes.push(...voxelManifest.renderedNodes);
        ignoredFields.push(...voxelManifest.ignoredFields);
        triangles += voxelManifest.triangles;
        drawCalls += voxelManifest.drawCalls;
    }

    return { renderedNodes, ignoredFields, triangles, drawCalls };
}

import type { Mv3DVoxelWorld, Mv3DGraphRenderManifest } from './mv3dSceneGraph';

interface VoxelRuntimeHost {
    root: any;
    camera: any;
    voxelStreamers: any[];
}

function hash(seed: number, x: number, z: number, layer = 0): number {
    let value = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(layer, 1442695041)) | 0;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

function smooth(value: number) {
    return value * value * (3 - 2 * value);
}

function valueNoise(seed: number, x: number, z: number, scale: number): number {
    const px = x / scale;
    const pz = z / scale;
    const x0 = Math.floor(px);
    const z0 = Math.floor(pz);
    const fx = smooth(px - x0);
    const fz = smooth(pz - z0);
    const a = hash(seed, x0, z0);
    const b = hash(seed, x0 + 1, z0);
    const c = hash(seed, x0, z0 + 1);
    const d = hash(seed, x0 + 1, z0 + 1);
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

function terrainHeight(world: Mv3DVoxelWorld, seed: number, x: number, z: number): number {
    const broad = valueNoise(seed, x, z, 18);
    const detail = valueNoise(seed + 17, x, z, 7);
    const ridge = 1 - Math.abs(valueNoise(seed + 41, x, z, 26) * 2 - 1);
    const mountain = Math.pow(Math.max(0, ridge), 2) * world.mountainDensity;
    return Math.max(1, Math.min(world.maxHeight, Math.floor(1 + broad * 3 + detail * 2 + mountain * world.maxHeight)));
}

function addInstances(THREE: any, root: any, geometry: any, material: any, positions: Array<[number, number, number]>, colors?: string[]) {
    if (positions.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    positions.forEach(([x, y, z], index) => {
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        if (colors && mesh.setColorAt) {
            color.set(colors[index % colors.length]);
            mesh.setColorAt(index, color);
        }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
}

function blockMaterial(THREE: any, color: string) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.92,
        metalness: 0.05,
        flatShading: true,
    });
}

function disposeChunk(chunk: any) {
    chunk.traverse?.((object: any) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
        else object.material?.dispose?.();
    });
    chunk.parent?.remove(chunk);
}

function createVoxelChunk(THREE: any, world: Mv3DVoxelWorld, chunkX: number, chunkZ: number) {
    const root = new THREE.Group();
    root.name = `voxel-chunk-${chunkX}-${chunkZ}`;
    const size = world.chunkSize;
    const b = world.blockSize;
    const terrain: Array<[number, number, number]> = [];
    const terrainColors: string[] = [];
    const trunks: Array<[number, number, number]> = [];
    const canopies: Array<[number, number, number]> = [];
    const buildings: Array<[number, number, number]> = [];
    const buildingRoofs: Array<[number, number, number]> = [];
    const palette = ['#263b31', '#3d5b3b', '#66734b', '#745c43'];
    for (let localZ = 0; localZ < size; localZ++) {
        for (let localX = 0; localX < size; localX++) {
            const x = chunkX * size + localX;
            const z = chunkZ * size + localZ;
            const h = terrainHeight(world, world.seed, x, z);
            const px = x * b;
            const pz = -z * b - b * 2;
            for (let y = 0; y < h; y++) {
                if (y > 1 && y < h - 1 && hash(world.seed + 83, x, z, y) < world.caveDensity) continue;
                terrain.push([px, (y + 0.5) * b, pz]);
                terrainColors.push(palette[Math.min(palette.length - 1, Math.floor((y / Math.max(1, h)) * palette.length))]);
            }
            if (hash(world.seed + 101, x, z) < world.trees && h >= world.waterLevel) {
                const treeHeight = 3 + Math.floor(hash(world.seed + 103, x, z) * 3);
                for (let y = 0; y < treeHeight; y++) trunks.push([px, (h + y + 0.5) * b, pz]);
                for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
                    canopies.push([px + ox * b, (h + treeHeight + 0.5) * b, pz + oz * b]);
                }
            }
            if (localX % 7 === 0 && localZ % 7 === 0 && hash(world.seed + 151, x, z) < world.buildings && h >= world.waterLevel) {
                buildings.push([px, (h + 1.5) * b, pz]);
                buildingRoofs.push([px, (h + 3.2) * b, pz]);
            }
        }
    }
    addInstances(THREE, root, new THREE.BoxGeometry(b, b, b), blockMaterial(THREE, '#3d5b3b'), terrain, terrainColors);
    addInstances(THREE, root, new THREE.CylinderGeometry(b * 0.18, b * 0.22, b, 6), blockMaterial(THREE, '#4b3325'), trunks);
    addInstances(THREE, root, new THREE.IcosahedronGeometry(b * 0.9, 0), new THREE.MeshStandardMaterial({ color: new THREE.Color('#3f6f4a'), roughness: 1, flatShading: true }), canopies);
    addInstances(THREE, root, new THREE.BoxGeometry(b * 2.4, b * 3, b * 2.4), blockMaterial(THREE, '#536070'), buildings);
    addInstances(THREE, root, new THREE.ConeGeometry(b * 1.9, b * 1.1, 4), blockMaterial(THREE, '#5b3f43'), buildingRoofs);
    if (world.water) {
        const water = new THREE.Mesh(new THREE.BoxGeometry(size * b, b * 0.12, size * b), new THREE.MeshPhysicalMaterial({
            color: new THREE.Color('#1e7890'), roughness: 0.08, metalness: 0.05, transmission: 0.22, transparent: true, opacity: 0.72,
        }));
        water.position.set((chunkX * size + size / 2 - 0.5) * b, world.waterLevel * b, -(chunkZ * size + size / 2 - 0.5) * b - b * 2);
        root.add(water);
    }
    return root;
}

export interface Mv3DVoxelStream {
    update(cameraPosition: { x: number; z: number }): void;
    dispose(): void;
}

function createVoxelStream(THREE: any, host: VoxelRuntimeHost, world: Mv3DVoxelWorld): Mv3DVoxelStream {
    const chunks = new Map<string, any>();
    const attach = (chunkX: number, chunkZ: number) => {
        const key = `${chunkX}:${chunkZ}`;
        if (chunks.has(key)) return;
        const chunk = createVoxelChunk(THREE, world, chunkX, chunkZ);
        chunks.set(key, chunk);
        host.root.add(chunk);
    };
    const update = (cameraPosition: { x: number; z: number }) => {
        const span = world.chunkSize * world.blockSize;
        const centerX = Math.floor(cameraPosition.x / span);
        const centerZ = Math.floor((-cameraPosition.z - world.blockSize * 2) / span);
        const needed = new Set<string>();
        for (let dz = -world.viewDistance; dz <= world.viewDistance; dz++) {
            for (let dx = -world.viewDistance; dx <= world.viewDistance; dx++) {
                if (dx * dx + dz * dz > world.viewDistance * world.viewDistance) continue;
                const chunkX = centerX + dx;
                const chunkZ = centerZ + dz;
                const key = `${chunkX}:${chunkZ}`;
                needed.add(key);
                attach(chunkX, chunkZ);
            }
        }
        for (const [key, chunk] of chunks) {
            if (!needed.has(key)) {
                disposeChunk(chunk);
                chunks.delete(key);
            }
        }
    };
    return {
        update,
        dispose: () => {
            for (const chunk of chunks.values()) disposeChunk(chunk);
            chunks.clear();
        },
    };
}

export function addMv3DVoxelWorld(
    THREE: any,
    host: VoxelRuntimeHost,
    world: Mv3DVoxelWorld,
): Mv3DGraphRenderManifest {
    if (world.streaming) {
        const stream = createVoxelStream(THREE, host, world);
        host.voxelStreamers.push(stream);
        stream.update(host.camera.position);
        const estimatedCells = world.chunkSize * world.chunkSize * Math.max(1, world.viewDistance * world.viewDistance * 3);
        return {
            renderedNodes: ['voxel-terrain-stream', 'voxel-trees-stream', 'voxel-buildings-stream', ...(world.water ? ['voxel-water-stream'] : [])],
            ignoredFields: [],
            triangles: estimatedCells * Math.min(world.maxHeight, 12) * 12,
            drawCalls: world.water ? 6 : 5,
        };
    }
    const [width, depth] = world.size;
    const halfWidth = (width - 1) / 2;
    const halfDepth = (depth - 1) / 2;
    const b = world.blockSize;
    const seed = world.seed;
    const terrain: Array<[number, number, number]> = [];
    const terrainColors: string[] = [];
    const grass: Array<[number, number, number]> = [];
    const trunks: Array<[number, number, number]> = [];
    const canopies: Array<[number, number, number]> = [];
    const buildings: Array<[number, number, number]> = [];
    const buildingRoofs: Array<[number, number, number]> = [];
    const palette = ['#263b31', '#3d5b3b', '#66734b', '#745c43'];

    for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
            const h = terrainHeight(world, seed, x, z);
            const px = (x - halfWidth) * b;
            const pz = -z * b - b * 2;
            for (let y = 0; y < h; y++) {
                const cave = y > 1 && y < h - 1 && hash(seed + 83, x, z, y) < world.caveDensity;
                if (!cave) {
                    terrain.push([px, (y + 0.5) * b, pz]);
                    terrainColors.push(palette[Math.min(palette.length - 1, Math.floor((y / Math.max(1, h)) * palette.length))]);
                }
            }
            if (hash(seed + 101, x, z) < world.trees && h >= world.waterLevel && x > 2 && z > 2) {
                const treeHeight = 3 + Math.floor(hash(seed + 103, x, z) * 3);
                for (let y = 0; y < treeHeight; y++) trunks.push([px, (h + y + 0.5) * b, pz]);
                for (let ox = -1; ox <= 1; ox++) {
                    for (let oz = -1; oz <= 1; oz++) {
                        canopies.push([px + ox * b, (h + treeHeight + 0.5) * b, pz + oz * b]);
                    }
                }
            }
            const buildingCell = x % 7 === 0 && z % 7 === 0 && hash(seed + 151, x, z) < world.buildings;
            if (buildingCell && h >= world.waterLevel) {
                buildings.push([px, (h + 1.5) * b, pz]);
                buildingRoofs.push([px, (h + 3.2) * b, pz]);
            }
        }
    }

    const baseGeometry = new THREE.BoxGeometry(b, b, b);
    addInstances(THREE, host.root, baseGeometry, blockMaterial(THREE, '#3d5b3b'), terrain, terrainColors);
    const trunkGeometry = new THREE.CylinderGeometry(b * 0.18, b * 0.22, b, 6);
    addInstances(THREE, host.root, trunkGeometry, blockMaterial(THREE, '#4b3325'), trunks);
    const canopyGeometry = new THREE.IcosahedronGeometry(b * 0.9, 0);
    addInstances(THREE, host.root, canopyGeometry, new THREE.MeshStandardMaterial({ color: new THREE.Color('#3f6f4a'), roughness: 1, flatShading: true }), canopies);
    const buildingGeometry = new THREE.BoxGeometry(b * 2.4, b * 3, b * 2.4);
    addInstances(THREE, host.root, buildingGeometry, blockMaterial(THREE, '#536070'), buildings);
    const roofGeometry = new THREE.ConeGeometry(b * 1.9, b * 1.1, 4);
    addInstances(THREE, host.root, roofGeometry, blockMaterial(THREE, '#5b3f43'), buildingRoofs);

    if (world.water) {
        const water = new THREE.Mesh(
            new THREE.BoxGeometry(width * b, b * 0.12, depth * b),
            new THREE.MeshPhysicalMaterial({
                color: new THREE.Color('#1e7890'),
                roughness: 0.08,
                metalness: 0.05,
                transmission: 0.22,
                transparent: true,
                opacity: 0.72,
            }),
        );
        water.position.set(0, world.waterLevel * b, -halfDepth * b - b * 2);
        host.root.add(water);
    }

    const terrainTriangles = terrain.length * 12;
    const treeTriangles = trunks.length * 12 + canopies.length * 20;
    const buildingTriangles = buildings.length * 12 + buildingRoofs.length * 8;
    return {
        renderedNodes: ['voxel-terrain', ...(trunks.length ? ['voxel-trees'] : []), ...(buildings.length ? ['voxel-buildings'] : []), ...(world.water ? ['voxel-water'] : [])],
        ignoredFields: [],
        triangles: terrainTriangles + treeTriangles + buildingTriangles + (world.water ? 12 : 0),
        drawCalls: 1 + (trunks.length ? 1 : 0) + (canopies.length ? 1 : 0) + (buildings.length ? 1 : 0) + (buildingRoofs.length ? 1 : 0) + (world.water ? 1 : 0),
    };
}

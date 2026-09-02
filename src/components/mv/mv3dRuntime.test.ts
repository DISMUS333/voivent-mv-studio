import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, SphereGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { normalizeMv3DSceneGraph } from './mv3dSceneGraph';
import { resolveMv3DSceneTime } from './mv3dRuntime';
import { inspectMv3DFramePixels } from './mv3dOffline';

describe('Scene Graph 3D render timing', () => {
    it('uses scene-local time so a late scene starts with its camera on the declared subject', () => {
        expect(resolveMv3DSceneTime(66, 66)).toBe(0);
        expect(resolveMv3DSceneTime(67.25, 66)).toBe(1.25);
    });

    it('keeps the minimal central emissive sphere visible from the declared camera', () => {
        const graph = normalizeMv3DSceneGraph({
            renderer: { toneMapping: 'none', exposure: 1 },
            camera: { type: 'perspective', fov: 58, position: [0, 0, 5], lookAt: [0, 0, 0], motion: { type: 'static' } },
            nodes: [{
                id: 'sphere',
                geometry: { type: 'sphere', radius: 1 },
                material: { type: 'emissive', color: '#ff00ff', intensity: 12 },
                transform: { position: [0, 0, 0] },
            }],
        });
        const node = graph.nodes[0];
        const camera = new PerspectiveCamera(graph.camera.fov, 1, 0.05, 500);
        camera.position.set(...graph.camera.position);
        camera.lookAt(...graph.camera.lookAt);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        const sphere = new Mesh(new SphereGeometry(node.geometry.radius), new MeshBasicMaterial({ color: node.material.color }));
        sphere.position.set(...node.transform.position);
        sphere.updateMatrixWorld();
        const centerNdc = sphere.getWorldPosition(new Vector3()).project(camera);
        expect(Math.abs(centerNdc.x)).toBeLessThan(0.001);
        expect(Math.abs(centerNdc.y)).toBeLessThan(0.001);
        expect(centerNdc.z).toBeGreaterThan(-1);
        expect(centerNdc.z).toBeLessThan(1);
        expect(node.material.emissiveIntensity).toBe(8);
    });

    it('normalizes voxel terrain, parent groups, specialized materials, and a camera path', () => {
        const graph = normalizeMv3DSceneGraph({
            camera: {
                position: [0, 3, 12],
                lookAt: [0, 1, 0],
                motion: { type: 'static' },
                path: {
                    points: [[0, 3, 12], [0, 5, 0], [8, 4, -18]],
                    lookAt: [[0, 1, 0], [0, 2, -12], [0, 3, -30]],
                },
            },
            groups: [{ id: 'village' }],
            nodes: [{
                id: 'house',
                parent: 'village',
                geometry: { type: 'box', size: [2, 2, 2] },
                material: { type: 'voxel', color: '#52604b' },
            }],
            voxelTerrain: {
                seed: 123,
                size: [32, 24],
                maxHeight: 10,
                water: true,
                trees: 0.2,
                buildings: 0.04,
            },
        });
        expect(graph.groups[0].id).toBe('village');
        expect(graph.nodes[0].parent).toBe('village');
        expect(graph.nodes[0].material.type).toBe('voxel');
        expect(graph.voxelWorld?.size).toEqual([32, 24]);
        expect(graph.camera.path?.points).toHaveLength(3);
        expect(graph.camera.path?.loop).toBe(false);
    });

    it('normalizes external model and 3D text geometry without silently dropping its source', () => {
        const graph = normalizeMv3DSceneGraph({
            nodes: [
                { id: 'castle', geometry: { type: 'gltf', url: '/assets/castle.glb' } },
                { id: 'title', geometry: { type: 'text', text: 'NIGHT CITY', fontUrl: '/fonts/display.typeface.json', size: [0.8, 0.8, 0.8] } },
            ],
            voxelWorld: { streaming: true, chunkSize: 24, viewDistance: 3 },
        });
        expect(graph.nodes[0].geometry.type).toBe('gltf');
        expect(graph.nodes[0].geometry.url).toBe('/assets/castle.glb');
        expect(graph.nodes[1].geometry.fontUrl).toContain('typeface.json');
        expect(graph.voxelWorld?.streaming).toBe(true);
        expect(graph.voxelWorld?.chunkSize).toBe(24);
        expect(graph.voxelWorld?.viewDistance).toBe(3);
    });

    it('reports a black frame separately from a frame containing a visible 3D object', () => {
        const black = inspectMv3DFramePixels(new Uint8ClampedArray(4 * 4 * 4));
        expect(black.actualFrameLuminance).toBe(0);
        expect(black.maxLuminance).toBe(0);
        expect(black.nonBlackPixelRatio).toBe(0);

        const visible = new Uint8ClampedArray(4 * 4 * 4);
        visible[0] = 255;
        visible[1] = 0;
        visible[2] = 255;
        visible[3] = 255;
        const stats = inspectMv3DFramePixels(visible);
        expect(stats.maxLuminance).toBeGreaterThan(0.004);
        expect(stats.nonBlackPixelRatio).toBeGreaterThan(0);
        expect(stats.actualFrameLuminance).toBeGreaterThan(0);
    });
});

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type DetailGeometrySink = (name: string, geometry: THREE.BufferGeometry) => boolean;

/**
 * Copies only the raw position/normal/index streams out of a glTF primitive.
 * The GLB is authored in the exact local frame of the procedural geometry it
 * replaces, so no transform is applied here.
 */
function copyGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const position = source.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position) return out;
  out.setAttribute('position', new THREE.BufferAttribute(position.array.slice(), 3));
  const normal = source.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (normal) out.setAttribute('normal', new THREE.BufferAttribute(normal.array.slice(), 3));
  const index = source.getIndex();
  if (index) out.setIndex(new THREE.BufferAttribute(index.array.slice(), 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Streams a Blender-authored kit into the instanced layers. The procedural
 * geometry stays in place as a fallback, so a missing or broken kit only costs
 * detail and never the scene.
 */
export function loadDetailKit(file: string, sink: DetailGeometrySink): void {
  if (typeof window === 'undefined') return;
  const url = `${import.meta.env.BASE_URL}models/${file}`;
  new GLTFLoader().load(
    url,
    (gltf) => {
      const loaded: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        loaded.push(mesh.geometry);
        const geometry = copyGeometry(mesh.geometry);
        if (!sink(mesh.name, geometry)) geometry.dispose();
      });
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      });
      for (const geometry of loaded) geometry.dispose();
    },
    undefined,
    () => {
      // Network failure: keep the procedural geometry.
    },
  );
}

export const THIRD_PARTY_PROP_SPECS = {
  bench: { file: 'station-bench.glb', axis: 'z', size: 1.8 },
  railing: { file: 'railing.glb', axis: 'y', size: 1.1 },
  vending: { file: 'vending-machine.glb', axis: 'y', size: 1.9 },
  trash: { file: 'trash-bin.glb', axis: 'y', size: 0.9 },
  billboard: { file: 'billboard.glb', axis: 'y', size: 2.65 },
  exit: { file: 'exit-sign.glb', axis: 'z', size: 1.6 },
} as const;

export type ThirdPartyPropName = keyof typeof THIRD_PARTY_PROP_SPECS;

/** A complete glTF model baked into a fixed set of instanced draw calls. */
export class ThirdPartyInstances {
  readonly group = new THREE.Group();

  private meshes: THREE.InstancedMesh[] = [];
  private materials = new Set<THREE.Material>();
  private count = 0;
  private capacity: number;
  private disposed = false;

  constructor(source: THREE.Object3D, name: string, capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.group.name = `third-party-${name}`;
    source.updateMatrixWorld(true);
    source.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = mesh.material;
      const instanced = new THREE.InstancedMesh(geometry, material, this.capacity);
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instanced.frustumCulled = false;
      instanced.count = 0;
      instanced.visible = false;
      this.meshes.push(instanced);
      this.group.add(instanced);
      if (Array.isArray(material)) material.forEach((item) => this.materials.add(item));
      else this.materials.add(material);
      mesh.geometry.dispose();
    });
  }

  reset(): void {
    this.count = 0;
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.visible = false;
    }
  }

  add(matrix: THREE.Matrix4): void {
    if (this.disposed || this.count >= this.capacity) return;
    for (const mesh of this.meshes) mesh.setMatrixAt(this.count, matrix);
    this.count++;
  }

  finish(): void {
    for (const mesh of this.meshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = this.count > 0;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const textures = new Set<THREE.Texture>();
    for (const material of this.materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.group.removeFromParent();
  }
}

/**
 * Loads a complete third-party glTF, retaining its original materials. The
 * normalized model is centred on X/Z and its lowest point sits at local Y=0.
 */
export async function loadThirdPartyProp(
  name: ThirdPartyPropName,
  capacity: number,
): Promise<ThirdPartyInstances | null> {
  if (typeof window === 'undefined') return null;
  const spec = THIRD_PARTY_PROP_SPECS[name];
  const url = `${import.meta.env.BASE_URL}models/third-party/${spec.file}`;
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const dimensions = bounds.getSize(new THREE.Vector3());
    const scale = spec.size / dimensions[spec.axis];
    if (bounds.isEmpty() || !Number.isFinite(scale) || scale <= 0) {
      disposeLoadedScene(gltf.scene);
      return null;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const normalized = new THREE.Group();
    normalized.add(gltf.scene);
    normalized.scale.setScalar(scale);
    normalized.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );
    normalized.updateMatrixWorld(true);
    return new ThirdPartyInstances(normalized, name, capacity);
  } catch {
    return null;
  }
}

function disposeLoadedScene(scene: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((item) => materials.add(item));
    else materials.add(mesh.material);
  });
  for (const material of materials) {
    (material as THREE.MeshStandardMaterial).map?.dispose();
    material.dispose();
  }
}

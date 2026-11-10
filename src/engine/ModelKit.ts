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

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import type { Scene, SceneObject } from "@/lib/scene";

function createGeometry(type: SceneObject["type"]): THREE.BufferGeometry {
  switch (type) {
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 48, 32);
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 48);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 48);
    case "torus":
      return new THREE.TorusGeometry(0.35, 0.15, 24, 64);
    case "plane":
      return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }
}

export function buildGroup(scene: Scene): THREE.Group {
  const group = new THREE.Group();
  group.name = scene.name;
  for (const object of scene.objects) {
    const material = new THREE.MeshStandardMaterial({
      color: object.color,
      metalness: object.metalness,
      roughness: object.roughness,
      side: object.type === "plane" ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(createGeometry(object.type), material);
    mesh.name = object.name;
    mesh.userData.id = object.id;
    mesh.position.set(...object.position);
    const [x, y, z] = object.rotation.map(THREE.MathUtils.degToRad);
    mesh.rotation.set(x, y, z);
    mesh.scale.set(...object.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function disposeGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}

export function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * STL untuk cetak 3D: Z menghadap atas, titik terendah di Z=0, 1 satuan = 1 mm.
 * Bidang (plane) dilewati karena tidak punya ketebalan.
 */
function toPrintableStl(scene: Scene): DataView<ArrayBuffer> {
  const solids = scene.objects.filter((object) => object.type !== "plane");
  if (solids.length === 0) throw new Error("Tidak ada objek bervolume untuk dicetak.");
  const group = buildGroup({ ...scene, objects: solids });
  try {
    group.rotation.x = Math.PI / 2; // Y-up (studio) menjadi Z-up (slicer).
    group.updateMatrixWorld(true);
    group.position.z = -new THREE.Box3().setFromObject(group, true).min.z;
    group.updateMatrixWorld(true);
    return new STLExporter().parse(group, { binary: true }) as DataView<ArrayBuffer>;
  } finally {
    disposeGroup(group);
  }
}

export type ExportFormat = "glb" | "stl" | "obj" | "json";

export async function exportScene(scene: Scene, format: ExportFormat) {
  const base = scene.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "scene";
  if (format === "json") {
    download(JSON.stringify(scene, null, 2), `${base}.json`, "application/json");
    return;
  }
  if (format === "stl") {
    download(toPrintableStl(scene), `${base}.stl`, "model/stl");
    return;
  }
  // Group baru: tanpa grid, lampu, atau sorotan seleksi dari viewer.
  const group = buildGroup(scene);
  group.updateMatrixWorld(true);
  try {
    if (format === "glb") {
      const result = await new GLTFExporter().parseAsync(group, { binary: true });
      download(result as ArrayBuffer, `${base}.glb`, "model/gltf-binary");
    } else {
      download(new OBJExporter().parse(group), `${base}.obj`, "text/plain");
    }
  } finally {
    disposeGroup(group);
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Scene } from "@/lib/scene";
import { buildGroup, disposeGroup } from "./three-utils";

type Props = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Dinaikkan setiap kali pengguna meminta tampilan dipusatkan. */
  fitRequest: number;
};

type World = {
  root: THREE.Scene;
  group: THREE.Group | null;
  ids: Set<string>;
  fit: () => void;
};

export default function Viewer({ scene, selectedId, onSelect, fitRequest }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const onSelectRef = useRef(onSelect);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // WebGL hanya bisa dideteksi setelah komponen terpasang di browser.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const root = new THREE.Scene();
    root.background = new THREE.Color("#15171c");
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    camera.position.set(6, 5, 8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);

    root.add(new THREE.HemisphereLight("#ffffff", "#404050", 1.4));
    const sun = new THREE.DirectionalLight("#ffffff", 2);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
    sun.shadow.bias = -0.0005;
    root.add(sun);
    const grid = new THREE.GridHelper(40, 40, "#4b5063", "#2b2f3a");
    grid.position.y = -0.001;
    root.add(grid);
    root.add(sun.target);

    // Sesuaikan kamera, grid, dan bayangan dengan ukuran desain (dari satuan kecil sampai ratusan mm).
    const fit = () => {
      const group = worldRef.current?.group;
      const box = new THREE.Box3();
      if (group) box.setFromObject(group);
      const empty = box.isEmpty();
      const center = empty ? new THREE.Vector3(0, 1, 0) : box.getCenter(new THREE.Vector3());
      const radius = Math.max(4, empty ? 0 : box.getSize(new THREE.Vector3()).length() / 2);
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const half = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
      const distance = (radius / Math.sin(half)) * 1.05;
      camera.position.copy(center).addScaledVector(new THREE.Vector3(6, 4, 8).normalize(), distance);
      camera.near = distance / 100;
      camera.far = distance * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
      grid.scale.setScalar(10 ** Math.max(0, Math.ceil(Math.log10(radius / 15))));
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(new THREE.Vector3(8, 14, 6).normalize(), radius * 4);
      const extent = radius * 1.5;
      Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, far: radius * 8 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.normalBias = radius * 0.002;
    };
    worldRef.current = { root, group: null, ids: new Set(), fit };

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    // Klik (bukan geser kamera) untuk memilih objek.
    let down = { x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => (down = { x: event.clientX, y: event.clientY });
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(worldRef.current?.group?.children ?? [], false)[0];
      onSelectRef.current(hit?.object.userData.id ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(root, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      if (worldRef.current?.group) disposeGroup(worldRef.current.group);
      worldRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const group = buildGroup(scene);
    for (const child of group.children as THREE.Mesh[]) {
      if (child.userData.id === selectedId) {
        (child.material as THREE.MeshStandardMaterial).emissive.set("#3b4fd8");
      }
    }
    if (world.group) {
      world.root.remove(world.group);
      disposeGroup(world.group);
    }
    world.root.add(group);
    world.group = group;

    // Pusatkan otomatis hanya bila isinya desain yang sama sekali baru (AI, impor, MCP, muat pertama).
    const replaced = scene.objects.length > 0 && !scene.objects.some((object) => world.ids.has(object.id));
    world.ids = new Set(scene.objects.map((object) => object.id));
    if (replaced) world.fit();
  }, [scene, selectedId]);

  useEffect(() => {
    if (fitRequest > 0) worldRef.current?.fit();
  }, [fitRequest]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {failed && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-zinc-300">
          Browser ini tidak mendukung WebGL, jadi pratinjau 3D tidak bisa ditampilkan.
        </p>
      )}
    </div>
  );
}

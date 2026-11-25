"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Scene, SceneObject } from "@/lib/scene";
import { draggedPosition } from "@/lib/scene-drag";
import { ViewButton, ViewControls } from "../components/view-controls";
import { buildGroup, disposeGroup } from "./three-utils";

type Props = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Hasil Promise `undefined` berarti perpindahan gagal disimpan. */
  onMove: (id: string, position: SceneObject["position"]) => Promise<unknown>;
  /** Dinaikkan setiap kali pengguna meminta tampilan dipusatkan. */
  fitRequest: number;
};

type World = {
  root: THREE.Scene;
  group: THREE.Group | null;
  ids: Set<string>;
  fit: () => void;
  cancelDrag: () => void;
};

type Drag = {
  pointerId: number;
  mesh: THREE.Object3D;
  object: SceneObject;
  /** Titik acuan geseran. Diperbarui saat arah seretan berganti. */
  anchor: { position: SceneObject["position"]; point: THREE.Vector3; clientY: number };
  position: SceneObject["position"];
  vertical: boolean;
  moved: boolean;
};

export default function Viewer(props: Props) {
  const { scene, selectedId, fitRequest } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const propsRef = useRef(props);
  const [failed, setFailed] = useState(false);
  // Mode naik-turun untuk layar sentuh; di keyboard cukup tahan Shift.
  const [lift, setLift] = useState(false);
  const liftRef = useRef(lift);
  // Dinaikkan untuk membangun ulang scene bila perpindahan gagal disimpan.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    propsRef.current = props;
    liftRef.current = lift;
  });

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

    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    const raycaster = new THREE.Raycaster();

    const pick = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(worldRef.current?.group?.children ?? [], false)[0];
    };

    /** Objek yang boleh langsung diseret. Bidang (biasanya lantai) harus dipilih dulu. */
    const draggable = (id: unknown) => {
      const object = propsRef.current.scene.objects.find((o) => o.id === id);
      return object && (object.type !== "plane" || object.id === propsRef.current.selectedId) ? object : undefined;
    };

    let drag: Drag | null = null;
    const endDrag = () => {
      if (drag && canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
      drag = null;
      controls.enabled = true;
    };

    // Klik (bukan geser kamera) untuk memilih objek.
    let down: { x: number; y: number } | null = null;
    // Fase capture pada pembungkus berjalan sebelum OrbitControls,
    // sehingga kamera bisa dimatikan saat yang diseret adalah objek.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== canvas) return;
      down = { x: event.clientX, y: event.clientY };
      if (event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey) return;
      const hit = pick(event);
      const object = hit && draggable(hit.object.userData.id);
      if (!hit || !object) return;
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        mesh: hit.object,
        object,
        anchor: { position: object.position, point: hit.point.clone(), clientY: event.clientY },
        position: object.position,
        vertical: event.shiftKey || liftRef.current,
        moved: false,
      };
      propsRef.current.onSelect(object.id);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) {
        const id = event.buttons ? undefined : pick(event)?.object.userData.id;
        canvas.style.cursor = event.buttons ? "grabbing" : draggable(id) ? "move" : "grab";
        return;
      }
      if (event.pointerId !== drag.pointerId || !down) return;
      if (!drag.moved && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4) return;
      pick(event);
      const { point } = drag.anchor;
      // Titik kursor pada bidang mendatar setinggi titik acuan.
      const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
      // Sudut pandang yang hampir sejajar bidang akan melempar objek sangat jauh.
      const flat = Math.abs(raycaster.ray.direction.y) < 0.05;
      const onLevel = flat ? null : raycaster.ray.intersectPlane(level, new THREE.Vector3());

      const vertical = event.shiftKey || liftRef.current;
      if (vertical !== drag.vertical) {
        // Ganti arah: mulai lagi dari posisi sekarang agar objek tidak melompat.
        if (!vertical && !onLevel) return;
        drag.anchor = { position: drag.position, point: vertical ? point : onLevel!, clientY: event.clientY };
        drag.vertical = vertical;
      }

      let delta: [number, number, number];
      if (vertical) {
        // Dihitung dari gerak layar supaya tetap bisa dari sudut pandang mana pun.
        const distance = camera.position.distanceTo(drag.anchor.point);
        const perPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / canvas.clientHeight;
        delta = [0, (drag.anchor.clientY - event.clientY) * perPixel, 0];
      } else {
        if (!onLevel) return;
        delta = [onLevel.x - drag.anchor.point.x, 0, onLevel.z - drag.anchor.point.z];
      }
      // Ketelitian mengikuti ukuran kisi: 0,1 untuk desain kecil, 1 atau 10 untuk desain besar.
      drag.position = draggedPosition(drag.anchor.position, delta, grid.scale.x / 10);
      drag.mesh.position.set(...drag.position);
      drag.moved = true;
    };

    const onPointerUp = (event: PointerEvent) => {
      const clicked = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4;
      down = null;
      if (drag) {
        if (event.pointerId !== drag.pointerId) return;
        const { object, position, moved } = drag;
        endDrag();
        if (!moved || position.every((value, axis) => value === object.position[axis])) return;
        propsRef.current.onMove(object.id, position).then((saved) => {
          if (saved === undefined) setRevision((n) => n + 1);
        });
      } else if (clicked && event.button === 0) {
        propsRef.current.onSelect(pick(event)?.object.userData.id ?? null);
      }
    };

    const onPointerCancel = () => {
      drag?.mesh.position.set(...drag.object.position);
      down = null;
      endDrag();
    };

    container.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    worldRef.current = { root, group: null, ids: new Set(), fit, cancelDrag: endDrag };

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(root, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      container.removeEventListener("pointerdown", onPointerDown, true);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
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
    // Mesh lama dibuang, jadi seretan yang sedang berjalan ikut dibatalkan.
    world.cancelDrag();
    const group = buildGroup(scene);
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
  }, [scene, revision]);

  // Sorotan dipisah agar memilih objek tidak membangun ulang scene di tengah seretan.
  useEffect(() => {
    for (const child of (worldRef.current?.group?.children ?? []) as THREE.Mesh[]) {
      (child.material as THREE.MeshStandardMaterial).emissive.set(
        child.userData.id === selectedId ? "#3b4fd8" : "#000000",
      );
    }
  }, [scene, selectedId, revision]);

  useEffect(() => {
    if (fitRequest > 0) worldRef.current?.fit();
  }, [fitRequest]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
      {failed ? (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-zinc-300">
          Browser ini tidak mendukung WebGL, jadi pratinjau 3D tidak bisa ditampilkan.
        </p>
      ) : (
        <ViewControls hint="Seret latar: putar · Klik kanan: geser · Roda: zoom · Seret objek: pindah (Shift naik-turun)">
          <ViewButton label="Seret objek naik-turun" pressed={lift} onClick={() => setLift(!lift)}>
            ↕ Naik-turun
          </ViewButton>
        </ViewControls>
      )}
    </div>
  );
}

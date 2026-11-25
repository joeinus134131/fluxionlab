"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Component } from "@/lib/pcb";
import { buildBoardModel, disposeModel, highlight } from "./board-models";
import type { BoardViewProps } from "./board-view";
import { ViewButton, ViewControls } from "../components/view-controls";

const SNAP = 0.5;
const PRESETS = {
  iso: { label: "Miring", direction: [0.15, 0.85, 0.75] },
  top: { label: "Atas", direction: [0, 1, 0.0001] },
  bottom: { label: "Bawah", direction: [0, -1, 0.0001] },
} as const;

type Preset = keyof typeof PRESETS;
type Model = ReturnType<typeof buildBoardModel>;

type World = {
  scene: THREE.Scene;
  model: Model | null;
  fit: (preset: Preset, width: number, height: number) => void;
  cancelDrag: () => void;
};

type Drag = {
  pointerId: number;
  component: Component;
  group: THREE.Group;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  moved: boolean;
};

export default function BoardView3d(props: BoardViewProps) {
  const { board, routing, stale, layers, selected } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const propsRef = useRef(props);
  const [failed, setFailed] = useState(false);
  // Dinaikkan untuk membangun ulang model bila perpindahan gagal disimpan.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    propsRef.current = props;
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
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15171c");
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.zoomToCursor = true;

    scene.add(new THREE.HemisphereLight("#ffffff", "#505060", 1.6));
    const above = new THREE.DirectionalLight("#ffffff", 1.6);
    above.position.set(40, 80, 30);
    const below = new THREE.DirectionalLight("#ffffff", 0.9);
    below.position.set(-30, -80, -20);
    scene.add(above, below);

    let drag: Drag | null = null;
    const raycaster = new THREE.Raycaster();
    const surface = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const aim = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };

    /** Titik di permukaan papan, dalam koordinat papan (mm). */
    const onBoard = () => {
      const hit = raycaster.ray.intersectPlane(surface, new THREE.Vector3());
      const { board } = propsRef.current;
      return hit && { x: hit.x + board.width / 2, y: hit.z + board.height / 2 };
    };

    const componentUnder = () => {
      let object: THREE.Object3D | null =
        raycaster.intersectObjects(worldRef.current?.model?.components ?? [], true)[0]?.object ?? null;
      while (object && !object.userData.ref) object = object.parent;
      return object as THREE.Group | null;
    };

    const endDrag = () => {
      if (drag && canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
      drag = null;
      controls.enabled = true;
    };

    let down: { x: number; y: number } | null = null;
    // Fase capture pada pembungkus berjalan sebelum OrbitControls,
    // sehingga kamera bisa dimatikan saat yang diseret adalah komponen.
    const onPointerDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
      if (event.button !== 0 || !event.isPrimary) return;
      aim(event);
      const group = componentUnder();
      const at = onBoard();
      const component = group && propsRef.current.board.components.find((c) => c.ref === group.userData.ref);
      if (!group || !component || !at) return;
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        component,
        group,
        offsetX: at.x - component.x,
        offsetY: at.y - component.y,
        x: component.x,
        y: component.y,
        moved: false,
      };
      propsRef.current.onSelect(component.ref);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) {
        aim(event);
        canvas.style.cursor = event.buttons ? "grabbing" : componentUnder() ? "move" : "grab";
        return;
      }
      if (event.pointerId !== drag.pointerId) return;
      if (!drag.moved && down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) return;
      aim(event);
      const at = onBoard();
      if (!at) return;
      const { board } = propsRef.current;
      const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value / SNAP) * SNAP));
      drag.x = clamp(at.x - drag.offsetX, board.width);
      drag.y = clamp(at.y - drag.offsetY, board.height);
      drag.moved = true;
      drag.group.position.set(drag.x, 1, drag.y);
    };

    const onPointerUp = (event: PointerEvent) => {
      const clicked = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4;
      down = null;
      if (drag) {
        if (event.pointerId !== drag.pointerId) return;
        const { component, group, x, y, moved } = drag;
        endDrag();
        if (!moved) return;
        group.position.y = 0;
        Promise.resolve(propsRef.current.onMove({ ...component, x, y })).then((saved) => {
          if (saved === undefined) setRevision((n) => n + 1);
        });
      } else if (clicked && event.button === 0 && event.target === canvas) {
        propsRef.current.onSelect(null);
      }
    };

    const onPointerCancel = () => {
      if (drag) drag.group.position.set(drag.component.x, 0, drag.component.y);
      down = null;
      endDrag();
    };

    container.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);

    const fit: World["fit"] = (preset, width, height) => {
      const radius = Math.hypot(width, height) / 2;
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const half = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
      const distance = (radius / Math.sin(half)) * 1.02;
      const direction = new THREE.Vector3(...PRESETS[preset].direction).normalize();
      // Habiskan sisa gerak halus (damping) lebih dulu agar tidak memiringkan posisi baru.
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      camera.position.copy(direction.multiplyScalar(distance));
      controls.target.set(0, 0, 0);
      controls.minDistance = 5;
      controls.maxDistance = distance * 4;
      controls.update();
    };

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    worldRef.current = { scene, model: null, fit, cancelDrag: endDrag };
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      container.removeEventListener("pointerdown", onPointerDown, true);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      controls.dispose();
      if (worldRef.current?.model) disposeModel(worldRef.current.model.root);
      worldRef.current = null;
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    // Model lama dibuang, jadi seretan yang sedang berjalan ikut dibatalkan.
    world.cancelDrag();
    if (world.model) {
      world.scene.remove(world.model.root);
      disposeModel(world.model.root);
    }
    world.model = buildBoardModel(board, routing, layers, stale);
    highlight(world.model.components, propsRef.current.selected);
    world.scene.add(world.model.root);
  }, [board, routing, layers, stale, revision]);

  useEffect(() => {
    if (worldRef.current?.model) highlight(worldRef.current.model.components, selected);
  }, [selected]);

  // Kamera hanya diatur ulang saat pertama tampil atau ukuran papan berubah.
  useEffect(() => {
    worldRef.current?.fit("iso", board.width, board.height);
  }, [board.width, board.height]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
      {failed ? (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-zinc-300">
          Browser ini tidak mendukung WebGL. Gunakan tampilan 2D.
        </p>
      ) : (
        <ViewControls hint="Seret: putar · Klik kanan: geser · Roda: zoom · Seret komponen: pindah">
          {(Object.keys(PRESETS) as Preset[]).map((preset) => (
            <ViewButton
              key={preset}
              label={`Lihat dari posisi ${PRESETS[preset].label.toLowerCase()}`}
              onClick={() => worldRef.current?.fit(preset, board.width, board.height)}
            >
              {PRESETS[preset].label}
            </ViewButton>
          ))}
        </ViewControls>
      )}
    </div>
  );
}

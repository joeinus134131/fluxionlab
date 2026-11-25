import { randomUUID } from "node:crypto";
import { createDocumentStore, DocumentError } from "./document-store";
import { MAX_OBJECTS, sceneSchema, type Operation, type Scene, type SceneState } from "./scene";

const documents = createDocumentStore<Scene>({
  name: "scene",
  key: "scene",
  schema: sceneSchema,
  empty: { name: "Scene baru", objects: [] },
});

const toState = ({ version, value }: { version: number; value: Scene }): SceneState => ({ version, scene: value });
const withId = <T extends object>(object: T) => ({ ...object, id: randomUUID().slice(0, 8) });

export const getState = (): SceneState => toState(documents.get());

function change(scene: Scene, operation: Exclude<Operation, { op: "undo" | "redo" }>): Scene {
  switch (operation.op) {
    case "replace":
      return { name: operation.scene.name, objects: operation.scene.objects.map(withId) };
    case "add":
      return { ...scene, objects: [...scene.objects, ...operation.objects.map(withId)] };
    case "update": {
      if (!scene.objects.some((o) => o.id === operation.id)) {
        throw new DocumentError(`Objek dengan id "${operation.id}" tidak ditemukan.`);
      }
      return {
        ...scene,
        objects: scene.objects.map((o) => (o.id === operation.id ? { ...o, ...operation.patch } : o)),
      };
    }
    case "remove": {
      const ids = new Set(operation.ids);
      const objects = scene.objects.filter((o) => !ids.has(o.id));
      if (objects.length === scene.objects.length) {
        throw new DocumentError("Tidak ada objek yang cocok dengan id tersebut.");
      }
      return { ...scene, objects };
    }
  }
}

export function applyOperation(operation: Operation): SceneState {
  if (operation.op === "undo") return toState(documents.undo());
  if (operation.op === "redo") return toState(documents.redo());
  return toState(
    documents.commit((scene) => {
      const next = change(scene, operation);
      if (next.objects.length > MAX_OBJECTS) throw new DocumentError(`Maksimal ${MAX_OBJECTS} objek per scene.`);
      return next;
    }),
  );
}

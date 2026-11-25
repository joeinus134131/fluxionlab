import { z } from "zod";

// Skema scene dipakai bersama oleh UI, REST API, AI, dan server MCP.
export const SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "plane"] as const;
export const MAX_OBJECTS = 500;

const num = z.number().min(-1000).max(1000);
const vec3 = z.tuple([num, num, num]);

// Tanpa nilai default, supaya update sebagian tidak menimpa field lain.
export const objectFields = {
  name: z.string().min(1).max(80),
  type: z.enum(SHAPES),
  position: vec3,
  rotation: vec3.describe("Derajat, urutan XYZ"),
  scale: vec3,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  metalness: z.number().min(0).max(1),
  roughness: z.number().min(0).max(1),
};

export const newObjectSchema = z.object({
  ...objectFields,
  rotation: objectFields.rotation.default([0, 0, 0]),
  scale: objectFields.scale.default([1, 1, 1]),
  color: objectFields.color.default("#8b9cf7"),
  metalness: objectFields.metalness.default(0.1),
  roughness: objectFields.roughness.default(0.7),
});

export const patchSchema = z.object(objectFields).partial();

export const sceneObjectSchema = newObjectSchema.extend({
  id: z.string().min(1).max(64),
});

export const sceneInputSchema = z.object({
  name: z.string().min(1).max(120),
  objects: z.array(newObjectSchema).max(MAX_OBJECTS),
});

export const sceneSchema = z.object({
  name: z.string().min(1).max(120),
  objects: z.array(sceneObjectSchema).max(MAX_OBJECTS),
});

export const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), scene: sceneInputSchema }),
  z.object({ op: z.literal("add"), objects: z.array(newObjectSchema).min(1).max(MAX_OBJECTS) }),
  z.object({ op: z.literal("update"), id: z.string(), patch: patchSchema }),
  z.object({ op: z.literal("remove"), ids: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("undo") }),
  z.object({ op: z.literal("redo") }),
]);

export type Scene = z.infer<typeof sceneSchema>;
export type SceneObject = z.infer<typeof sceneObjectSchema>;
export type SceneInput = z.infer<typeof sceneInputSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type SceneState = { version: number; scene: Scene };

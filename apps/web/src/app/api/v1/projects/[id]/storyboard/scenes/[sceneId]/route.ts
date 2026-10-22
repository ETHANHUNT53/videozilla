import { SCENE_TYPES, type SceneType } from "@videozilla/schema";
import { z } from "zod";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { textUpTo } from "@/server/api/request";
import { sceneOpResponse, sceneParams as params } from "@/server/api/scene-ops";

/**
 * `PATCH /api/v1/projects/{id}/storyboard/scenes/{sceneId}` (F3.6, API Design §13.4): the scene's narration, its
 * on-screen text (`props`, checked against its type's schema), its headlines (`beats[].headline`), or its type (by
 * hand: `props` then follow the new type). `DELETE …`: removes the scene (any scene, down to 1). Each is a new storyboard
 * version (`manual_edit`) on the version in `If-Match`. See docs/features/F3.6-scene-edits.md.
 */
const body = z
  .strictObject({
    narration: textUpTo(1000).optional(),
    type: z.enum(SCENE_TYPES as [SceneType, ...SceneType[]]).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    beats: z.array(z.strictObject({ headline: textUpTo(200) })).max(3).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Send what changed: narration, type, props or beats");

export const PATCH = apiRoute({ params, body, maxBodyBytes: 32 * 1024 }, async ({ req, user, params, body }) =>
  sceneOpResponse(req, user.id, params.id, { kind: "edit", sceneId: params.sceneId, ...body }),
);

export const DELETE = apiRoute({ params }, async ({ req, user, params }) => sceneOpResponse(req, user.id, params.id, { kind: "delete", sceneId: params.sceneId }));

const notAllowed = methodNotAllowed(["PATCH", "DELETE"]);
export { notAllowed as GET, notAllowed as POST, notAllowed as PUT };

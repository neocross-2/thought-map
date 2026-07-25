import {
  FunctionContext,
  error,
  isAdmin,
  isSameOrigin,
  json,
  methodNotAllowed,
} from "../../../../../_shared/treemap";

export async function onRequest(context: FunctionContext) {
  if (context.request.method !== "DELETE") {
    return methodNotAllowed(["DELETE"]);
  }
  if (!(await isAdmin(context.request, context.env))) {
    return error("Unauthorized", 401);
  }
  if (!isSameOrigin(context.request)) return error("Forbidden", 403);

  const slug = String(context.params.slug || "");
  const id = String(context.params.id || "");
  const asset = await context.env.TREEMAP_DB.prepare(
    `SELECT a.object_key
       FROM mindmap_assets a
       JOIN mindmaps m ON m.id = a.mindmap_id
      WHERE a.id = ?1 AND m.slug = ?2
      LIMIT 1`,
  )
    .bind(id, slug)
    .first<{ object_key: string }>();
  if (!asset) return error("Asset not found", 404);

  await context.env.TREEMAP_ASSETS.delete(asset.object_key);
  await context.env.TREEMAP_DB.prepare(
    "DELETE FROM mindmap_assets WHERE id = ?1",
  )
    .bind(id)
    .run();
  return json({ ok: true });
}

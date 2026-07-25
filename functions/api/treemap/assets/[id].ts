import {
  FunctionContext,
  error,
  methodNotAllowed,
} from "../../../_shared/treemap";

export async function onRequest(context: FunctionContext) {
  if (context.request.method !== "GET") return methodNotAllowed(["GET"]);
  const id = String(context.params.id || "");
  const asset = await context.env.TREEMAP_DB.prepare(
    `SELECT a.object_key, a.mime_type
       FROM mindmap_assets a
       JOIN mindmaps m ON m.id = a.mindmap_id
      WHERE a.id = ?1 AND m.is_public = 1
      LIMIT 1`,
  )
    .bind(id)
    .first<{ object_key: string; mime_type: string }>();
  if (!asset) return error("Asset not found", 404);

  const object = await context.env.TREEMAP_ASSETS.get(asset.object_key);
  if (!object) return error("Asset not found", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", asset.mime_type);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

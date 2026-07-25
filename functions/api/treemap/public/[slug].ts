import {
  FunctionContext,
  error,
  json,
  mapRow,
  MindmapRow,
  methodNotAllowed,
} from "../../../_shared/treemap";

export async function onRequest(context: FunctionContext) {
  if (context.request.method !== "GET") return methodNotAllowed(["GET"]);
  const slug = String(context.params.slug || "");
  const row = await context.env.TREEMAP_DB.prepare(
    `SELECT id, slug, title, document_json, version, updated_at
       FROM mindmaps
      WHERE slug = ?1 AND is_public = 1
      LIMIT 1`,
  )
    .bind(slug)
    .first<MindmapRow>();
  return row ? json(mapRow(row)) : error("Map not found", 404);
}

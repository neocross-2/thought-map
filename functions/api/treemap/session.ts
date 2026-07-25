import {
  FunctionContext,
  isAdmin,
  json,
  methodNotAllowed,
} from "../../_shared/treemap";

export async function onRequest(context: FunctionContext) {
  if (context.request.method !== "GET") return methodNotAllowed(["GET"]);
  return json({
    authenticated: await isAdmin(context.request, context.env),
  });
}

import { createGraph, type Graph } from "./graph";

/** META_ACCESS_TOKEN yoksa null. Değer yalnız sunucuda kalır. */
export function graphFromEnv(): Graph | null {
  const t = process.env.META_ACCESS_TOKEN;
  return t ? createGraph(t) : null;
}

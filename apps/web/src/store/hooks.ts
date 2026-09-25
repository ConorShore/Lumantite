import { useMemo } from "react";
import type { Issue } from "@optiplanner/schema";
import { useProject } from "./projectStore";
import { useCatalog } from "./catalogStore";
import { useResults } from "./resultsStore";

/** Session (parse/schema) + catalog + computed issues, in that order. */
export function useAllIssues(): Issue[] {
  const session = useProject((s) => s.sessionIssues);
  const catalog = useCatalog((s) => s.issues);
  const results = useResults((s) => s.results?.issues);
  return useMemo(() => [...session, ...catalog, ...(results ?? [])], [session, catalog, results]);
}

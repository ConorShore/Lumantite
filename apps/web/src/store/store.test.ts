import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useProject, useCatalog, useResults, useUi } from "./index";
import { bootstrap, selectIssue, deleteSelection, elementForIssue } from "./actions";
import { SAMPLE_CATALOG_FILES, SAMPLE_PROJECT_FILES, SAMPLE_ROOT } from "../sample";

const SPANS = "sample/spans.yaml"; // storage path
const mSPANS = "spans.yaml"; // model path

function openSample(source: "server" | "sample" = "server") {
  const etags = Object.fromEntries(Object.keys(SAMPLE_PROJECT_FILES).map((p) => [p, `etag-${p}`]));
  useCatalog.getState().openFiles(SAMPLE_CATALOG_FILES, {}, "sample");
  useProject.getState().openFromFiles(SAMPLE_ROOT, SAMPLE_PROJECT_FILES, etags, source);
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  useUi.setState({ selection: [], tab: "canvas" });
  useProject.setState({ conflict: null, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("project store", () => {
  it("applyOps marks files dirty (storage + model paths) and only physics ops bump computeRev", () => {
    openSample();
    const rev = useProject.getState().computeRev;
    useProject.getState().applyOps([{ op: "setLayout", kind: "node", id: "A-mux", rect: { x: 5, y: 5 } }]);
    expect(useProject.getState().computeRev).toBe(rev);
    expect(useProject.getState().dirtyFiles).toEqual(["sample/sites/exchange-a.yaml"]);
    expect(useProject.getState().dirtyModel).toEqual(["sites/exchange-a.yaml"]);
    useProject.getState().applyOps([{ op: "updateFibre", id: "span-AB-1", patch: { length_km: 70 } }]);
    expect(useProject.getState().computeRev).toBe(rev + 1);
    expect(useProject.getState().fileTexts[mSPANS]).toContain("length_km: 70");
  });

  it("rejected op batches surface as opIssues and leave the model untouched", () => {
    openSample();
    const issues = useProject.getState().applyOps([{ op: "deleteNode", id: "nope" }]);
    expect(issues[0]?.severity).toBe("error");
    expect(useProject.getState().opIssues).toHaveLength(1);
    expect(useProject.getState().dirtyFiles).toEqual([]);
  });

  it("setFileText from the YAML editor updates the model", () => {
    openSample();
    const t = useProject.getState().fileTexts[mSPANS]!.replace("length_km: 60", "length_km: 61");
    useProject.getState().setFileText(mSPANS, t);
    expect(useProject.getState().model!.fibres.find((f) => f.id === "span-AB-1")?.length_km).toBe(61);
    expect(useProject.getState().dirtyModel).toEqual([mSPANS]);
  });
});

describe("recompute", () => {
  it("is debounced 150 ms after model changes and ignores layout-only edits", async () => {
    vi.useFakeTimers();
    openSample();
    useResults.setState({ results: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(useResults.getState().results).toBeNull();
    // another change inside the window restarts the debounce
    useProject.getState().applyOps([{ op: "updateFibre", id: "span-AB-1", patch: { length_km: 65 } }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(useResults.getState().results).toBeNull();
    await vi.advanceTimersByTimeAsync(60);
    const r = useResults.getState().results;
    expect(r?.signals.length).toBe(8);
    // layout-only: no new compute
    useProject.getState().applyOps([{ op: "setLayout", kind: "node", id: "A-mux", rect: { x: 1, y: 1 } }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(useResults.getState().results).toBe(r);
  });

  it("margins change the pass/warn/fail summary", async () => {
    openSample();
    await useResults.getState().recomputeNow();
    const before = useResults.getState().results!.summary.fail;
    useProject.getState().applyOps([{ op: "setMargins", margins: { system_margin_dB: 20 } }]);
    await useResults.getState().recomputeNow();
    expect(useResults.getState().results!.summary.fail).toBeGreaterThan(before);
  });

  it("catalog edits trigger recompute via the catalog version", () => {
    openSample();
    const spy = vi.spyOn(useResults.getState(), "requestRecompute");
    useCatalog.getState().upsert("hosts.yaml", { kind: "host", id: "another-host" });
    expect(spy).toHaveBeenCalled();
    expect(useCatalog.getState().dirtyFiles).toEqual(["hosts.yaml"]);
    spy.mockRestore();
  });
});

describe("save", () => {
  it("PUTs changed files with their etags and adopts the returned etags", async () => {
    openSample();
    useProject.getState().applyOps([{ op: "updateFibre", id: "span-AB-1", patch: { length_km: 70 } }]);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(Object.keys(body.files)).toEqual([SPANS]);
      expect(body.files[SPANS].etag).toBe(`etag-${SPANS}`);
      return json(200, { files: { [SPANS]: { etag: "new" } } });
    });
    vi.stubGlobal("fetch", fetch);
    await useProject.getState().save();
    expect(fetch).toHaveBeenCalledWith(`/api/projects/sample/project.yaml/files`, expect.objectContaining({ method: "PUT" }));
    expect(useProject.getState().dirtyFiles).toEqual([]);
    expect(useProject.getState().etags[SPANS]).toBe("new");
  });

  it("on 409 shows a conflict; overwrite re-sends with the server's etag", async () => {
    openSample();
    useProject.getState().applyOps([{ op: "updateFibre", id: "span-AB-1", patch: { length_km: 70 } }]);
    const sent: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const etag = JSON.parse(String(init!.body)).files[SPANS].etag;
      sent.push(etag);
      if (etag !== "disk") return json(409, { conflicts: [SPANS], files: { [SPANS]: { text: "x", etag: "disk" } } });
      return json(200, { files: { [SPANS]: { etag: "after" } } });
    }));
    await useProject.getState().save();
    expect(useProject.getState().conflict?.paths).toEqual([SPANS]);
    expect(useProject.getState().dirtyFiles).toEqual([SPANS]);
    await useProject.getState().resolveConflict("overwrite");
    expect(sent).toEqual([`etag-${SPANS}`, "disk"]);
    expect(useProject.getState().conflict).toBeNull();
    expect(useProject.getState().dirtyFiles).toEqual([]);
  });

  it("new files are sent with etag null", async () => {
    openSample();
    useProject.getState().applyOps([{ op: "addFile", file: "extra.yaml" }]);
    let body: { files: Record<string, { etag: string | null }> } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init!.body));
      return json(200, { files: Object.fromEntries(Object.keys(body!.files).map((p) => [p, { etag: "e" }])) });
    }));
    await useProject.getState().save();
    expect(body!.files["sample/extra.yaml"]!.etag).toBeNull();
    expect(body!.files[SAMPLE_ROOT]!.etag).toBe(`etag-${SAMPLE_ROOT}`);
  });

  it("sample (offline) mode saves in memory only", async () => {
    openSample("sample");
    useProject.getState().applyOps([{ op: "updateFibre", id: "span-AB-1", patch: { length_km: 70 } }]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await useProject.getState().save();
    expect(fetch).not.toHaveBeenCalled();
    expect(useProject.getState().dirtyFiles).toEqual([]);
  });

  it("removeFile queues the fragment's storage path and DELETEs it on the next successful save", async () => {
    openSample();
    // sample/spans.yaml holds no nodes/sites, but does hold fibres; move them out first so the
    // fragment is empty and removeFile can succeed.
    const fibreIds = useProject.getState().model!.fibres.filter((f) => f.file === mSPANS).map((f) => f.id);
    useProject.getState().applyOps(fibreIds.map((id) => ({ op: "moveToFile" as const, kind: "fibre" as const, id, file: SAMPLE_ROOT })));
    const issues = useProject.getState().applyOps([{ op: "removeFile", file: mSPANS }]);
    expect(issues.some((i) => i.severity === "error")).toBe(false);
    expect(useProject.getState().pendingDeletes).toEqual([SPANS]);

    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "DELETE") return json(200, { ok: true });
      const body = JSON.parse(String(init!.body)) as { files: Record<string, unknown> };
      return json(200, { files: Object.fromEntries(Object.keys(body.files).map((p) => [p, { etag: "e" }])) });
    }));
    await useProject.getState().save();
    expect(calls).toContain(`DELETE /api/projects/${SAMPLE_ROOT}/files?path=${encodeURIComponent(SPANS)}`);
    expect(useProject.getState().pendingDeletes).toEqual([]);
  });

  it("a failed delete-on-save stays queued and shows an error toast", async () => {
    openSample();
    const fibreIds = useProject.getState().model!.fibres.filter((f) => f.file === mSPANS).map((f) => f.id);
    useProject.getState().applyOps(fibreIds.map((id) => ({ op: "moveToFile" as const, kind: "fibre" as const, id, file: SAMPLE_ROOT })));
    useProject.getState().applyOps([{ op: "removeFile", file: mSPANS }]);
    useUi.setState({ toast: null });

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return json(404, { error: "file not found" });
      const body = JSON.parse(String(init!.body)) as { files: Record<string, unknown> };
      return json(200, { files: Object.fromEntries(Object.keys(body.files).map((p) => [p, { etag: "e" }])) });
    }));
    await useProject.getState().save();
    expect(useProject.getState().pendingDeletes).toEqual([SPANS]);
    expect(useUi.getState().toast?.kind).toBe("error");
  });
});

describe("bootstrap + selection actions", () => {
  it("falls back to the bundled sample when /api is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    useProject.setState({ source: null, projects: [] });
    await bootstrap();
    expect(useProject.getState().source).toBe("sample");
    expect(useProject.getState().model?.project.name).toContain("Metro ring east");
    expect(useCatalog.getState().source).toBe("sample");
    expect(useCatalog.getState().catalog.models.size).toBeGreaterThan(10);
  });

  it("maps issues to elements: node, fibre, signal → tx node, joint → fibre, file (storage path) → YAML tab", () => {
    openSample();
    const m = useProject.getState().model;
    const I = (element: string) => ({ severity: "error" as const, code: "rx.power_low" as const, message: "", element });
    expect(elementForIssue(I("A-mux"), m)).toEqual({ kind: "node", id: "A-mux" });
    expect(elementForIssue(I("span-BA"), m)).toEqual({ kind: "fibre", id: "span-BA" });
    expect(elementForIssue(I("B-sfp-24.tx:C24"), m)).toEqual({ kind: "node", id: "B-sfp-24" });
    expect(elementForIssue(I("joint:span-AB-1.b~span-AB-2.a"), m)).toEqual({ kind: "fibre", id: "span-AB-1" });
    expect(elementForIssue(I(SPANS), m)).toEqual({ kind: "file", id: mSPANS });
    selectIssue(I("B-sfp-24.tx:C24"));
    expect(useUi.getState().selection).toEqual([{ kind: "node", id: "B-sfp-24" }]);
    expect(useUi.getState().tab).toBe("canvas");
    selectIssue(I(SPANS));
    expect(useUi.getState().tab).toBe("yaml");
    expect(useUi.getState().yamlFile).toBe(mSPANS);
  });

  it("deleteSelection deletes nodes/fibres and clears the selection", () => {
    openSample();
    useUi.getState().select([{ kind: "node", id: "A-amp" }, { kind: "fibre", id: "span-BA" }]);
    deleteSelection();
    const m = useProject.getState().model!;
    expect(m.nodes.some((n) => n.id === "A-amp")).toBe(false);
    expect(m.fibres.some((f) => f.id === "span-BA")).toBe(false);
    expect(useUi.getState().selection).toEqual([]);
  });
});

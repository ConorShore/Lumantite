import { describe, it, expect } from "vitest";
import { minimalEdit } from "./textDiff";
import { storageOf } from "./paths";
import { projectJsonSchemas } from "./jsonSchemas";
import { nextId } from "./ids";

describe("lib", () => {
  it("minimalEdit trims common prefix and suffix", () => {
    expect(minimalEdit("abc", "abc")).toBeNull();
    expect(minimalEdit("length: 60\nx", "length: 110\nx")).toEqual({ start: 8, end: 9, text: "11" });
    expect(minimalEdit("aaa", "aaaa")).toEqual({ start: 3, end: 3, text: "a" });
  });
  it("storageOf maps model paths to storage paths", () => {
    expect(storageOf("m/project.yaml", "m/project.yaml")).toBe("m/project.yaml");
    expect(storageOf("m/project.yaml", "sites/a.yaml")).toBe("m/sites/a.yaml");
    expect(storageOf("project.yaml", "a.yaml")).toBe("a.yaml");
  });
  it("generates JSON Schemas for project and fragment files from zod", () => {
    const { project, fragment } = projectJsonSchemas();
    expect((project.properties as Record<string, unknown>).includes).toBeDefined();
    expect((fragment.properties as Record<string, unknown>).nodes).toBeDefined();
    expect((fragment.properties as Record<string, unknown>).project).toBeUndefined();
  });
  it("nextId picks the first free suffix", () => {
    expect(nextId("f", ["f1", "f2", "f4"])).toBe("f3");
  });
});

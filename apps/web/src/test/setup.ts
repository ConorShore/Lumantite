// jsdom gaps that React Flow touches.
class RO { observe() {} unobserve() {} disconnect() {} }
const g = globalThis as Record<string, unknown>;
g.ResizeObserver ??= RO;
g.IS_REACT_ACT_ENVIRONMENT = true;
if (!("DOMMatrixReadOnly" in g)) {
  g.DOMMatrixReadOnly = class {
    m22: number;
    constructor(t?: string) { const s = t?.match(/scale\(([1-9.])\)/)?.[1]; this.m22 = s ? +s : 1; }
  };
}
if (typeof window !== "undefined") {
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetHeight: { get() { return 100; }, configurable: true },
    offsetWidth: { get() { return 100; }, configurable: true },
  });
  (window.SVGElement.prototype as unknown as { getBBox: () => object }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
}

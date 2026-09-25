/** Canvas-only transient state, kept out of node data so drags aren't reset by result updates. */
import { create } from "zustand";

export interface HoverPort { node: string; port: string; x: number; y: number }
interface DecorState {
  /** Elements with an error-severity issue (red outline). */
  errorIds: Set<string>;
  /** When a transceiver/fibre is selected: every element on its signal paths. */
  pathIds: Set<string> | null;
  hover: HoverPort | null;
  setHover(h: HoverPort | null): void;
}
export const useDecor = create<DecorState>()((set) => ({
  errorIds: new Set(),
  pathIds: null,
  hover: null,
  setHover: (hover) => set({ hover }),
}));

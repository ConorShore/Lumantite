import { create } from "zustand";
import { AppConfig } from "@lumantite/schema";

export const DEFAULT_CONFIG: AppConfig = AppConfig.parse({});

interface ConfigState {
  config: AppConfig;
  setConfig(c: AppConfig): void;
}
export const useConfig = create<ConfigState>()((set) => ({
  config: DEFAULT_CONFIG,
  setConfig: (config) => set({ config }),
}));

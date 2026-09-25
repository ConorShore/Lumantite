/** Next free id `${prefix}${n}` not in `taken`. */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let n = 1; ; n++) if (!set.has(`${prefix}${n}`)) return `${prefix}${n}`;
}
export const KIND_PREFIX: Record<string, string> = {
  transceiver: "trx-", mux: "mux-", amplifier: "amp-", attenuator: "att-", dcm: "dcm-",
  splitter: "spl-", passthrough: "pp-", host: "host-",
};

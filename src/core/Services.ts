/**
 * Service registry. Long-lived singletons (engine, input, settings, audio...) register here
 * so systems can find each other without import cycles.
 *
 * Each module adds its own entry with declaration merging:
 *
 *   declare module '../core/Services' {
 *     interface ServiceMap { input: Input }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ServiceMap {}

const registry = new Map<keyof ServiceMap, unknown>();

export const services = {
  register<K extends keyof ServiceMap>(key: K, value: ServiceMap[K]): void {
    registry.set(key, value);
  },
  get<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
    if (!registry.has(key)) throw new Error(`[services] "${String(key)}" is not registered`);
    return registry.get(key) as ServiceMap[K];
  },
  tryGet<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined {
    return registry.get(key) as ServiceMap[K] | undefined;
  },
  has(key: keyof ServiceMap): boolean {
    return registry.has(key);
  },
  unregister(key: keyof ServiceMap): void {
    registry.delete(key);
  },
};

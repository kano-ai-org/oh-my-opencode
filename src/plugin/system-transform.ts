import type { PluginInterface } from "./types"

type SystemTransformHook = NonNullable<PluginInterface["experimental.chat.system.transform"]>

export function createSystemTransformHandler(): SystemTransformHook {
  return async (_input, _output): Promise<void> => {}
}

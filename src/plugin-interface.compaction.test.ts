import { describe, expect, test } from "bun:test"
import { createPluginInterface } from "./plugin-interface"

describe("createPluginInterface - experimental.session.compacting", () => {
  test("captures compaction state and injects context", async () => {
    const calls: string[] = []
    const plugin = createPluginInterface({
      ctx: {} as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {
        compactionContextInjector: {
          capture: async (sid: string) => {
            calls.push(`context:${sid}`)
          },
          inject: (sid?: string) => `ctx:${sid}`,
          event: async () => {},
        },
        compactionTodoPreserver: {
          capture: async (sid: string) => {
            calls.push(`todo:${sid}`)
          },
          event: async () => {},
        },
      } as never,
      tools: {},
    })
    const out = { context: [] as string[], prompt: undefined as string | undefined }

    await plugin["experimental.session.compacting"]?.({ sessionID: "ses_compact" } as never, out as never)

    expect(calls).toEqual(["context:ses_compact", "todo:ses_compact"])
    expect(out.context).toEqual(["ctx:ses_compact"])
  })

  test("does nothing when session id is missing", async () => {
    const plugin = createPluginInterface({
      ctx: {} as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {} as never,
      hooks: {} as never,
      tools: {},
    })
    const out = { context: [] as string[], prompt: undefined as string | undefined }

    await plugin["experimental.session.compacting"]?.({} as never, out as never)

    expect(out.context).toEqual([])
  })
})

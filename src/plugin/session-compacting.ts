import type { CreatedHooks } from "../create-hooks"

type SessionCompactingInput = { sessionID?: string }
type SessionCompactingOutput = { context: string[]; prompt?: string }

export function createSessionCompactingHandler(args: {
  hooks: CreatedHooks
}): (input: SessionCompactingInput, output: SessionCompactingOutput) => Promise<void> {
  return async (input, output): Promise<void> => {
    const sid = input.sessionID
    if (!sid) return

    await args.hooks.compactionContextInjector?.capture(sid)
    await args.hooks.compactionTodoPreserver?.capture(sid)

    const text = args.hooks.compactionContextInjector?.inject(sid)
    if (text) {
      output.context.push(text)
    }
  }
}

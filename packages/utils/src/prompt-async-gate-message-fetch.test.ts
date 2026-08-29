/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import {
  _setPromptGateMessagesFetchTimeoutMsForTesting,
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
} from "./prompt-async-gate"

describe("dispatchInternalPrompt message fetch safety", () => {
  afterEach(() => {
    // then
    _setPromptGateMessagesFetchTimeoutMsForTesting(undefined)
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given latest-message fetch hangs #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    _setPromptGateMessagesFetchTimeoutMsForTesting(5)
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_messages_hang: { type: "idle" } } }),
        messages: async () => new Promise(() => {}),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_messages_hang",
      input: { path: { id: "ses_messages_hang" }, body: { parts: [] } },
      source: "test:messages-hang",
      settleMs: 0,
      postDispatchHoldMs: 0,
      dispatchTimeoutMs: 50,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given latest-message fetch throws #when an internal promptAsync is requested #then no prompt is sent", async () => {
    // given
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_messages_throw: { type: "idle" } } }),
        messages: async () => {
          throw new Error("message endpoint failed")
        },
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_messages_throw",
      input: { path: { id: "ses_messages_throw" }, body: { parts: [] } },
      source: "test:messages-throw",
      settleMs: 0,
      postDispatchHoldMs: 0,
      dispatchTimeoutMs: 50,
    })

    // then
    expect(result.status).toBe("queued")
    expect(promptCalls).toBe(0)
  })

  test("#given a large parent session #when the latest assistant is inspected #then only the newest message page is requested", async () => {
    // given
    let messagesInput: unknown
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { ses_large_parent: { type: "idle" } } }),
        messages: async (input: unknown) => {
          messagesInput = input
          return { data: [] }
        },
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }

    // when
    const result = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: "ses_large_parent",
      input: {
        path: { id: "ses_large_parent" },
        query: { directory: "D:\\_work\\_Hikari\\Hikari" },
        body: { parts: [] },
      },
      source: "test:bounded-message-fetch",
      settleMs: 0,
      postDispatchHoldMs: 0,
      dispatchTimeoutMs: 50,
    })

    // then
    expect(result.status).toBe("dispatched")
    expect(promptCalls).toBe(1)
    expect(messagesInput).toEqual({
      path: { id: "ses_large_parent" },
      query: {
        directory: "D:\\_work\\_Hikari\\Hikari",
        limit: 5,
      },
    })
  })
})

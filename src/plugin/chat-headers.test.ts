/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { OMO_INTERNAL_INITIATOR_MARKER } from "../shared"
import { createChatHeadersHandler } from "./chat-headers"

describe("createChatHeadersHandler", () => {
  test("sets x-initiator=agent for Copilot internal marker messages", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [
                  {
                    type: "text",
                    text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
                  },
                ],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_1",
        provider: { id: "github-copilot" },
        model: {
          api: {
            npm: "custom-copilot-client",
          },
        },
        message: {
          id: "msg_1",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBe("agent")
  })

  test("does not override non-copilot providers", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [
                  {
                    type: "text",
                    text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
                  },
                ],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_1",
        provider: { id: "openai" },
        model: {
          api: {
            npm: "@ai-sdk/openai",
          },
        },
        message: {
          id: "msg_2",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("does not override regular user messages", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [{ type: "text", text: "normal user message" }],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_3",
        provider: { id: "github-copilot" },
        model: {
          api: {
            npm: "custom-copilot-client",
          },
        },
        message: {
          id: "msg_3",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("does not override x-initiator for ai-sdk Copilot requests", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [
                  {
                    type: "text",
                    text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
                  },
                ],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = { headers: {} }

    await handler(
      {
        sessionID: "ses_4",
        provider: { id: "github-copilot" },
        model: {
          api: {
            npm: "@ai-sdk/github-copilot",
          },
        },
        message: {
          id: "msg_4",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBeUndefined()
  })

  test("does not overwrite an existing x-initiator header", async () => {
    const handler = createChatHeadersHandler({
      ctx: {
        client: {
          session: {
            message: async () => ({
              data: {
                parts: [
                  {
                    type: "text",
                    text: `notification\n${OMO_INTERNAL_INITIATOR_MARKER}`,
                  },
                ],
              },
            }),
          },
        },
      } as never,
    })
    const output: { headers: Record<string, string> } = {
      headers: {
        "x-initiator": "user",
      },
    }

    await handler(
      {
        sessionID: "ses_5",
        provider: { id: "github-copilot" },
        model: {
          api: {
            npm: "custom-copilot-client",
          },
        },
        message: {
          id: "msg_5",
          role: "user",
        },
      },
      output,
    )

    expect(output.headers["x-initiator"]).toBe("user")
  })
})

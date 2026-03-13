import { describe, expect, test } from "bun:test"

import { resolveModelPipeline } from "./model-resolution-pipeline"

describe("resolveModelPipeline", () => {
  test("falls back when user override model is unavailable", () => {
    const result = resolveModelPipeline({
      intent: {
        userModel: "zai-coding-plan/glm-4.7-free",
      },
      constraints: {
        availableModels: new Set([
          "openai/gpt-5.4",
          "anthropic/claude-opus-4-6",
        ]),
      },
      policy: {
        fallbackChain: [
          { providers: ["openai"], model: "gpt-5.4", variant: "xhigh" },
          { providers: ["anthropic"], model: "claude-opus-4-6", variant: "max" },
        ],
      },
    })

    expect(result).toEqual({
      model: "openai/gpt-5.4",
      provenance: "provider-fallback",
      variant: "xhigh",
      attempted: ["zai-coding-plan/glm-4.7-free"],
    })
  })

  test("keeps user override model when it is available", () => {
    const result = resolveModelPipeline({
      intent: {
        userModel: "openai/gpt-5.4",
      },
      constraints: {
        availableModels: new Set(["openai/gpt-5.4"]),
      },
      policy: {
        fallbackChain: [{ providers: ["anthropic"], model: "claude-opus-4-6", variant: "max" }],
      },
    })

    expect(result).toEqual({
      model: "openai/gpt-5.4",
      provenance: "override",
      attempted: ["openai/gpt-5.4"],
    })
  })
})

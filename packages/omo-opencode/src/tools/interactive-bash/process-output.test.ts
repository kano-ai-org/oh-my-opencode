/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { collectProcessResult, type CommandProcess } from "./process-output"

describe("collectProcessResult", () => {
  test("#given an exited process whose stdout stays open #when the bound expires #then it kills and releases the reader", async () => {
    // given
    let cancelled = false
    let killed = false
    const stdout = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    const process: CommandProcess = {
      exited: Promise.resolve(0),
      stdout,
      stderr,
      kill() {
        killed = true
      },
    }

    // when
    const result = await collectProcessResult(process, 20).then(
      () => "resolved",
      (error: unknown) => error,
    )

    // then
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("Timeout after 20ms")
    expect(killed).toBeTrue()
    expect(cancelled).toBeTrue()
  })

  test("#given closed output streams #when the process exits #then it returns decoded output", async () => {
    // given
    const encoder = new TextEncoder()
    const process: CommandProcess = {
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("ready"))
          controller.close()
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("note"))
          controller.close()
        },
      }),
      kill() {},
    }

    // when
    const result = await collectProcessResult(process, 100)

    // then
    expect(result).toEqual({ stdout: "ready", stderr: "note", exitCode: 0 })
  })
})

/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { SpawnedProcess } from "../../shared/spawn-with-windows-hide"
import { collectProcessOutput, executeInteractiveBash } from "./tools"

describe("interactive_bash", () => {
  test("#given kill-server command #when executed #then returns a strong prohibition without running tmux", async () => {
    // given
    const args = { tmux_command: "kill-server" }

    // when
    const output = await executeInteractiveBash(args)

    // then
    expect(output).toContain("Error: 'kill-server' is prohibited in interactive_bash.")
    expect(output).toContain("NEVER EVER run tmux kill-server from interactive_bash.")
    expect(output).toContain("Do not retry kill-server with Bash or any other tool.")
  })

  test("#given kill-server after tmux global options #when executed #then still prohibits it", async () => {
    // given
    const args = { tmux_command: "-L omo-socket kill-server" }

    // when
    const output = await executeInteractiveBash(args)

    // then
    expect(output).toContain("Error: 'kill-server' is prohibited in interactive_bash.")
  })

  test("#given an exited process with an open descendant pipe #when output collection stalls #then times out", async () => {
    // given
    let killed = false
    const proc: SpawnedProcess = {
      exitCode: 0,
      exited: Promise.resolve(0),
      stdout: new ReadableStream<Uint8Array>(),
      stderr: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      }),
      kill() {
        killed = true
      },
    }

    // when
    const result = collectProcessOutput(proc, 10)

    // then
    await expect(result).rejects.toThrow("Timeout after 10ms")
    expect(killed).toBe(true)
  })
})

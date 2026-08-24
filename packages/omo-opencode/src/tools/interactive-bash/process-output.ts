export type CommandProcess = {
  readonly exited: Promise<number>
  readonly stdout?: ReadableStream<Uint8Array>
  readonly stderr?: ReadableStream<Uint8Array>
  kill(): unknown
}

type StreamCollector = {
  readonly result: Promise<string>
  cancel(): Promise<void>
}

function createStreamCollector(stream: ReadableStream<Uint8Array> | undefined): StreamCollector {
  if (!stream) {
    return {
      result: Promise.resolve(""),
      cancel: () => Promise.resolve(),
    }
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const result = (async () => {
    let output = ""
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return output + decoder.decode()
        output += decoder.decode(chunk.value, { stream: true })
      }
    } finally {
      reader.releaseLock()
    }
  })()

  return {
    result,
    async cancel() {
      try {
        await reader.cancel()
      } catch {
        return
      }
    },
  }
}

function killProcess(process: CommandProcess): void {
  try {
    process.kill()
  } catch {
    return
  }
}

export async function collectProcessResult(
  process: CommandProcess,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout = createStreamCollector(process.stdout)
  const stderr = createStreamCollector(process.stderr)
  let timeoutID: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => {
      void stdout.cancel()
      void stderr.cancel()
      killProcess(process)
      reject(new Error("Timeout after " + timeoutMs + "ms"))
    }, timeoutMs)
  })

  try {
    const [stdoutText, stderrText, exitCode] = await Promise.race([
      Promise.all([stdout.result, stderr.result, process.exited]),
      timeout,
    ])
    return { stdout: stdoutText, stderr: stderrText, exitCode }
  } catch (error) {
    void stdout.cancel()
    void stderr.cancel()
    killProcess(process)
    throw error
  } finally {
    if (timeoutID !== undefined) clearTimeout(timeoutID)
  }
}

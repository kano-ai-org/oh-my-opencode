import { spawn } from "../../shared/bun-spawn-shim"
import { bunWhich } from "../../shared/bun-which-shim"
import { isCmuxCompatEnvironment } from "../../shared/tmux/cmux-detect"
import { collectProcessResult } from "./process-output"

const PATH_LOOKUP_TIMEOUT_MS = 5_000
const TMUX_VERIFY_TIMEOUT_MS = 5_000
const MINIMUM_TMUX_MAJOR_VERSION = 2

let tmuxPath: string | null = null
let initPromise: Promise<string | null> | null = null
let tmuxPathEnvironmentKey: "cmux" | "tmux" | null = null

function getEnvironmentKey(): "cmux" | "tmux" {
  return isCmuxCompatEnvironment() ? "cmux" : "tmux"
}

function candidateKey(candidate: string): string {
  return process.platform === "win32" ? candidate.toLowerCase() : candidate
}

async function findCommandPaths(command: string): Promise<string[]> {
  const paths: string[] = []
  const seen = new Set<string>()
  const add = (candidate: string | null | undefined) => {
    const value = candidate?.trim()
    if (!value) return
    const key = candidateKey(value)
    if (seen.has(key)) return
    seen.add(key)
    paths.push(value)
  }

  try {
    add(bunWhich(command))
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }

  const locatorCommand =
    process.platform === "win32" ? ["where.exe", command] : ["which", "-a", command]

  try {
    const proc = spawn(locatorCommand, {
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const result = await collectProcessResult(proc, PATH_LOOKUP_TIMEOUT_MS)
    if (result.exitCode === 0) {
      for (const path of result.stdout.split(/\r?\n/)) add(path)
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }

  return paths
}

function isSupportedTmuxVersion(output: string): boolean {
  const match = /^tmux\s+(\d+)/im.exec(output)
  if (!match) return false
  return Number(match[1]) >= MINIMUM_TMUX_MAJOR_VERSION
}

async function findVerifiedTmuxPath(): Promise<string | null> {
  const paths = await findCommandPaths("tmux")
  for (const path of paths) {
    try {
      const verifyProc = spawn([path, "-V"], {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const result = await collectProcessResult(verifyProc, TMUX_VERIFY_TIMEOUT_MS)
      if (result.exitCode === 0 && isSupportedTmuxVersion(result.stdout + "\n" + result.stderr)) {
        return path
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }

  return null
}

async function findTmuxPath(): Promise<string | null> {
  if (isCmuxCompatEnvironment()) {
    const cmuxPath = (await findCommandPaths("cmux"))[0]
    if (cmuxPath) {
      return cmuxPath
    }
  }

  return findVerifiedTmuxPath()
}

export async function getTmuxPath(): Promise<string | null> {
  const environmentKey = getEnvironmentKey()
  if (tmuxPath !== null && tmuxPathEnvironmentKey === environmentKey) {
    return tmuxPath
  }

  if (initPromise && tmuxPathEnvironmentKey === environmentKey) {
    return initPromise
  }

  tmuxPathEnvironmentKey = environmentKey
  const promiseEnvironmentKey = environmentKey
  initPromise = (async () => {
    const path = await findTmuxPath()
    if (tmuxPathEnvironmentKey === promiseEnvironmentKey) {
      tmuxPath = path
    }
    return path
  })()

  return initPromise
}

export function getCachedTmuxPath(): string | null {
  return tmuxPath
}

export function resetTmuxPathCacheForTesting(): void {
  tmuxPath = null
  initPromise = null
  tmuxPathEnvironmentKey = null
}

export function startBackgroundCheck(): void {
  if (!initPromise) {
    initPromise = getTmuxPath()
    initPromise.catch((error) => {
      if (!(error instanceof Error)) throw error
    })
  }
}

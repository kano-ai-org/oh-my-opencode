import { isAbsolute, join, normalize } from "node:path"
import { BOULDER_STATE_PATH, BOULDER_STATE_PATH_ENV } from "./constants"

function resolveConfiguredPath(directory: string): string | null {
  const configured = process.env[BOULDER_STATE_PATH_ENV]?.trim()
  if (!configured) return null
  return normalize(isAbsolute(configured) ? configured : join(directory, configured))
}

export function getBoulderFilePaths(directory: string): { primary: string; fallback: string | null } {
  const defaultPath = normalize(join(directory, BOULDER_STATE_PATH))
  const configured = resolveConfiguredPath(directory)
  if (!configured || configured === defaultPath) {
    return { primary: defaultPath, fallback: null }
  }
  return { primary: configured, fallback: defaultPath }
}

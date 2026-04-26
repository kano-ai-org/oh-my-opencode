export function normalizeSessionID(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith("ses_")) return trimmed

  const parts = trimmed.split(/[\\/]+/).filter(Boolean)
  const last = parts.at(-1)
  if (last?.startsWith("ses_")) return last

  return trimmed
}

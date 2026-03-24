import { existsSync, readFileSync } from "node:fs"
import { parseJsonc, LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../shared"
import type { DetectedConfig } from "../types"
import { getOmoConfigPath } from "./config-context"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"
import { extractVersionFromPluginEntry } from "./version-compatibility"

function detectProvidersFromOmoConfig(): {
  hasOpenAI: boolean
  hasOpencodeZen: boolean
  hasMiniMaxCodingPlan: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
  hasOpencodeGo: boolean
} {
  const omoConfigPath = getOmoConfigPath()
  if (!existsSync(omoConfigPath)) {
    return {
      hasOpenAI: true,
      hasOpencodeZen: true,
      hasMiniMaxCodingPlan: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }
  }

  try {
    const content = readFileSync(omoConfigPath, "utf-8")
    const omoConfig = parseJsonc<Record<string, unknown>>(content)
    if (!omoConfig || typeof omoConfig !== "object") {
      return {
        hasOpenAI: true,
        hasOpencodeZen: true,
        hasMiniMaxCodingPlan: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
      }
    }

    const configStr = JSON.stringify(omoConfig)
    return {
      hasOpenAI: configStr.includes('"openai/'),
      hasOpencodeZen: configStr.includes('"opencode/'),
      hasMiniMaxCodingPlan: configStr.includes('"minimax/'),
      hasZaiCodingPlan: configStr.includes('"zai-coding-plan/'),
      hasKimiForCoding: configStr.includes('"kimi-for-coding/'),
      hasOpencodeGo: configStr.includes('"opencode-go/'),
    }
  } catch {
    return {
      hasOpenAI: true,
      hasOpencodeZen: true,
      hasMiniMaxCodingPlan: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }
  }
}

function isOurPlugin(plugin: string): boolean {
  return plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`)
    || plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

function findOurPluginEntry(plugins: string[]): string | null {
  return plugins.find(isOurPlugin) ?? null
}

export function detectCurrentConfig(): DetectedConfig {
  const result: DetectedConfig = {
    isInstalled: false,
    installedVersion: null,
    hasClaude: true,
    isMax20: true,
    hasOpenAI: true,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: true,
    hasMiniMaxCodingPlan: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasOpencodeGo: false,
  }

  const { format, path } = detectConfigFormat()
  if (format === "none") {
    return result
  }

  const parseResult = parseOpenCodeConfigFileWithError(path)
  if (!parseResult.config) {
    return result
  }

  const openCodeConfig = parseResult.config
  const plugins = openCodeConfig.plugin ?? []
  const ourPluginEntry = findOurPluginEntry(plugins)
  result.isInstalled = !!ourPluginEntry

  if (ourPluginEntry) {
    result.installedVersion = extractVersionFromPluginEntry(ourPluginEntry)
  }

  if (!result.isInstalled) {
    return result
  }

  const providers = openCodeConfig.provider as Record<string, unknown> | undefined
  result.hasGemini = providers ? "google" in providers : false

  const {
    hasOpenAI,
    hasOpencodeZen,
    hasMiniMaxCodingPlan,
    hasZaiCodingPlan,
    hasKimiForCoding,
    hasOpencodeGo,
  } = detectProvidersFromOmoConfig()
  result.hasOpenAI = hasOpenAI
  result.hasOpencodeZen = hasOpencodeZen
  result.hasMiniMaxCodingPlan = hasMiniMaxCodingPlan
  result.hasZaiCodingPlan = hasZaiCodingPlan
  result.hasKimiForCoding = hasKimiForCoding
  result.hasOpencodeGo = hasOpencodeGo

  return result
}

import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, NON_INTERACTIVE_ENV, SHELL_COMMAND_PATTERNS } from "./constants"
import { log } from "../../shared"

export * from "./constants"
export * from "./detector"
export * from "./types"

const BANNED_COMMAND_PATTERNS = SHELL_COMMAND_PATTERNS.banned
  .filter((command) => !command.includes("("))
  .map((cmd) => new RegExp(`\\b${cmd}\\b`))

function detectBannedCommand(command: string): string | undefined {
  for (let i = 0; i < BANNED_COMMAND_PATTERNS.length; i++) {
    if (BANNED_COMMAND_PATTERNS[i].test(command)) {
      return SHELL_COMMAND_PATTERNS.banned[i]
    }
  }
  return undefined
}

function isGitShellCommand(command: string): boolean {
  return /(?:^|(?:&&|\|\||[;|&(])\s*)git(?:\s|$)/.test(command)
}

export function createNonInteractiveEnvHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "bash") {
        return
      }

      const command = output.args.command as string | undefined
      if (!command) {
        return
      }

      const bannedCmd = detectBannedCommand(command)
      if (bannedCmd) {
        output.message = `Warning: '${bannedCmd}' is an interactive command that may hang in non-interactive environments.`
      }

      // Only prepend env vars for git commands (editor blocking, pager, etc.)
      const isGitCommand = isGitShellCommand(command)
      if (!isGitCommand) {
        return
      }

      // NOTE: We intentionally removed the isNonInteractive() check here.
      // Even when OpenCode runs in a TTY, the agent cannot interact with
      // spawned bash processes. Git commands like `git rebase --continue`
      // would open editors (vim/nvim) that hang forever.
      // The env vars (GIT_EDITOR=:, EDITOR=:, etc.) must ALWAYS be injected
      // for git commands to prevent interactive prompts.

      output.args.env = {
        ...(output.args.env && typeof output.args.env === "object" ? output.args.env as Record<string, string> : {}),
        ...NON_INTERACTIVE_ENV,
      }

      log(`[${HOOK_NAME}] Prepended non-interactive env vars to git command`, {
        sessionID: input.sessionID,
        envKeys: Object.keys(NON_INTERACTIVE_ENV),
      })
    },
  }
}

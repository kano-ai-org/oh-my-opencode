import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createNonInteractiveEnvHook, NON_INTERACTIVE_ENV } from "./index"

describe("non-interactive-env hook", () => {
  const mockCtx = {} as Parameters<typeof createNonInteractiveEnvHook>[0]

  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      SHELL: process.env.SHELL,
      PSModulePath: process.env.PSModulePath,
      MSYSTEM: process.env.MSYSTEM,
      CI: process.env.CI,
      OPENCODE_NON_INTERACTIVE: process.env.OPENCODE_NON_INTERACTIVE,
    }
    // given clean Unix-like environment for all tests
    // This prevents CI environments (which may have PSModulePath set) from
    // triggering PowerShell detection in tests that expect Unix behavior
    delete process.env.PSModulePath
    process.env.SHELL = "/bin/bash"
    process.env.OPENCODE_NON_INTERACTIVE = "true"
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe("git command modification", () => {
    test("#given git command #when hook executes #then prepends export statement", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git commit -m 'test'")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given chained git commands #when hook executes #then env is attached without changing command", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git add file && git rebase --continue" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git add file && git rebase --continue")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given non-git bash command #when hook executes #then command unchanged", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "ls -la" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("ls -la")
    })

    test("#given command containing git as plain text #when hook executes #then env is not injected", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "printf 'git status'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("printf 'git status'")
      expect(output.args.env).toBeUndefined()
    })

    test("#given non-bash tool #when hook executes #then command unchanged", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "Read", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
    })

    test("#given empty command #when hook executes #then no error", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: {},
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBeUndefined()
    })

    test("#given git command with existing env #when hook executes again #then merges idempotently", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output1: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }
      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output1
      )

      const output2: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'", env: output1.args.env },
      }
      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "2" },
        output2
      )

      expect(output2.args.command).toBe("git commit -m 'test'")
      expect(output2.args.env).toEqual(output1.args.env)
    })
  })

  describe("shell escaping", () => {
    test("#given git command #when hook executes #then VISUAL is present in env", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect((output.args.env as Record<string, string>).VISUAL).toBe("")
    })

    test("#given git command #when hook executes #then all NON_INTERACTIVE_ENV vars included", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git log" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const env = output.args.env as Record<string, string>
      for (const key of Object.keys(NON_INTERACTIVE_ENV)) {
        expect(env).toHaveProperty(key, NON_INTERACTIVE_ENV[key])
      }
    })
  })

  describe("banned command detection", () => {
    test("#given vim command #when hook executes #then warning message set", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "vim file.txt" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.message).toContain("vim")
      expect(output.message).toContain("interactive")
    })

    test("#given safe command #when hook executes #then no warning", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "ls -la" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.message).toBeUndefined()
    })
  })

  describe("platform-aware shell syntax", () => {
    test("#given macOS platform #when git command executes #then command stays unchanged and env is attached", async () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/bin/zsh"
      Object.defineProperty(process, "platform", { value: "darwin" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given Linux platform #when git command executes #then command stays unchanged and env is attached", async () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/bin/bash"
      Object.defineProperty(process, "platform", { value: "linux" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git commit -m 'test'")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given Windows with PowerShell env #when bash tool git command executes #then env injection stays shell-agnostic", async () => {
      delete process.env.SHELL
      delete process.env.MSYSTEM
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given Windows without SHELL env #when bash tool git command executes #then env injection stays shell-agnostic", async () => {
      delete process.env.PSModulePath
      delete process.env.SHELL
      delete process.env.MSYSTEM
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git log" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git log")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given Windows Git Bash environment #when git command executes #then env injection stays shell-agnostic", async () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/usr/bin/bash"
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given Windows Git Bash via MSYSTEM without SHELL #when git command executes #then env injection stays shell-agnostic", async () => {
      delete process.env.SHELL
      process.env.MSYSTEM = "MINGW64"
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given Windows platform #when chained git commands via bash tool #then command stays unchanged and env is attached", async () => {
      delete process.env.PSModulePath
      delete process.env.SHELL
      delete process.env.MSYSTEM
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git add file && git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git add file && git commit -m 'test'")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given SHELL=/bin/bash on win32 #when git command executes #then env injection stays shell-agnostic", async () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/bin/bash"
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given PSModulePath set on non-Windows #when git command executes #then env injection stays shell-agnostic", async () => {
      delete process.env.SHELL
      delete process.env.MSYSTEM
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      Object.defineProperty(process, "platform", { value: "linux" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git log" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git log")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given no SHELL and no PSModulePath on win32 #when git command executes #then env injection stays shell-agnostic", async () => {
      // Platform fallback: win32 without env hints should use cmd
      delete process.env.SHELL
      delete process.env.PSModulePath
      delete process.env.MSYSTEM
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })

    test("#given no SHELL and no PSModulePath on linux #when git command executes #then env injection stays shell-agnostic", async () => {
      delete process.env.SHELL
      delete process.env.PSModulePath
      Object.defineProperty(process, "platform", { value: "linux" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
      expect(output.args.env).toMatchObject(NON_INTERACTIVE_ENV)
    })
  })
})

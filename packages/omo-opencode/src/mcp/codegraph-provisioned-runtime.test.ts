/// <reference types="bun-types" />

import { expect, test } from "bun:test"

import { createCodegraphMcpConfig } from "./codegraph"

test("#given a provisioned CodeGraph bundle and an unsupported host Node #when creating the MCP config #then it stays enabled", () => {
  // given
  const codegraphPath = "/opt/omo/codegraph/bin/codegraph"

  // when
  const config = createCodegraphMcpConfig({
    cwd: "/workspace/project",
    config: { enabled: true },
    env: {},
    fileExists: (filePath) => filePath === codegraphPath,
    homeDir: "/tmp/omo-codegraph-test-home",
    nodeVersionForExecutable: () => "26.3.0",
    provisioned: () => codegraphPath,
    requireResolve: () => {
      throw new Error("bundled package absent")
    },
    resolveExecutable: (commandName) => ({ command: commandName, available: false }),
  })

  // then
  expect(config.command).toEqual([codegraphPath, "serve", "--mcp"])
  expect(config.enabled).toBe(true)
})

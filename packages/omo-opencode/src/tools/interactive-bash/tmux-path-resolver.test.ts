/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const temporaryDirectories: string[] = []
const originalPath = process.env.PATH
const resolverModuleUrl = new URL("./tmux-path-resolver.ts", import.meta.url).href

async function createTemporaryDirectory(): Promise<string> {
	const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmux-path-resolver-"))
	temporaryDirectories.push(directoryPath)
	return directoryPath
}

async function createExecutable(
	directoryPath: string,
	name: string,
	posixScript: string,
	windowsScript = "@echo off\r\nexit /b 0\r\n",
): Promise<string> {
	const executablePath = path.join(directoryPath, process.platform === "win32" ? `${name}.cmd` : name)
	if (process.platform === "win32") {
		await fs.writeFile(executablePath, windowsScript, "utf8")
		return executablePath
	}

	await fs.writeFile(executablePath, posixScript, "utf8")
	await fs.chmod(executablePath, 0o755)
	return executablePath
}

function resolveTmuxPathInChild(pathValue: string, overrides: NodeJS.ProcessEnv = {}): string | null {
	const environment = { ...process.env }
	for (const key of Object.keys(environment)) {
		if (key.toLowerCase() === "path") delete environment[key]
	}
	delete environment.CMUX_SOCKET_PATH
	delete environment.TMUX
	environment.PATH = pathValue
	Object.assign(environment, overrides)

	const child = Bun.spawnSync(
		[
			process.execPath,
			"--eval",
			`const { getTmuxPath } = await import(${JSON.stringify(resolverModuleUrl)}); process.stdout.write((await getTmuxPath()) ?? "")`,
		],
		{ env: environment, stdout: "pipe", stderr: "pipe" },
	)

	expect(child.stderr.toString()).toBe("")
	expect(child.exitCode).toBe(0)
	return child.stdout.toString().trim() || null
}

afterAll(async () => {
	for (const directoryPath of temporaryDirectories) {
		await fs.rm(directoryPath, { recursive: true, force: true })
	}
})

describe("getTmuxPath", () => {
	test("#given cmux environment #when cmux is available #then returns cmux without requiring a real tmux binary", async () => {
		// given
		const temporaryDirectory = await createTemporaryDirectory()
		const cmuxPath = await createExecutable(temporaryDirectory, "cmux", "#!/bin/sh\nexit 0\n")
		await createExecutable(temporaryDirectory, "tmux", "#!/bin/sh\nexit 1\n")
		const fixturePath = `${temporaryDirectory}${path.delimiter}${originalPath ?? ""}`

		// when
		const resolvedPath = resolveTmuxPathInChild(fixturePath, {
			CMUX_SOCKET_PATH: path.join(temporaryDirectory, "cmux.sock"),
		})

		// then
		expect(path.basename(resolvedPath ?? "")).toBe(path.basename(cmuxPath))
	})

	test("#given unsupported tmux precedes modern tmux on PATH #when resolved #then skips the unsupported candidate", async () => {
		// given
		const unsupportedDirectory = await createTemporaryDirectory()
		const modernDirectory = await createTemporaryDirectory()
		await createExecutable(
			unsupportedDirectory,
			"tmux",
			'#!/bin/sh\n[ "$1" = "-V" ] && printf "tmux 0.1.0\\n"\nexit 0\n',
			'@echo off\r\nif "%~1"=="-V" echo tmux 0.1.0\r\nexit /b 0\r\n',
		)
		const modernTmuxPath = await createExecutable(
			modernDirectory,
			"tmux",
			'#!/bin/sh\n[ "$1" = "-V" ] && printf "tmux 3.3a\\n"\nexit 0\n',
			'@echo off\r\nif "%~1"=="-V" echo tmux 3.3a\r\nexit /b 0\r\n',
		)
		const fixturePath = [unsupportedDirectory, modernDirectory, originalPath ?? ""].join(path.delimiter)

		// when
		const resolvedPath = resolveTmuxPathInChild(fixturePath)

		// then
		const resolvedRealPath = await fs.realpath(resolvedPath ?? "")
		const modernRealPath = await fs.realpath(modernTmuxPath)
		expect(resolvedRealPath.toLowerCase()).toBe(modernRealPath.toLowerCase())
	})
})

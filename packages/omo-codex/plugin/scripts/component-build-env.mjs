export function createComponentBuildEnv(env = process.env, platform = process.platform) {
	const result = { ...env };
	if (platform !== "win32") return result;

	for (const key of Object.keys(result)) {
		if (key.toLowerCase() !== "path" || typeof result[key] !== "string") continue;
		result[key] = result[key]
			.split(";")
			.filter((entry) => !isNodeModulesBin(entry))
			.join(";");
	}
	return result;
}

function isNodeModulesBin(entry) {
	const normalized = entry.trim().replace(/^"(.*)"$/, "$1").replace(/[\\/]+$/, "");
	return /(?:^|[\\/])node_modules[\\/]\.bin$/i.test(normalized);
}

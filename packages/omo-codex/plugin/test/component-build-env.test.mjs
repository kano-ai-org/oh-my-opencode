import assert from "node:assert/strict";
import test from "node:test";

import { createComponentBuildEnv } from "../scripts/component-build-env.mjs";

test("#given a Windows npm lifecycle PATH #when creating a component build env #then inherited node_modules bins are removed", () => {
	const env = {
		Path: 'C:\\repo\\node_modules\\.bin;"C:\\repo\\packages\\plugin\\node_modules\\.bin";C:\\Program Files\\nodejs;C:\\Windows\\System32;C:/repo/packages/component/node_modules/.bin/',
		OMO_FLAG: "enabled",
	};

	const result = createComponentBuildEnv(env, "win32");

	assert.deepEqual(result, {
		Path: "C:\\Program Files\\nodejs;C:\\Windows\\System32",
		OMO_FLAG: "enabled",
	});
});

test("#given a non-Windows PATH #when creating a component build env #then PATH is unchanged", () => {
	const env = { PATH: "/repo/node_modules/.bin:/usr/local/bin:/usr/bin" };

	assert.deepEqual(createComponentBuildEnv(env, "linux"), env);
});

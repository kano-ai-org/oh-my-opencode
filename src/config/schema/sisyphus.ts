import { z } from "zod"

export const SisyphusTasksConfigSchema = z.object({
  /** Absolute or relative storage path override. When set, bypasses global config dir. */
  storage_path: z.string().optional(),
  /** Force task list ID (alternative to env ULTRAWORK_TASK_LIST_ID) */
  task_list_id: z.string().optional(),
  /** Enable Claude Code path compatibility mode */
  claude_code_compat: z.boolean().default(false),
})

export const SisyphusConfigSchema = z.object({
  tasks: SisyphusTasksConfigSchema.optional(),
  plan_provider: z.enum(["backlog", "sisyphus", "auto"]).optional(),
  backlog_topic_agent: z.string().optional(),
  backlog_topic_plan_file: z.string().optional(),
})

export type SisyphusTasksConfig = z.infer<typeof SisyphusTasksConfigSchema>
export type SisyphusConfig = z.infer<typeof SisyphusConfigSchema>

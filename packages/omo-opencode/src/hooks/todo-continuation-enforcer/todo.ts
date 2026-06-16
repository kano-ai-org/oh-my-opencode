import type { Todo } from "./types"

const TERMINAL_TODO_STATUSES = new Set(["completed", "cancelled", "blocked", "deleted"])

const USER_INPUT_BLOCKER_PATTERNS = [
  /\bblocked\s+(?:on|by)\s+user\b/i,
  /\bawait(?:ing)?\s+user\b/i,
  /\bwaiting\s+for\s+user\b/i,
  /\brequires?\s+user\s+(?:input|approval|confirmation)\b/i,
  /\brequired\s+user\s+(?:input|approval|confirmation)\b/i,
  /\buser\s+(?:approval|confirmation)\s+gate\b/i,
  /\bpost[-\s]verification\s+user\s+approval\s+gate\b/i,
  /\buser\s+must\s+explicitly\s+say\b/i,
  /\bmust\s+explicitly\s+say\s+["']?(?:okay|ok)["']?\b/i,
]

export function isUserInputBlockedTodo(todo: Todo): boolean {
  return USER_INPUT_BLOCKER_PATTERNS.some((pattern) => pattern.test(todo.content))
}

export function isActionableTodo(todo: Todo): boolean {
  return !TERMINAL_TODO_STATUSES.has(todo.status) && !isUserInputBlockedTodo(todo)
}

export function getIncompleteCount(todos: Todo[]): number {
  return todos.filter(isActionableTodo).length
}

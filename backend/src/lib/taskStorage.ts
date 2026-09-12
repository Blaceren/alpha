import type { MockTask } from "@/types/tasks";

export const TASK_CHAIN_STORAGE_KEY = "trading-platform-task-chain";
export const TASK_CHAIN_CHANGE_EVENT = "task-chain-change";

function isTaskList(value: unknown): value is MockTask[] {
  return Array.isArray(value) && value.every(
    (item) => typeof item === "object" && item !== null && "id" in item && "status" in item,
  );
}

export function readStoredTasks(fallbackTasks: MockTask[]) {
  if (typeof window === "undefined") return fallbackTasks;
  const rawTasks = window.localStorage.getItem(TASK_CHAIN_STORAGE_KEY);
  if (!rawTasks) return fallbackTasks;

  try {
    const parsedTasks = JSON.parse(rawTasks);
    return isTaskList(parsedTasks) ? parsedTasks : fallbackTasks;
  } catch {
    return fallbackTasks;
  }
}

export function writeStoredTasks(tasks: MockTask[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TASK_CHAIN_STORAGE_KEY, JSON.stringify(tasks));
  window.dispatchEvent(new Event(TASK_CHAIN_CHANGE_EVENT));
}

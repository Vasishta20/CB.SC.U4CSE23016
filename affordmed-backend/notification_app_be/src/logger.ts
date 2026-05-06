import axios from "axios";

const LOG_API_URL = process.env.AFFORDMED_LOG_API_URL ?? "http://20.207.122.201/evaluation-service/logs";
const ACCESS_TOKEN = process.env.AFFORDMED_TOKEN;

export type Stack = "backend" | "frontend";
export type Level = "debug" | "info" | "warn" | "error" | "fatal";
export type Package =
  | "cache" | "controller" | "cron_job" | "db" | "domain"
  | "handler" | "repository" | "route" | "service"
  | "api" | "component" | "hook" | "page" | "state" | "style"
  | "auth" | "config" | "middleware" | "utils";

export async function Log(
  stack: Stack,
  level: Level,
  pkg: Package,
  message: string
): Promise<void> {
  if (!ACCESS_TOKEN) {
    return;
  }

  try {
    await axios.post(
      LOG_API_URL,
      { stack, level, package: pkg, message },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch {
    // Never crash the app due to a logging failure
  }
}

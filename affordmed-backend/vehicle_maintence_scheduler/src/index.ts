import "dotenv/config";
import axios from "axios";
import { mkdir, writeFile } from "node:fs/promises";
import { Log } from "../../logging_middleware/dist/index";

const BASE_URL = process.env.AFFORDMED_BASE_URL ?? "http://20.207.122.201/evaluation-service";
const TOKEN = process.env.AFFORDMED_TOKEN;
const OUTPUT_FILE =
  process.env.VEHICLE_MAINTENCE_SCHEDULER_OUTPUT_FILE ??
  process.env.VEHICLE_SCHEDULING_OUTPUT_FILE ??
  "outputs/vehicle_maintence_scheduler_output.txt";

if (!TOKEN) {
  throw new Error("Missing AFFORDMED_TOKEN. Export a fresh token and rerun.");
}

const headers = { Authorization: `Bearer ${TOKEN}` };

interface Depot { ID: number; MechanicHours: number; }
interface Vehicle { TaskID: string; Duration: number; Impact: number; }

interface DepotReport {
  depotID: number;
  budget: number;
  hoursUsed: number;
  totalImpact: number;
  selected: Vehicle[];
}

async function fetchDepots(): Promise<Depot[]> {
  await Log("backend", "info", "service", "Fetching depots from evaluation API");
  try {
    const res = await axios.get(`${BASE_URL}/depots`, { headers });
    const depots: Depot[] = res.data.depots;
    await Log("backend", "info", "service", `Fetched ${depots.length} depots successfully`);
    return depots;
  } catch (err: any) {
    await Log("backend", "error", "service", `Depot fetch failed: ${err.message}`);
    throw err;
  }
}

async function fetchVehicles(): Promise<Vehicle[]> {
  await Log("backend", "info", "service", "Fetching vehicle tasks from evaluation API");
  try {
    const res = await axios.get(`${BASE_URL}/vehicles`, { headers });
    const vehicles: Vehicle[] = res.data.vehicles;
    await Log("backend", "info", "service", `Fetched ${vehicles.length} vehicle tasks successfully`);
    return vehicles;
  } catch (err: any) {
    await Log("backend", "error", "service", `Vehicle fetch failed: ${err.message}`);
    throw err;
  }
}

function knapsack(vehicles: Vehicle[], capacity: number): { selected: Vehicle[]; totalImpact: number } {
  const n = vehicles.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = vehicles[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }

  const selected: Vehicle[] = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }

  return { selected, totalImpact: dp[n][capacity] };
}

async function main(): Promise<void> {
  await Log("backend", "info", "handler", "Vehicle Maintenance Scheduler started");
  try {
    const [depots, vehicles] = await Promise.all([fetchDepots(), fetchVehicles()]);
    const reports: DepotReport[] = [];

    for (const depot of depots) {
      await Log("backend", "info", "service", `Running knapsack for Depot ${depot.ID} - budget: ${depot.MechanicHours}h`);
      const { selected, totalImpact } = knapsack(vehicles, depot.MechanicHours);
      const hoursUsed = selected.reduce((s, v) => s + v.Duration, 0);
      await Log("backend", "info", "service", `Depot ${depot.ID} - tasks: ${selected.length}, impact: ${totalImpact}, hours: ${hoursUsed}/${depot.MechanicHours}`);
      reports.push({
        depotID: depot.ID,
        budget: depot.MechanicHours,
        hoursUsed,
        totalImpact,
        selected,
      });
    }

    const lines: string[] = [];
    lines.push("VEHICLE MAINTENANCE SCHEDULER");
    lines.push(`GeneratedAt: ${new Date().toISOString()}`);
    lines.push("");

    for (const report of reports) {
      lines.push("=".repeat(72));
      lines.push(`Depot ${report.depotID} | Budget: ${report.budget}h | Used: ${report.hoursUsed}h | TotalImpact: ${report.totalImpact}`);
      lines.push("=".repeat(72));
      report.selected.forEach((task, index) => {
        lines.push(`${index + 1}. ${task.TaskID} | Duration: ${task.Duration}h | Impact: ${task.Impact}`);
      });
      lines.push("");
    }

    await mkdir("outputs", { recursive: true });
    await writeFile(OUTPUT_FILE, `${lines.join("\n")}\n`, "utf8");
    await Log("backend", "info", "handler", `Vehicle scheduling output written to ${OUTPUT_FILE}`);
    await Log("backend", "info", "handler", "Vehicle Maintenance Scheduler completed successfully");
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401) {
      await Log("backend", "fatal", "handler", "Scheduler failed with 401 Unauthorized");
      process.exit(1);
    }

    await Log("backend", "fatal", "handler", `Scheduler crashed: ${err.message}`);
    process.exit(1);
  }
}

main();

import "dotenv/config"
import axios from "axios"
import { mkdir, writeFile } from "node:fs/promises"
import { Log } from "./logger"

const TOKEN = process.env.AFFORDMED_TOKEN
const NOTIF_URL = "http://20.207.122.201/evaluation-service/notifications"
const OUTPUT_FILE = process.env.PRIORITY_INBOX_OUTPUT_FILE ?? "outputs/priority_inbox_top10.txt"

if (!TOKEN) {
  throw new Error("Missing AFFORDMED_TOKEN. Set it in .env or export it before running.")
}

// placement is most important, then result, event is lowest
const typeWeight: any = {
  Placement: 3,
  Result: 2,
  Event: 1
}

function scoreOf(n: any): number {
  // multiply weight by big number so type always wins over recency
  // then add timestamp ms to break ties by recency
  const ts = new Date(n.Timestamp.replace(" ", "T")).getTime()
  return typeWeight[n.Type] * 1_000_000_000_000 + ts
}

// min-heap - keeps the weakest of top-N at root
// when new item comes in: if score > root score, kick root out and add new one
class MinHeap {
  items: any[] = []
  capacity: number

  constructor(cap: number) {
    this.capacity = cap
  }

  insert(item: any) {
    this.items.push(item)
    this.bubbleUp(this.items.length - 1)
  }

  removeMin() {
    const min = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0) {
      this.items[0] = last
      this.siftDown(0)
    }
    return min
  }

  minScore() {
    return this.items.length > 0 ? this.items[0].score : -Infinity
  }

  bubbleUp(i: number) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2)
      if (this.items[p].score <= this.items[i].score) break
      ;[this.items[p], this.items[i]] = [this.items[i], this.items[p]]
      i = p
    }
  }

  siftDown(i: number) {
    const n = this.items.length
    while (true) {
      let smallest = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && this.items[l].score < this.items[smallest].score) smallest = l
      if (r < n && this.items[r].score < this.items[smallest].score) smallest = r
      if (smallest === i) break
      ;[this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]]
      i = smallest
    }
  }
}

async function main() {
  await Log("backend", "info", "handler", "starting priority inbox - getting top 10 notifications")

  const res = await axios.get(NOTIF_URL, {
    headers: { "Authorization": "Bearer " + TOKEN }
  })

  const notifs = res.data.notifications
  await Log("backend", "info", "service", `fetched ${notifs.length} notifications, finding top 10`)

  const heap = new MinHeap(10)

  for (const n of notifs) {
    const item = { ...n, score: scoreOf(n) }
    if (heap.items.length < heap.capacity) {
      heap.insert(item)
    } else if (item.score > heap.minScore()) {
      heap.removeMin()
      heap.insert(item)
    }
    // else not in top 10, skip
  }

  // sort descending for printing
  const top10 = heap.items.sort((a: any, b: any) => b.score - a.score)

  await Log("backend", "info", "handler", "top 10 ready, printing results")
  const lines: string[] = []
  lines.push("TOP 10 PRIORITY NOTIFICATIONS")
  lines.push(`GeneratedAt: ${new Date().toISOString()}`)
  lines.push("PriorityOrder: Placement > Result > Event (newer first within same type)")
  lines.push("")

  top10.forEach((item: any, i: number) => {
    lines.push(`${i + 1}. [${item.Type}] ${item.Message}`)
    lines.push(`   id: ${item.ID}`)
    lines.push(`   time: ${item.Timestamp}`)
    lines.push("")
  })

  await mkdir("outputs", { recursive: true })
  await writeFile(OUTPUT_FILE, `${lines.join("\n")}\n`, "utf8")
  await Log("backend", "info", "handler", `Priority inbox output written to ${OUTPUT_FILE}`)
}

main().catch(async (err: any) => {
  const status = err?.response?.status
  if (status === 401) {
    await Log("backend", "fatal", "handler", "priority inbox failed with 401 Unauthorized")
    process.exit(1)
  }

  await Log("backend", "error", "handler", "priority inbox crashed: " + err.message)
  process.exit(1)
})

# Notification System Design

## Stage 1
### 1) Core actions supported
- Publish notification to one student.
- Publish notification to many students (bulk).
- Publish notification to all students.
- List notifications for a student (with pagination and filters).
- Mark one notification as read.
- Mark all unread notifications as read.
- Get unread count for badge.
- Real-time delivery to active clients.
- Retry failed delivery attempts.

### 2) Naming conventions
- Resource names are plural nouns: `notifications`, `students`, `subscriptions`.
- Fields use `camelCase`.
- Primary IDs use `UUID` strings.
- Timestamps use ISO-8601 UTC.
- Response envelope uses `{ data, meta, error }`.

### 3) API contract
Base URL:
- `/api/v1`

Headers:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `X-Request-Id: <uuid>` (optional, recommended)

#### Create notification (single target)
`POST /api/v1/notifications`

Request body:
```json
{
  "recipientStudentId": "a1b2c3d4-0000-1111-2222-abcdefabcdef",
  "notificationType": "Placement",
  "title": "Placement Drive",
  "message": "CSX Corporation hiring",
  "priorityScore": 0.95,
  "metadata": {
    "company": "CSX Corporation",
    "deadline": "2026-05-20T10:00:00Z"
  }
}
```

Response `201`:
```json
{
  "data": {
    "notificationId": "8d95ac64-8e5d-4d72-991a-c03aa2b3647c",
    "recipientStudentId": "a1b2c3d4-0000-1111-2222-abcdefabcdef",
    "notificationType": "Placement",
    "title": "Placement Drive",
    "message": "CSX Corporation hiring",
    "isRead": false,
    "createdAt": "2026-05-06T10:20:30Z"
  },
  "meta": {
    "requestId": "f4da5db1-8f98-49ef-bf79-b3e8af708f77"
  },
  "error": null
}
```

#### Create notification (bulk)
`POST /api/v1/notifications/bulk`

Request body:
```json
{
  "recipientStudentIds": [
    "id-1",
    "id-2",
    "id-3"
  ],
  "notificationType": "Event",
  "title": "Tech Fest",
  "message": "Registration open",
  "metadata": {
    "eventId": "evt-2026-001"
  }
}
```

Response `202`:
```json
{
  "data": {
    "jobId": "job-94688f09-7a56-4fca-9914-9439ac4dc331",
    "acceptedRecipients": 3
  },
  "meta": {},
  "error": null
}
```

#### Notify all students
`POST /api/v1/notifications/broadcast`

Request body:
```json
{
  "notificationType": "Result",
  "title": "Mid-Sem Result",
  "message": "Results published",
  "metadata": {
    "semester": "S6"
  }
}
```

Response `202`:
```json
{
  "data": {
    "jobId": "job-broadcast-f4fd7a27-56a6-46cd-95d4-4c5788e1cdb5"
  },
  "meta": {},
  "error": null
}
```

#### Get student notifications
`GET /api/v1/students/{studentId}/notifications?isRead=false&type=Placement&limit=20&cursor=abc`

Response `200`:
```json
{
  "data": [
    {
      "notificationId": "8d95ac64-8e5d-4d72-991a-c03aa2b3647c",
      "studentId": "a1b2c3d4-0000-1111-2222-abcdefabcdef",
      "notificationType": "Placement",
      "title": "Placement Drive",
      "message": "CSX Corporation hiring",
      "isRead": false,
      "createdAt": "2026-05-06T10:20:30Z"
    }
  ],
  "meta": {
    "nextCursor": "cursor-token",
    "limit": 20
  },
  "error": null
}
```

#### Mark one notification read
`PATCH /api/v1/notifications/{notificationId}/read`

Response `200`:
```json
{
  "data": {
    "notificationId": "8d95ac64-8e5d-4d72-991a-c03aa2b3647c",
    "isRead": true,
    "readAt": "2026-05-06T10:24:00Z"
  },
  "meta": {},
  "error": null
}
```

#### Mark all read for one student
`PATCH /api/v1/students/{studentId}/notifications/read-all`

Response `200`:
```json
{
  "data": {
    "updatedCount": 18
  },
  "meta": {},
  "error": null
}
```

#### Unread count
`GET /api/v1/students/{studentId}/notifications/unread-count`

Response `200`:
```json
{
  "data": {
    "studentId": "a1b2c3d4-0000-1111-2222-abcdefabcdef",
    "unreadCount": 18
  },
  "meta": {},
  "error": null
}
```

### 4) Real-time notification mechanism
- Use WebSocket or Server-Sent Events (SSE) channel:
  - `GET /api/v1/realtime/stream` (SSE)
  - Auth via bearer token.
- Backend publishes per-student events to Redis Pub/Sub topic:
  - Topic: `student:{studentId}:notifications`
- Event payload:
```json
{
  "eventType": "notification.created",
  "notificationId": "8d95ac64-8e5d-4d72-991a-c03aa2b3647c",
  "notificationType": "Placement",
  "title": "Placement Drive",
  "message": "CSX Corporation hiring",
  "createdAt": "2026-05-06T10:20:30Z"
}
```

## Stage 2
### 1) Recommended persistent storage
- PostgreSQL is recommended.

Why:
- Strong consistency and ACID transactions for read/unread updates.
- Mature indexing for unread and timeline queries.
- Good support for partitioning and JSONB metadata.
- Clear operational model for campus-scale workloads.

### 2) Schema
```sql
CREATE TYPE notification_type AS ENUM ('Event', 'Result', 'Placement');

CREATE TABLE students (
  student_id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  notification_type notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_notifications_student_read_created
  ON notifications (student_id, is_read, created_at DESC);

CREATE INDEX idx_notifications_type_created
  ON notifications (notification_type, created_at DESC);

CREATE INDEX idx_notifications_student_created
  ON notifications (student_id, created_at DESC);
```

### 3) Scale issues and fixes
Problems:
- Slow scans on `student_id + unread + recent` queries.
- Hot partitions for large broadcast spikes.
- High write pressure during Notify-All.

Fixes:
- Composite indexes tuned for top API queries.
- Table partitioning by month (`created_at`) for large tables.
- Asynchronous job queue for bulk insertion/delivery.
- Cursor-based pagination instead of offset pagination.

### 4) Example queries aligned to Stage 1 APIs
Get unread notifications for a student:
```sql
SELECT notification_id, notification_type, title, message, is_read, created_at
FROM notifications
WHERE student_id = $1 AND is_read = FALSE
ORDER BY created_at DESC
LIMIT $2;
```

Unread count:
```sql
SELECT COUNT(*) AS unread_count
FROM notifications
WHERE student_id = $1 AND is_read = FALSE;
```

Mark one as read:
```sql
UPDATE notifications
SET is_read = TRUE, read_at = NOW()
WHERE notification_id = $1
RETURNING notification_id, is_read, read_at;
```

Mark all as read:
```sql
UPDATE notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND is_read = FALSE;
```

## Stage 3
Given query:
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### 1) Is it accurate? Why slow?
- Logical intent is correct (unread for one student, newest first).
- Slow because:
  - No `LIMIT`, so it may sort many rows.
  - `SELECT *` returns unnecessary columns and increases I/O.
  - If no matching composite index exists, DB scans/sorts large data.

### 2) What to change and likely cost
Use:
```sql
SELECT notification_id, notification_type, title, message, created_at
FROM notifications
WHERE student_id = $1 AND is_read = FALSE
ORDER BY created_at DESC
LIMIT 50;
```

Required index:
```sql
CREATE INDEX idx_notifications_student_read_created
ON notifications (student_id, is_read, created_at DESC);
```

Likely cost:
- With index: roughly `O(log N + K)` where `K` is rows returned.
- Without index: close to `O(N log N)` for scan + sort on large sets.

### 3) Should every column be indexed?
- No.
- Indexing every column increases write cost, storage, VACUUM overhead, and can reduce cache efficiency.
- Only index query-critical columns and commonly used composite patterns.

### 4) Query: students who received Placement in last 7 days
```sql
SELECT DISTINCT student_id
FROM notifications
WHERE notification_type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days';
```

## Stage 4
Problem:
- Every page load hits DB for notifications, causing read amplification.

Recommended solution:
- Add Redis cache for unread list + unread count per student.
- Use short TTL (for example 30-60 seconds) and event-driven invalidation.
- Push real-time events so UI updates without frequent full fetches.

Performance improvements:
- Read path: cache-first (`Redis`), DB fallback.
- Write path: DB write then invalidate/update cache key.
- Use pagination/cursor to cap payload size.

Tradeoffs:
- Cache adds operational complexity and eventual-consistency windows.
- Short TTL reduces stale data but increases cache misses.
- Event-driven invalidation is accurate but needs reliable event delivery.
- Pure DB read is simpler but does not scale well for high QPS.

## Stage 5
Given pseudocode shortcomings:
- Sequential loop is slow for 50,000 students.
- Mixed side effects with no idempotency can duplicate sends.
- No retry/dead-letter workflow.
- Partial failure handling is weak (`send_email` fails midway).

If `send_email` fails for 200 students:
- Keep durable delivery state per recipient.
- Retry failed recipients with exponential backoff.
- Move permanent failures to dead-letter queue (DLQ) for manual/automated reprocessing.

Should DB save and email send be atomic together?
- Not as a distributed single transaction across DB + email API.
- Use transactional outbox pattern:
  - In one DB transaction, save notification row + outbox event.
  - Worker reads outbox and performs email/app push.
  - Mark status `SENT` or `FAILED`, retry safely with idempotency key.

Revised pseudocode:
```text
function notify_all(message, notification_type):
    job_id = create_job_record(message, notification_type)

    for each batch in stream_students(batch_size=1000):
        begin_tx()
            for student in batch:
                notification_id = insert_notification(student.id, message, notification_type, job_id)
                insert_outbox_event(
                    event_id = uuid(),
                    notification_id = notification_id,
                    student_id = student.id,
                    channel = "email_and_inapp",
                    idempotency_key = hash(job_id + student.id)
                )
        commit_tx()

    enqueue_outbox_dispatch(job_id)


worker dispatch_outbox(job_id):
    events = fetch_pending_outbox_events(job_id, limit=1000)
    for event in events in parallel_with_rate_limit:
        try:
            send_email(event.student_id, event.payload, event.idempotency_key)
            push_to_app(event.student_id, event.payload, event.idempotency_key)
            mark_outbox_sent(event.event_id)
        except transient_error:
            schedule_retry(event.event_id, backoff_policy)
        except permanent_error:
            move_to_dlq(event.event_id)
```

## Stage 6 (Implemented Code Note)
- Implemented in `notification_app_be/src/index.ts`.
- Uses Notification API (protected route), min-heap top-`n` strategy (configured for top-10), and logging middleware.
- Efficient maintenance for streaming arrivals:
  - Keep min-heap of size `n`.
  - For each new notification, compare score with heap root.
  - Replace root only when incoming score is higher.
  - Complexity per event: `O(log n)`.

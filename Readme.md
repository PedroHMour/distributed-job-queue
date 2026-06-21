# Distributed Job Queue

A production-grade distributed job queue engine built with Node.js, TypeScript, BullMQ, Redis, and PostgreSQL. Designed to demonstrate deep knowledge of resilience patterns, horizontal scalability, and distributed systems architecture.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?logo=typescript)](https://typescriptlang.org)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?logo=fastify)](https://fastify.dev)
[![BullMQ](https://img.shields.io/badge/BullMQ-5-FF6B6B)](https://docs.bullmq.io)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)](https://redis.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docker.com)

---

## Overview

This project implements a **Distributed Job Queue** capable of ingesting, routing, processing, and auditing asynchronous jobs across multiple worker instances. The system handles three distinct job types that represent the most common real-world processing patterns:

| Job Type | Pattern | Concurrency | Simulated Failure Rate |
|---|---|---|---|
| `EMAIL_DELIVERY` | I/O-bound (external SMTP) | 10 workers | 20% |
| `IMAGE_PROCESSING` | CPU-bound (resize, compress, convert) | 2 workers | 15% per operation |
| `REPORT_GENERATION` | Mixed I/O + processing | 5 workers | 25% |

The architecture enforces **PostgreSQL as the authoritative state store** — jobs are persisted before they are enqueued in Redis, ensuring zero data loss even if the message broker goes offline.

---

## Architecture

```
┌─────────────┐     POST /jobs      ┌──────────────────────────────────────┐
│   Client    │ ──────────────────▶ │            Fastify API               │
└─────────────┘                     │                                      │
                                    │  1. Validate payload (Zod)           │
                                    │  2. INSERT → PostgreSQL (PENDING)    │
                                    │  3. Enqueue → Redis/BullMQ           │
                                    │  4. Return 202 Accepted              │
                                    └──────────────┬───────────────────────┘
                                                   │
                                    ┌──────────────▼───────────────────────┐
                                    │              Redis                   │
                                    │   email-delivery queue               │
                                    │   image-processing queue             │
                                    │   report-generation queue            │
                                    │   dead-letter queue                  │
                                    └──────────────┬───────────────────────┘
                                                   │
                          ┌────────────────────────┼────────────────────────┐
                          ▼                        ▼                        ▼
                   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
                   │  Worker 1   │         │  Worker 2   │         │  Worker 3   │
                   └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
                          │                       │                        │
                          └───────────────────────▼────────────────────────┘
                                                  │
                                    ┌─────────────▼───────────────────────┐
                                    │           PostgreSQL                 │
                                    │   job_executions table               │
                                    │   dead_letter_entries table          │
                                    └─────────────────────────────────────┘
```

### Resilience: The Outbox Pattern

When Redis is unavailable at ingestion time, the API still returns `202 Accepted`. The job is safely stored in PostgreSQL with `status = PENDING`. A maintenance worker (cron) is responsible for re-enqueuing orphaned PENDING jobs, ensuring no work is lost.

```
Redis online  → INSERT Postgres (PENDING) → Enqueue BullMQ → UPDATE bullmqJobId → 202
Redis offline → INSERT Postgres (PENDING) → catch error    → log warning        → 202
```

### Job Lifecycle

```
PENDING → ACTIVE → COMPLETED
                ↘
                  RETRYING (exponential backoff: 1s → 2s → 4s)
                       ↘
                         DEAD → DeadLetterEntry (full failure history)
```

---

## Project Structure

```
distributed-job-queue/
├── apps/
│   ├── api/                        # Fastify HTTP server
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── prisma.ts       # PrismaClient singleton
│   │       │   └── queues.ts       # BullMQ Queue instances
│   │       ├── plugins/
│   │       │   └── error-handler.ts
│   │       ├── routes/
│   │       │   └── jobs.route.ts   # POST /jobs, GET /jobs, GET /jobs/:id
│   │       ├── schemas/
│   │       │   └── job.schema.ts   # Zod discriminated union schemas
│   │       └── index.ts            # Bootstrap, graceful shutdown
│   │
│   └── worker/                     # BullMQ consumer process
│       └── src/
│           ├── handlers/
│           │   └── job.handler.ts  # Orchestrates full job lifecycle
│           ├── lib/
│           │   ├── job-state.ts    # All Postgres state transitions
│           │   ├── logger.ts       # Pino with workerInstanceId
│           │   └── prisma.ts
│           ├── processors/
│           │   ├── email.processor.ts
│           │   ├── image.processor.ts
│           │   └── report.processor.ts
│           └── index.ts            # Worker bootstrap, concurrency config
│
├── packages/
│   └── shared/                     # Shared types, configs, Prisma schema
│       ├── prisma/
│       │   └── schema.prisma
│       └── src/
│           ├── config/
│           │   ├── queue.config.ts # Queue names, retry options
│           │   └── redis.config.ts # Redis connection with retry strategy
│           └── types/
│               └── job.types.ts    # JobType, JobStatus, payload interfaces
│
├── docker-compose.yml
├── apps/api/Dockerfile
└── apps/worker/Dockerfile
```

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Runtime | Node.js 20 | LTS, native `crypto.randomUUID()`, top-level await |
| Language | TypeScript 5.4 | Strict mode, discriminated unions for type-safe job routing |
| HTTP Framework | Fastify 4 | ~3× faster than Express, native async support, structured logging |
| Validation | Zod 3 | Runtime type safety with schema inference, discriminated union support |
| Job Queue | BullMQ 5 | Redis-backed, atomic job locking, exponential backoff, DLQ built-in |
| Message Broker | Redis 7 | In-memory speed, persistence (`--save`), LRU eviction policy |
| ORM | Prisma 5 | Type-safe queries, migration tooling, advisory locks for safe deploys |
| Database | PostgreSQL 16 | ACID transactions, advisory locks, JSON columns for flexible payloads |
| Logging | Pino | Structured JSON logs, `workerInstanceId` injected on every line |
| Containers | Docker + Compose | Multi-stage builds, healthchecks, `--scale worker=N` |

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Compose)
- Git

### Run the full stack

```bash
git clone https://github.com/PedroHMour/distributed-job-queue.git
cd distributed-job-queue

cp .env.example .env

# Build all images and start the entire stack with 3 worker replicas
docker compose up -d --build --scale worker=3

# Verify all services are healthy
docker compose ps
```

Expected output:

```
NAME                             STATUS
jobqueue_postgres                Up (healthy)
jobqueue_redis                   Up (healthy)
jobqueue_api                     Up (healthy)
distributed-job-queue-worker-1   Up (healthy)
distributed-job-queue-worker-2   Up (healthy)
distributed-job-queue-worker-3   Up (healthy)
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `jobqueue` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `jobqueue_secret` | PostgreSQL password |
| `POSTGRES_DB` | `jobqueue_db` | PostgreSQL database name |
| `API_PORT` | `3000` | Exposed API port |
| `CONCURRENCY_EMAIL` | `10` | Parallel email jobs per worker container |
| `CONCURRENCY_IMAGE` | `2` | Parallel image jobs per worker container |
| `CONCURRENCY_REPORT` | `5` | Parallel report jobs per worker container |

---

## API Reference

### `POST /api/v1/jobs`

Ingests a new job. Returns `202 Accepted` regardless of Redis availability.

**Email delivery:**
```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EMAIL_DELIVERY",
    "priority": 1,
    "data": {
      "to": "user@example.com",
      "subject": "Welcome!",
      "templateId": "welcome-v2",
      "variables": { "name": "Pedro", "plan": "Pro" }
    }
  }'
```

**Image processing:**
```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "IMAGE_PROCESSING",
    "data": {
      "sourceUrl": "https://cdn.example.com/photo.jpg",
      "operations": [
        { "type": "resize", "width": 800, "height": 600 },
        { "type": "convert", "format": "webp" }
      ],
      "outputBucket": "processed-images"
    }
  }'
```

**Report generation:**
```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "REPORT_GENERATION",
    "data": {
      "reportType": "sales",
      "dateRange": { "from": "2026-01-01T00:00:00Z", "to": "2026-06-01T00:00:00Z" },
      "filters": {},
      "outputFormat": "pdf",
      "recipientEmail": "manager@example.com"
    }
  }'
```

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "jobType": "EMAIL_DELIVERY",
  "enqueuedInRedis": true,
  "bullmqJobId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Job accepted and queued for immediate processing."
}
```

---

### `GET /api/v1/jobs/:id`

Polls the current status of a job.

```bash
curl http://localhost:3000/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000
```

---

### `GET /api/v1/jobs`

Lists jobs with optional filters.

```bash
# Filter by status
curl "http://localhost:3000/api/v1/jobs?status=DEAD&limit=10"

# Filter by type
curl "http://localhost:3000/api/v1/jobs?jobType=IMAGE_PROCESSING&status=COMPLETED"
```

---

### `GET /health`

Returns the health of all downstream dependencies.

```bash
curl http://localhost:3000/health
# {"status":{"postgres":"ok","redis":"ok"},"uptime":342.1}
```

---

## Observability

Every log line is structured JSON with a `workerInstanceId` field — making it trivial to trace which container processed each job when running at scale.

```bash
# Stream logs from all 3 workers simultaneously
docker compose logs worker --follow

# Inspect job distribution across worker instances in Postgres
docker compose exec postgres psql -U jobqueue -d jobqueue_db \
  -c "SELECT worker_instance_id, status, COUNT(*) 
      FROM job_executions 
      GROUP BY 1, 2 
      ORDER BY 1, 2;"
```

Example output — proof of horizontal distribution:

```
     worker_instance_id      |  status   | count
-----------------------------+-----------+-------
 worker-a1b2c3d4-1823        | COMPLETED |    14
 worker-a1b2c3d4-1823        | DEAD      |     2
 worker-e5f6g7h8-1901        | COMPLETED |    11
 worker-e5f6g7h8-1901        | RETRYING  |     1
 worker-i9j0k1l2-2044        | COMPLETED |    16
```

---

## Scaling Workers

```bash
# Scale to any number of worker replicas — no port conflicts, no config changes
docker compose up -d --scale worker=5

# Scale back down gracefully — BullMQ waits for in-flight jobs to finish
docker compose up -d --scale worker=1
```

Workers scale without conflict because:
- No `container_name` defined on the worker service
- No ports exposed — workers communicate exclusively via Redis and PostgreSQL
- Each container gets a unique `HOSTNAME` from Docker, used as `workerInstanceId`

---

## Resilience Features

| Feature | Implementation |
|---|---|
| **Outbox pattern** | Job persisted in Postgres before Redis enqueue; 202 returned regardless |
| **Exponential backoff** | 1s → 2s → 4s between retry attempts (no thundering herd) |
| **Dead Letter Queue** | Jobs exhausting all attempts move to `dead_letter_entries` with full failure history |
| **Stall detection** | BullMQ detects jobs stuck in ACTIVE after 30s (worker crash without graceful shutdown) |
| **Graceful shutdown** | `SIGTERM`/`SIGINT` → pause workers → finish in-flight jobs → close connections |
| **Redis reconnection** | Automatic reconnect with exponential backoff, up to 10 attempts before process exit |
| **Migration safety** | Prisma advisory locks prevent concurrent migration runs across API replicas |
| **Non-root containers** | All containers run as `nodeapp` user (UID 1001), never as root |

---

## Database Schema

```
job_executions
├── id                  UUID (PK)
├── bullmq_job_id       UUID (nullable, set after Redis enqueue)
├── job_type            EMAIL_DELIVERY | IMAGE_PROCESSING | REPORT_GENERATION
├── status              PENDING | ACTIVE | COMPLETED | FAILED | RETRYING | DEAD
├── priority            INT
├── input_payload       JSONB
├── output_payload      JSONB (nullable)
├── attempt_number      INT
├── max_attempts        INT
├── error_message       TEXT (nullable)
├── error_stack         TEXT (nullable)
├── enqueued_at         TIMESTAMPTZ
├── started_at          TIMESTAMPTZ (nullable)
├── completed_at        TIMESTAMPTZ (nullable)
├── processing_ms       INT (nullable)
└── worker_instance_id  TEXT (nullable)

dead_letter_entries
├── id                  UUID (PK)
├── job_execution_id    UUID (FK → job_executions)
├── bullmq_job_id       UUID
├── job_type            ENUM
├── input_payload       JSONB
├── failure_history     JSONB  ← array of {attempt, errorMessage, errorStack, failedAt}
├── resolved_at         TIMESTAMPTZ (nullable)
├── resolved_by         TEXT (nullable)
├── resolution_note     TEXT (nullable)
└── created_at          TIMESTAMPTZ
```

---

## License

MIT
# API Response Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every API response a recognizable envelope and request-correlated logs.

**Architecture:** A global Nest interceptor wraps successful handler results and logs responses. A global catch-all exception filter formats errors. The React API client unwraps the envelope while preserving metadata in errors.

**Tech Stack:** NestJS 11, Express, RxJS, React, TypeScript.

---

### Task 1: Add API response infrastructure

**Files:** Create `apps/api/src/common/api-response.interceptor.ts`; Create `apps/api/src/common/api-exception.filter.ts`; Modify `apps/api/src/main.ts`.

- [x] Add global response interceptor with request ID, timestamp, path and duration.
- [x] Add global exception filter with safe error details and structured console logging.
- [x] Register both globally and verify TypeScript compilation.

### Task 2: Update web client contract

**Files:** Modify `apps/web/src/services/api.ts`.

- [x] Define the response envelope type.
- [x] Unwrap successful `data` values.
- [x] Include server `code` and `requestId` in thrown errors.
- [x] Keep existing page-facing return types unchanged.

### Task 3: Validate

**Files:** No new files.

- [x] Run syntax checks and builds where dependencies permit.
- [ ] Verify `/health` returns the envelope and an invalid request returns the error envelope after dependencies are reinstalled.

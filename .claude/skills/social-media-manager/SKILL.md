# Social Media Manager Skill Documentation

This document outlines a comprehensive orchestration framework for managing SMB social media workflows. The skill coordinates five specialized components across a sequential pipeline.

## Core Workflow Structure

The system operates through six phases:

**Phase 0** establishes context by reading existing client files and producing a status summary before any action.

**Phase 1** routes the operator to the appropriate workflow path (new client setup, monthly production, end-of-month review, mid-workflow resume, or specific task).

**Phase 2** executes component skills while maintaining their full instruction sets and producing documented outputs.

**Phase 3** verifies handoff points between skills, ensuring output files exist and contain required content before proceeding.

**Phase 4** manages visual asset creation on a per-post basis, distinguishing between AI-generated visuals and client-sourced photography.

**Phase 5** produces a clean monthly summary document for client distribution and operator briefing.

**Phase 6** updates workflow status tracking to enable reliable mid-session recovery.

## Key Operational Principles

The framework emphasizes sequential execution: "do not run content-calendar and caption-writer simultaneously. The outputs of one are the inputs to the next."

Approval gates function as mandatory checkpoints. The calendar requires review before caption writing begins; captions require approval before visual production starts.

Performance reviews directly inform subsequent calendars, making monthly reviews essential rather than optional reporting.

The most common use case involves specific tasks (Route E) rather than full pipeline runs, using component skills directly for individual requests.

## Component Skills Referenced

- `/brand-onboarding` — establishes brand identity and content pillars
- `/content-calendar` — builds monthly post plans
- `/caption-writer` — produces social copy
- `/social-creative-designer` — generates visual assets
- `/social-performance-review` — analyzes performance and informs future planning

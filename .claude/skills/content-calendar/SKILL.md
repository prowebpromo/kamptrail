# Content Calendar Skill

This skill builds month-long social media content plans for small-to-medium businesses across Instagram, LinkedIn, Facebook, TikTok, and X.

## Six-Phase Workflow

**Phase 0 – Setup:** Checks for existing brand context files (`context/brand-style.md`) before proceeding.

**Phase 1 – Brief Intake:** Gathers month, platforms, posting frequency, goals, upcoming events, and content pillars.

**Phase 2 – Research:** Optional competitor and trend analysis using Firecrawl, SerpApi, or Playwright tools when available.

**Phase 3 – Content Mix Planning:** Defines pillar ratios and format variety based on business type and monthly goal. See `references/content-mix-guide.md` for ratios by business type.

**Phase 4 – Calendar Build:** Creates detailed post specifications with topics, angles, visual direction, and format for each scheduled post. Lock in upcoming events and campaigns first. Avoid clustering promotional content. Place high-effort formats (carousels, reels) on peak engagement days.

**Phase 5 – Review:** Presents draft calendar for operator approval before any caption writing begins.

**Phase 6 – Output:** Saves final calendar to `context/content-calendar.md` and offers adjustments.

## Key Principles

- Specific topics produce better downstream captions than vague ones
- Cap promotional content at approximately 20% or trust erodes
- Carousels typically drive the highest engagement through saves
- Default Instagram posting rate: 4x/week

## Handoff

Output feeds directly into `/caption-writer` and `/social-creative-designer` for downstream production.

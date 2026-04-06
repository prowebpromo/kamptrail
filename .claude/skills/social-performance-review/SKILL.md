# Social Performance Review Skill

Systematic monthly social media analysis framework for SMBs across Instagram, LinkedIn, Facebook, and TikTok.

## Core Purpose

Analyze post-level and account-level performance data to identify patterns, explain what worked and why, and deliver actionable recommendations for the following month's content calendar.

## Workflow Phases

**Phase 0 – Setup:** Review existing context files (`context/brand-style.md`, `context/content-calendar.md`, `context/best-performers.md`, previous reviews).

**Phase 1 – Intake:** Collect month, platforms, available data, business context, and goals.

**Phase 2 – Data Ingestion:** Accept CSV exports, screenshots, or manual input. Normalize and clean data. Flag paid posts separately from organic.

**Phase 3 – Analysis:** Run account snapshots; identify top/bottom performers; analyze content pillars, formats, hooks, and cadence.

**Phase 4 – Competitor Context:** Optional comparison using available competitor data.

**Phase 5 – Insights & Recommendations:** Synthesize findings into 2–4 key insights and 3–5 ranked, specific recommendations.

Each recommendation follows: **What** (specific change) → **Why** (data support) → **How** (implementation step).

**Phase 6 – Output:** Generate client-facing report. Update context files.

## Data Priority

1. CSV exports from Meta Business Suite or LinkedIn Analytics (highest impact)
2. Screenshots or top/bottom post lists (pattern analysis with stated limitations)
3. Manual client-reported top/bottom performers and follower changes (minimal viable)

## Critical Interpretation Principles

- Every metric must answer: "What does this mean for next month's content?"
- Saves matter more than likes for Instagram SMBs
- Reel reach inflates due to algorithmic distribution — exclude reels when benchmarking reach rate against followers
- Paid posts must be flagged and excluded from organic benchmarks
- The account's own prior month is the primary benchmark, not external averages

See `references/benchmarks.md` for industry benchmark ranges.

## Output Files

- Report: `outputs/reviews/[client]-social-review-[month]-[year].md`
- Updated: `context/best-performers.md` (top 3 posts)
- Updated: `context/review-history.md` (trend tracking)

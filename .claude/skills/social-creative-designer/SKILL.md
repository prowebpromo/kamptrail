# Social Creative Designer Skill

Senior Social Media Creative Designer role operating across four distinct creative modes using the Nano Banana image generation API.

## Core Modes

**1. Generate Mode** — Creates original AI imagery from conceptual briefs (lifestyle, atmospheric content without specific products).

**2. Composite Mode** — Anchors the client's real product photo in an AI-generated scene while preserving the product's exact appearance. DEFAULT for product brands.

**3. Brand Mode** — Applies text overlay treatment to existing client photography without altering the source image.

**4. Stop-Motion Mode** — Produces 6-frame action sequences exported as looping MP4 videos.

## Workflow Phases

**Phase 0 – Brand Context:** Read `context/brand-style.md` to load palette, typography, visual vibe, and design constraints.

**Phase 1 – Mode Selection:** Determine appropriate mode through client intake. Collect post concept, overlay text, format specs, and visual direction.

**Phase 2 – Creative Brief:** Generate structured brief for client approval before proceeding to generation.

**Phase 3 – Prompt Engineering:** Engineer prompts using Google's required 6-element framework:
1. Subject
2. Composition
3. Action
4. Location
5. Style
6. Camera + Lighting

**Phase 4 – Generation:** Execute image generation via `mcp__nanobanana__generate_image` with mode-specific parameters. All client deliverables use "Pro" model tier.

**Phase 5 – Output Package:** Deliver images, prompt documentation, and creative brief.

**Phase 6 – Refinement:** Iterate based on client feedback.

## Critical Constraints

- **Product integrity:** For product posts, Composite mode is the default. The product must remain pixel-accurate — never AI-approximated. Generate mode is inappropriate when the client's actual product appears in the post.
- **Text rendering:** Do not rely on Nano Banana to render label text, small product text, or brand names accurately. Source photography must provide legible label detail.
- **Stop-Motion continuity:** Define scene anchor (food item, surface, props) verbatim in frame 1 and copy verbatim into every subsequent frame prompt.
- **Stop-Motion batching:** Maximum 2 frames in parallel to prevent server disconnects.
- **Stop-Motion export:** MP4 at standard (5fps / 200ms per frame) and slow (3fps / 333ms per frame) speeds.

## Quality Gates

Before delivery, verify: color consistency, typography adherence, text legibility, brand compliance, and product authenticity.

## Handoff

Outputs saved to `outputs/creatives/` with naming convention `[client]-[post-id]-[mode]-[date]`.

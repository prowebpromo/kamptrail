# App Store Description Writer

Generate app store listings for KampTrail (PWA store submissions, Google Play TWA, etc.).

## Usage

`/app-store-description [store] [variant]`

**Stores:** `google-play` | `microsoft-store` | `pwa-directory` | `alternativeto`
**Variants:** `full` | `short` | `update-notes`

## Instructions

You are the app store copywriter for KampTrail. Write compelling store listings that convert browsers to installs.

**Core messaging hierarchy:**
1. **Free** — no subscription, no in-app purchases, no ads
2. **All 50 states** — comprehensive US coverage
3. **Offline-capable** — works without cell service
4. **Open source** — community-driven, transparent

---

### Google Play (TWA)

**Title:** KampTrail – Free Camping Map (30 chars)

**Short description** (80 chars):
> Find free & low-cost campsites across all 50 US states. Works offline.

**Full description** (4,000 chars max):
- Para 1: Hook — what problem does it solve?
- Para 2: Key features (bulleted list of 6–8)
- Para 3: Data sources and coverage
- Para 4: PWA / offline capabilities
- Para 5: Open source and community
- Para 6: CTA — "No sign-up required. Just open and explore."

**Keywords:** camping app, free camping, dispersed camping, boondocking, rv camping, campsite finder, offline maps, BLM camping

---

### PWA Directory / AlternativeTo

**Tagline** (under 100 chars):
> Free, open-source US camping discovery app with offline support and 50-state coverage.

**Description** (300 chars):
Concise overview hitting: free, offline, open-source, 50 states, no sign-up.

---

### Update / What's New Notes (500 chars max)

Summarize what changed in plain language. Always start with the most user-visible change. Avoid technical jargon.

## Example Prompts

- `/app-store-description google-play full`
- `/app-store-description pwa-directory short`
- `/app-store-description google-play update-notes`

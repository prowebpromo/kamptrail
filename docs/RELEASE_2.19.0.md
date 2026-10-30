# KampTrail 2.19.0 integration candidate

This candidate combines the existing 2.18 monthly condition reports and camping-care checklist with Spanish UI, explicit numeric seasonal visit ratings, moderated external YouTube attachments, and nearby mapped height-tag evidence using the existing Rhode Island feed. Runtime modules and first-party URLs use 2.19.0; the worker shell is `kt-v47`.

Spanish covers core tools, rig profiles, sampled terrain, height tags, qualified amenities and service-source descriptions. Place names, original source text, raw tags and visitor words stay unchanged. French is absent. See [the language and data boundaries](localization/spanish-ui-package.md).

Numeric averages require three explicit 1–5 ratings per aspect and season. Monthly categorical counts remain separate. Both describe reported visits, not current conditions or objective safety. Nearby route-height records are unverified mapped tags within a bounded search area; the route is not checked for safe passage or vehicle restrictions.

Videos require whole-review moderation and a fresh publication check before explicit Play. Moderation decisions hash the exact displayed review, attachment and photo snapshot; stale or deleted reviews require fresh inspection. See [the video contract](replica/campsite-videos.md).

The combined candidate preserves the existing popup Close regressions and adds desktop/mobile ordinary-click coverage for stacked Services, Rest areas and Height-tag controls. Ancillary panels scroll within map-relative bounds, with layer selection first and expanded selection above the lower panels.

See [the candidate evidence and score](replica/2026-10-30-parity-2.19-candidate.md) for completed local checks and the PHP/MySQL/browser/release gates still required. The final source includes reviewed national-service promotion hardening and PR105’s actual 50-state dataset: 254,149 service identities in 1,138 shards, with extract-dated health evidence. The existing PR104 must be updated using the current reviewed code/data parents; no parallel release is needed.

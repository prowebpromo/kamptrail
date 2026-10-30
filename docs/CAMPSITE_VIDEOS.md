# Moderated visitor YouTube links

The maintained implementation contract, hosting-cost scope, moderation rules, publication checks and validation requirements are in [Campsite videos](replica/campsite-videos.md).

The 2.19 integration preserves PR104's deterministic test for an attachment replacement during moderation rendering, alongside the same-second edit, stale deletion, explicit moderator video acknowledgement and strict public-cohort projection tests. A locally skipped PHP test is not runtime proof; the exact integrated candidate must pass PHP/MySQL and browser CI before release.

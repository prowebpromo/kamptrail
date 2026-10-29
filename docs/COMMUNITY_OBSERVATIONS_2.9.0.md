# Published camper observations and discovery

Release 2.9.0 adds optional observations to the existing moderated review flow:
approach difficulty for the contributor's rig, noise, shade, crowding, subjective
comfort and signal for AT&T, Verizon, T-Mobile or another carrier. Each carrier
can have a reported setting: outdoors, inside an RV, another vehicle or unspecified.
The review's visit date and rig provide context. No inferred coverage, signal
measurement or current access/permission/safety guarantee is added.

## Discovery behavior

- Minimum community rating uses only published review sum/count, with an optional
  minimum number of published reviews. External source ratings cannot satisfy it.
- Condition and carrier selections must occur on one published visit report.
  Multiple carriers or multiple reviews cannot be combined into a false match.
- Signal discovery uses the selected reported level or better; “No service” matches
  only a no-service report.
- Condition age is selectable: any date, past 12 months (default) or past 90 days.
  Rating averages use all published reviews. Missing evidence never matches.
- Map and route-corridor discovery use the same predicate and campsite aliases.
  Results show review counts and latest matching visit evidence.
- Discovery loads on demand, with dated explicit status and a retry control.
  Validated public aggregates can remain available offline for seven days, clearly
  labeled as saved. Names, prose, photos and private author codes are not cached.
- Incomplete downloads or revision changes never replace a complete snapshot.
  Author changes immediately invalidate the local aggregate cache.

## Moderation and storage

Migration `004_observations` adds only two tables. It does not alter existing
reviews, photos, quotas or configuration. DDL and revision initialization can be
retried safely after a partial migration. Existing reviews continue to work before
this additive migration; observation discovery remains unavailable until applied.

Observations are approved with their review. Author edits return all fields to
pending, immediately withdrawing rating/observation discovery. Hidden, rejected
and deleted reviews are excluded. Older clients omitting the observation field
preserve existing observations. A submitted empty object explicitly clears them.
Author deletion removes the structured content. Existing rate limits, ownership
checks, moderation audit history and photo protections remain in force.

`api/community-discovery.php` serves 100 campsites per page, containing published
rating totals and observation signatures grouped by visit date, with counts only.
It uses an explicit repeatable-read snapshot on MySQL and a revision token across
pages. Publication or author changes increment the revision transactionally.
The route search index carries aliases and a community metadata version so an old
offline index cannot silently misapply the new filters.

## Validation and deployment gates

Focused tests cover same-visit/same-carrier matches, unknowns, minimum sample size,
recency, malformed/private cache fields, interrupted pagination, offline expiry,
author-change cache invalidation and map/route alias consistency. PHP tests cover
moderation/edit/hide/restore/delete, identical pending edits, legacy-client fields,
populated schema upgrade, safe migration retry, public response privacy and
pagination/revision changes. Disposable MySQL backups include observations.

Browser checks cover submission/edit fields, ratings/condition filtering, saved
evidence labels, persistence and mobile accessibility. Full PHP/MySQL and browser
CI must pass before merge. Apply the additive migration through authenticated
moderation after deployment, then verify health and the live public discovery feed.
Do not create fake reviews on real campgrounds to populate the feature.

FCC coverage remains a separate package. No successful FCC authentication or
public coverage geometry is claimed by this release.

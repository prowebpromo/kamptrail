# OSM field ownership candidate

Status: draft implementation, not a production data repair. Based on main
`bae1e71ccd188919554d2e4c6837f66212d2fdab`. No source snapshots, generated
indexes, coordinates, canonical IDs, version identities or service-worker caches
are changed by this branch.

## Trigger and proposed behavior

The snapshot merger spreads a secondary record underneath a retained record.
When the retained OSM element has no `fee` or `access`, the other element's tag
becomes its own raw field. The index merger can independently adopt missing fee
and access values from a different OSM identity after a name/proximity match.

For different OSM identities, this candidate keeps the retained element's fee
and access fields. Missing values stay missing/unknown. Snapshot donor fields
and their original dates remain in `unverified_osm_field_records`. The index
retains normalized donor reports in `unverified_osm_matches` and keeps existing
attributed fee evidence. These are diagnostic reports, not confirmed identity
relationships or permissions.

Explicit free-versus-paid conflicts remain unknown. Repeated merges cannot
restore the missing value from the same donor. Exact OSM identity duplicates
can still supply explicit evidence. Existing cross-source fee reconciliation
is unchanged in this candidate.

## Validation completed

73 focused Node tests pass without skips across snapshot merge safety,
normalization, national search, and runtime loading. Tests cover source dates,
input immutability, reversed merge order, exact identity enrichment, conflicting
fees, repeated state loads, aliases, unchanged fixture membership/coordinates,
and legacy unknown-type OSM identities. A prior expanded run failed solely
because the sparse checkout lacked an existing OK/TX fixture; supplying the
unchanged tracked snapshots resolved that failure.

These fixture assertions are not a whole-catalogue census or a claim that the
four modules' behavior is unchanged for every record.

## Required before readiness or merge

- Reconcile Claude's field-by-field provenance specification and actual-record
  fixtures. The audit lists 44 inherited-tag snapshot records, but four have
  null published canonical IDs. Recover their snapshot identities. Forty have
  published OSM IDs. Do not treat all 44 as published classification changes.
- Resolve how confirmed node/area representations of one place may share
  evidence without reopening name/proximity-only adoption. This conservative
  candidate may withhold legitimate evidence until that identity is verified.
- Review cross-source identity contamination (`osm_id`/`osm_type` copied into
  RIDB records) separately. It is not repaired by this candidate.
- Review the diagnostic record schema, growth bounds, source ownership and
  timestamp handling against the actual-record fixtures.
- Replay from retained raw inputs, not already merged snapshots that have lost
  field ownership. Rebuild and enumerate every fee/access/admission delta.
  Assert stable canonical IDs, coordinates, memberships and counts. Investigate
  any failed assertion instead of accepting a broad split simulation.
- Pass full native CI and browser checks on the final reviewed head. Coordinate
  runtime and service-worker version identities before any production release.

No imports, catalogue splits, manual fee batches, production permissions or
deployments are authorized by this document. The existing 2.21.1 release stays
in place while the candidate is reviewed.

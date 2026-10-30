# State rest-area rules: shared dated policies

This package researches a rule once for a precisely scoped state operator and
facility class. Each of the 78 existing TxDOT locations inherits the same dated
Texas policy in its popup and saved source context, with links to the rule and
statute. Facility exceptions are separate evidence. No locations are added and
the raw Texas catalogue is unchanged. Texas overnight permission stays unknown.
State-policy facts do not create permission-filter matches.

## Reviewed primary evidence

| Scope | Overnight parking | Sleeping in vehicle | Camping | Duration context |
| --- | --- | --- | --- | --- |
| TxDOT safety rest areas | Unknown | Unknown | Unknown | TxDOT describes stays up to 24 hours. |
| MDT rest areas | Allowed, subject to conditions | Unknown as a separate activity | Prohibited | MDT operational maximum is 12 hours; use one parking space per vehicle. |

Checked October 30, 2026. The machine-readable preparation fixture records
retrieval timestamps, source URLs, complete-response hashes and HTTP metadata.
No publisher update date was established. HTTP Last-Modified is not a policy's
effective or legal update date.

Texas: [TxDOT policy](https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-map.html)
and [Transportation Code 545.411](https://tcss.legis.texas.gov/resources/TN/htm/TN.545.htm).
The code includes notice and structure provisions. Its scope includes designated
rest areas and certain other TxDOT properties. The preparation rule deliberately
covers only the existing safety-rest-area importer class. A duration limit alone
does not establish either overnight parking or sleeping permission. The primary
pages inspected do not explicitly resolve those activities.

Montana: [MDT operating policy](https://mdt.mt.gov/travinfo/restarea.aspx)
and [MCA 60-6-202](https://mca.legmt.gov/bills/mca/title_0600/chapter_0060/part_0020/section_0020/0600-0060-0020-0020.html).
The statute's designated-rest exception contains a 24-hour ceiling. It does not
replace MDT's shorter 12-hour operating rule. The MDT page identifies temporary
closures, so a generally permitted activity cannot establish that a particular
facility is open or has space. No Montana location catalogue is imported here.

## Reuse and exceptions

`scripts/rest_area_policy.py` requires exact state, managing operator and facility
class. A state match alone cannot apply a DOT rule to private parking, campgrounds
or an unreviewed facility category. The existing trusted TxDOT importer establishes
those contextual values for its 78 records; guessed OSM operator names do not.

The resolver keeps parking, sleeping, camping and duration separate. It returns
the state evidence once, plus any matched facility evidence, rather than copying
78 independent reviews. Specific, sourced restrictions can tighten a default.
A purported facility grant that contradicts a prohibition, or extends the state
stay limit, becomes unknown with an explicit authority-review flag. The resolver
does not silently decide that a sign can override a law. Multiple site exceptions
must be consolidated by a reviewer. Other sites retain the unmodified state rule.

Example preparation commands:

```sh
python scripts/rest_area_policy.py --state TX --operator txdot --kind safety_rest_area
python scripts/rest_area_policy.py --state MT --operator mdt --kind rest_area
python -m unittest discover -s scripts/tests -p 'test_rest_area*.py'
```

## Publication and maintenance

The reviewed source lives in `scripts/fixtures/rest_area_state_policies.json`.
`node scripts/build-rest-policies.js` validates it and generates
`data/rest-areas/state-policies.json`; the release packager calls the builder and
ships that public file. The client fetches it only when the rest-area layer is
requested. Each popup resolves exact state/operator/class and then its facility
exception. Dates and official links remain visible; saved stops retain dated
source context. The existing permission dialog and permission filters remain
independent. Montana's reviewed policy is available without inventing Montana
locations.

Policy evidence older than 180 days yields unknown in the diagnostic resolver
and client. This operational review ceiling is not a legal effective period.
Rechecking sources is a state-policy task, not 78 duplicate location reviews.
A failed, invalid or absent policy download leaves the independently sourced
Texas locations usable with explicit unknown policy. Future timestamps,
unsupported source hosts and ambiguous scope/exception records are rejected.
The fixture is never automatically re-dated. Source change monitoring remains
a future improvement; readers must check posted exceptions and current closures.

Relevant unit tests cover scope, all 78 inherited rules, independent activities,
expiry, malformed evidence and conflicting exceptions. Browser regressions cover
visible rule dates/source links and policy-download failure. Full native CI and
root's live verification are release gates. No added parity credit is claimed.

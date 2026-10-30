# State rest-area rules: prepared model

This preparation package researches a rule once for a precisely scoped state
operator and facility class. Facility exceptions are separate evidence. It does
not add locations, change the 78-record Texas catalogue, connect to permission
filters, or grant production overnight permission.

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

## Integration gates

Before this model can affect live permission filters or map copy: define the
policy recheck/change-monitoring process, freshness display and response to
unavailable or changed sources; wire reviewed agency scope and specific exceptions
into the client; preserve independent opening/closure evidence; verify normal
mobile/keyboard and unknown/offline behavior. These reviewed snapshots have no
invented expiry or automatic date renewal. They are dated evidence, not a promise
that the legal or operational rules remain current indefinitely.

The fixture lives under `scripts/fixtures`, outside the deployed rest-area data,
until those gates pass. No new parity credit is justified by this preparation.

# Tourism, listing type and admission review

Candidate for 2.35.0 (kt-v68). Baseline a8785f981e58f745fbd57e34763b630ab73fe7d2, release 2.34.0. The earlier c109f339 proposal was evaluated again against the released identity and rig rules. No approval to merge or deploy was given.

## How the evidence changed the proposal

| Original proposal | Revised disposition |
| --- | --- |
| 31 discovery withdrawals | Nine facilities lack sufficient evidence in their own retained records and have proposed withdrawal pages. Fifteen have evidence of campsites in their own facility records. Seven remain discoverable pending adjudication. The latter 22 display Other because this review establishes no more specific campsite type. |
| 10 lodging labels | Eight supported. Pink House Recreation Site (ridb:255240) remains a campground. Its BLM record reports RV and tent campsites. Desolation Gray Canyons Screen Cabins (ridb:234745) remains a campground. The operator identifies the screens as gathering shelters and directs visitors to bring sleeping accommodations. |
| 51 Other listings promoted by their descriptions | All 51 retain their published Other type. The proposal drew 41 Campground and 10 Dispersed labels from descriptions. A description can support prior admission or an individually reviewed admission, but cannot upgrade the type. |
| Other listings with qualifying own names | Twenty-three own names support a Campground proposal and four support Dispersed. These changes remain subject to review. |
| OSM member website links | Of 51 reviewed websites, 44 name the matching facility number. Every link remains supporting evidence. No link establishes equivalence or lends rig, tourism or amenity tags. |
| Four further labels depend on description wording | Camp 32 (ridb:237191), Pine Glen Recreation Area (ridb:243219), Wolf Flats Recreation Area (ridb:255262) and Priest Hole Recreation Site (ridb:260547) were Campground on main. All remain discoverable. The candidate proposes Other for review because the retained source does not support a specific type. Wolf Flats had been proposed as Dispersed by description. |

The seven pending facilities include one record for multiple seasonal camps, three ambiguous camp names and three areas mentioning camping. A map notice identifies each pending admission. For the 15 directly supported facilities, the source-reviewed observation is pinned to its ID, name and retrieval. A fresh observation is pending until checked. Access or operating exclusions still apply. The import does not retain Recreation.gov’s raw facility-type field and its facility-level update date. The separate source-retention proposal is outside this candidate.

## Review records

- [Independent evidence for all 31 withdrawals and ten lodging proposals](candidates/tourism-independent-source-review.json), including retained paths, review findings, published source links and lodging exceptions. Shaw House has a reported closure. The White Mountains entry covers multiple cabins. A listing type does not establish availability.
- [Prior label and evidence for the 51 held descriptions, four additional cases and 27 own names](candidates/tourism-type-review.json).
- Generated local ledgers are `docs/candidates/tourism-type-admission.json` and `docs/candidates/tourism-type-admission.csv`. The replay creates both. Each change requires separate review.
- [Retired facilities and all their aliases](../data/campsites/withdrawn.json). Opening an old share link or a saved stop shows a persistent facility notice with an official source link. The saved ID is unchanged.

## Ownership and identity

The snapshot builder preserves the primary record’s own type, keeps an absorbed OSM element’s tourism and rig values on that member, and identifies a copied description. The shared index and map code ignores inherited tourism, prevents a nearby agency’s activity from becoming the host’s own, and accepts a same-ID agency relationship independently of OSM websites. BLM layer-8 camping activity is attributed to BLM. It does not supply Recreation.gov’s raw facility type.

The browser uses the released canonical election and conservative fallback. The nine withdrawn canonicals and their withdrawn aliases are held back even on a cold single-state load. The independently published Don Carter State Park OSM listing stays discoverable. Every normal index rebuild must preserve old ID resolution or supply a reviewed same-host withdrawal entry. Existing rig and amenity filters continue to use the recorded owner.

## Reproduce

From this worktree, run `bash scripts/tourism-type-admission/run-all.sh /absolute/path/to/a8785f98 /absolute/path/to/output`. This replays all snapshots, builds the search index and host sidecar, regenerates the ledger, repeats the rebuild from the same baseline, and runs the provenance and admission verifiers. Run `npm test` and `node scripts/check-browser-identity.js --scenarios default,reversed --out /tmp/candidate-identity.json` for the test suite and full loader comparison. Do not interpret this candidate as a deployed release.

Pending or rejected reviews, photos, corrections, permissions, shared links outside the site and privately saved trips could not be enumerated. The ID-resolution checks apply whether or not any such references exist.

## Remote source checkpoint and local build

The review branch is a source checkpoint. The review branch retains main a8785f98’s 50 state snapshots and three indexes. Its search index contains 33,370 listings (SHA-256 `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a`), and its separate withdrawn.json contains the nine reviewed notices. The package builder rejects this combination. The corrected snapshots, three index files and regenerated per-record ledgers were built in the review worktree. Rebuild before using or comparing a map from the branch. Automatic approval review rejected transmission of the generated state data to GitHub. The source checkpoint therefore cannot be merged as a built release. The expected final search-index SHA-256 is `370e42268e41ec027a4d89b9214084f240cc2bbc054632920690d9670b837740`.

## Local acceptance, November 1

| Check | Result |
| --- | --- |
| Retained-input replay | Two runs produced the same SHA-256 manifest digest `cd970cbd495be53b6271812b6f51a3b235e1a2ea98791434bfbf5e2b7162bbca` for 50 state snapshots, the search, coordinate and identity-host indexes, and withdrawn.json. |
| Catalogue and identity | 33,370 → 33,361 listings. All 36,290 former canonical and legacy IDs resolve to the same host or its withdrawal notice. Zero moved hosts or newly published facilities. The 734-record ledger reports zero unexpected deltas. |
| Index differences | 61 type changes, nine withdrawals, three state-file loading hints. Campground → lodging 8, Campground → Other 21, Dispersed → Other 5, Other → Campground 23, Other → Dispersed 4. The two additional UT loading hints affect ridb:10068990 and ridb:245164. The new KY and VA hints affect ridb:249902. These identify state files, not a geographic reclassification. |
| Source ownership | 703 inherited tourism fields moved to member evidence. The replay restored the retained facility’s own mapped Other type on 202 rows and marked 45 copied descriptions. No surviving listing changed fee, access, rig, amenity, point, or alias. All four restrictive holds stayed active. |
| Raw admission | Three formerly rejected raw rows now qualify with access unknown. Axolotl Cabin (ridb:251354), White Mountains cabins (ridb:252494) and Westwater Group Site (ridb:10012141) were already published through agency records. |
| Regression suites | All 101 targeted tests passed. Full configured Node suite ran serially with 425 passed and 64 skipped. Python had 388 passed and nine skipped. No failures. PHP CLI was unavailable for the Node run. |
| Package | Locally rebuilt package search, identity and withdrawal files match the reviewed bytes. The only packaged clearance file is RI.json. The remote source checkpoint correctly fails before packaging until its catalogue is rebuilt. |
| Legacy UI | Chromium desktop and mobile opened all 14 retired canonical and legacy IDs, 28/28. All four saved-trip cases passed for old string IDs and saved feature snapshots. Repeated against a deliberately stale 2.34.0 search index with the same 32/32 result. |

The national browser census found two first-pass point differences on Axolotl Cabin and White Mountains cabins. The published coordinates are used verbatim in both index and browser after correction. Separate detail-level browser checks reproduced the 2.34.0 elevation readings on both listings. Terrain is loaded on demand at detail zoom and was not verified nationwide by the low-zoom census.

A separate pre-existing issue occurs when Nevada loads before California and the identity host file is available. Bird Creek Campground ridb:234209 temporarily absorbs the independently published usfs:65184. Its expected host, osm:way:1236741631, is elected when California loads. This was independently reproduced on 2.34.0 and this candidate. It is recorded separately from complete-catalogue identity checks and should be investigated as a release issue.

Independent Chromium forward-desktop and reverse-mobile runs each ended at 33,361 after 50 states, with zero missing/extra/duplicate hosts, wrong member sets or type, rig and point mismatches. The reversed run reproduced the Bird Creek exception at 28 intermediate steps. [Independent review and hash record](candidates/TOURISM_INDEPENDENT_REVIEW.md).

A supplemental isolated PHP 8.3.6 run with SQLite, GD and mbstring passed all 76 selected PHP-related tests with no skips. These results supplement the default local Node suite above.

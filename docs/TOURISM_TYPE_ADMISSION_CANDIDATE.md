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
- [Record ledger](candidates/tourism-type-admission.json) and [CSV](candidates/tourism-type-admission.csv), regenerated from main and the candidate. Each change requires separate review.
- [Retired facilities and all their aliases](../data/campsites/withdrawn.json). Opening an old share link or a saved stop shows a persistent facility notice with an official source link. The saved ID is unchanged.

## Ownership and identity

The snapshot builder preserves the primary record’s own type, keeps an absorbed OSM element’s tourism and rig values on that member, and identifies a copied description. The shared index and map code ignores inherited tourism, prevents a nearby agency’s activity from becoming the host’s own, and accepts a same-ID agency relationship independently of OSM websites. BLM layer-8 camping activity is attributed to BLM. It does not supply Recreation.gov’s raw facility type.

The browser uses the released canonical election and conservative fallback. The nine withdrawn canonicals and their withdrawn aliases are held back even on a cold single-state load. The independently published Don Carter State Park OSM listing stays discoverable. Every normal index rebuild must preserve old ID resolution or supply a reviewed same-host withdrawal entry. Existing rig and amenity filters continue to use the recorded owner.

## Reproduce

From this worktree, run `bash scripts/tourism-type-admission/run-all.sh /absolute/path/to/a8785f98 /absolute/path/to/output`. This replays all snapshots, builds the search index and host sidecar, regenerates the ledger, repeats the rebuild from the same baseline, and runs the provenance and admission verifiers. Run `npm test` and `node scripts/check-browser-identity.js --scenarios default,reversed --out /tmp/candidate-identity.json` for the test suite and full loader comparison. Do not interpret this candidate as a deployed release.

Pending or rejected reviews, photos, corrections, permissions, shared links outside the site and privately saved trips could not be enumerated. The ID-resolution checks apply whether or not any such references exist.

## Remote source checkpoint and local build

The review branch is a source checkpoint. The final state snapshots, three index files and regenerated per-record ledgers were built in the review worktree. Rebuild before using or comparing a map from the branch. Automatic approval review rejected transmission of the generated state data to GitHub. The source checkpoint therefore cannot be merged as a built release. The expected final search-index SHA-256 is `370e42268e41ec027a4d89b9214084f240cc2bbc054632920690d9670b837740`.

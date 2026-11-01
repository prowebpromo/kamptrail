# Independent tourism candidate review • 2026-11-01

Baseline source was a8785f981e58f745fbd57e34763b630ab73fe7d2 (2.34.0). The corrected candidate runtime was local commit c5387ff66d0922ea37f04cc670efa7285e30b9b0, with data-quality.js SHA-256 4fc8ac598b22962c0a7a2ffbd1fa837077d930b25de6797f1faf9ae8f1bb1f6b. The independent Chromium tests ran against rebuilt local data. The GitHub review branch is a source checkpoint that still contains the baseline search index. The verified runtime files and withdrawal details match remote source checkpoint 62cca379c6a11bd62aeb93a3175680360be604d6. Serving that checkpoint as-is does not reproduce the candidate. No production deployment was performed or approved.

| Artifact | SHA-256 |
| --- | --- |
| 2.34 search index | 83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a |
| Locally rebuilt candidate search index | 370e42268e41ec027a4d89b9214084f240cc2bbc054632920690d9670b837740 |
| Locally rebuilt candidate identity hosts | 743b94a631df204f8622e5d70917ab387bcc0222fd5817722693426ca83fb975 |
| Candidate withdrawn listing details | 0c4bd11e763a77706ed840aad100dacff301a475c091c4ad495ad2c6e0d8ce8e |

## Admissions and retained evidence

- Independent case review covered all 31 originally proposed withdrawals and 10 lodging changes. Nine lack qualifying evidence in their retained rows and have proposed withdrawals. Fifteen retained listings have their own campsite evidence. Seven retain discoverability with an explicit pending-admission status. The latter 22 display Other. Pending status and a past field observation do not establish current availability.
- Eight lodging changes are supported. Pink House Recreation Site (ridb:255240) is a developed campground. Desolation Gray Canyons Screen Cabins (ridb:234745) are sheltered gathering spaces whose operator directs visitors to sleep in their own equipment. Both stayed Campground. Shaw House (ridb:233178) has lodging evidence and a retained notice of temporary closure.
- All 51 description-only proposed upgrades retained Other, including Francis Marion National Forest and Slim Buttes Land Unit. Twenty-three Other→Campground and four Other→Dispersed changes use facility names. Twenty-one Campground and five Dispersed labels changed to Other. All 51 member URLs were re-parsed independently. Forty-four contain a matching facility number, six a legacy park ID and one no facility ID. None serves as independent facility identity.
- The actual index changed from 33,370 to 33,361 discoverable hosts with no additions. All 36,290 historical IDs and aliases resolve to their prior host or the retired notice. The nine withdrawals account for 14 IDs. No retained fees, rig metadata, coordinates or aliases changed. Three state-file loading hints expanded (ridb:10068990, ridb:245164 and ridb:249902).
- The JSON and CSV ledgers cover the same 734 distinct IDs as the original review. Current and proposed labels in both agree with their respective indexes. Every one of 64,280 snapshot rows matched its raw source for retained tourism and, for RIDB hosts, retained type. All 3,311 absorbed OSM tourism observations matched their owning element.

## Independent browser results

Chromium 143 ran the real application against local frozen files with separate desktop and mobile-emulated contexts. All 14 retired canonical/alias URLs resolved on each viewport. The plain-ID saved trip and a saved snapshot both opened the correct retired notice and preserved stored IDs, notes and dates on each viewport. All 32 checks passed with the current index and all 32 passed again with a stale 2.34 index.

The forward desktop and reverse mobile national runs started with no state loaded, called the browser loader once per state, and compared each complete catalogue to the index. Both ended at 33,361, with zero missing or extra hosts, duplicate hosts, wrong member sets, type mismatches, rig mismatches or coordinate mismatches. Both had 15 reviewed admissions and seven pending admissions. These results concern the complete catalogue. The intermediate-state exception below remains open.

The first candidate changed browser coordinates for Axolotl Cabin (ridb:251354) and White Mountains cabins (ridb:252494) while the index preserved the published points. In separate zoomed map tests, 2.34 attached the known terrain readings, the first candidate showed Elevation unknown, and corrected c5387ff restored the original exact coordinate keys. The corrected detail views again showed 2176.688720703 m and 529.28503418 m respectively. Known terrain keys for 33,274 indexed records match the final coordinates. Actual popup evidence was inspected for these two facilities, not for every listing.

## Open baseline identity defect

With the published identity manifest available, loading Nevada before California transiently merges the independent Bird Creek Campground usfs:65184 into ridb:234209. Recreation.gov's expected published host for that alias is osm:way:1236741631. In real Chromium, all three IDs temporarily resolve to ridb:234209. Loading California restores both correct owners. This occurred after each of 28 state loads in reverse order, from NV through CO. Forward order and the complete national catalogue were clean.

A separate NV→CA Chromium reproduction demonstrated the same behavior in both the 2.34 baseline and corrected candidate. The local 2.34 app.js, data-loader.js, data-quality.js, CA/NV state and agency inputs, identity hosts, search index and three facility evidence sidecars matched all 12 corresponding production HTTP capture hashes. The captured release marker identified a8785f981e58f745fbd57e34763b630ab73fe7d2. With the manifest forced to HTTP 404, both versions kept the two Nevada records separate. No change to the released identity implementation is included in this candidate.

The source-only checkpoint, unresolved partial-state identity case, and review-only scope preclude release signoff. Private submissions, photos, permissions, external shared links and individual users' saved trips could not be enumerated. Stored-ID coverage was tested with the published identifier inventory and controlled saved records.

# Tourism, listing type and admission review

Review branch `review/tourism-admission-r3`, revision 4. It applies Chuck Price's decisions of 2026-11-01 20:24 ET on revision 3 (`8df61a78`), on top of his 08:16 and 08:18 decisions. Current main `b0dfbdbc` (release 2.36.0, kt-v69) is integrated and is the comparison baseline. Its campsite data and classifier match f84a5b4b, so main's labels are unchanged. No version bump, merge, pull request or deploy was made. No approval to merge or deploy was given.

## Decision ledger

The [dated decision ledger](tourism/decision-ledger-2026-11-01.json) records every decided listing, with the owner-decision time, the decider, the own-record field and quote, and the result. `data-quality.js` mirrors it, and a unit test fails if the two differ. `scripts/tourism-type-admission/owner-decisions.js` fails the build check if a quote no longer appears in the own record or if a built label differs.

| Decided | By | Decision |
| --- | --- | --- |
| 2026-11-01 08:16 and 08:18 | Chuck Price (owner) | Keep the 9 withdrawals discoverable with a pending notice. Approve 8 lodging relabels and 2 rejections, preserving closure notices and distinguishing the multi-cabin record. Approve upgrades only where the refreshed record confirms them. Defer the 26 downgrades. |
| 2026-11-01 20:24 ET | Chuck Price (owner), relayed by the coordinator | Accept the 13 upgrades whose own name says Campground, and the 2 named Dispersed Campground. Review the other 12 individually. Keep all 9 withdrawals listed. Accept 16 keeps, 3 Dispersed and 7 Other (pending). A name plus point match is candidate evidence only. Another agency's fields classify a listing only with a shared facility id or an independently verified link to that exact facility. |

### Applied

| Group | Result in this build |
| --- | --- |
| 27 upgrades | 13 Other → Campground and 2 Other → Dispersed by own name. Of the 12 reviewed individually, 4 go to Campground and 8 stay Other. |
| 9 proposed withdrawals | All stay listed with their main label and the notice "under review for removal from campsite search". Nothing is withdrawn. `withdrawn.json` is empty. |
| 26 deferred | 14 keep their main label on their own description. 3 Campground → Dispersed. 7 → Other, still pending admission review. 2 are decision-4 exceptions, held at their main label, pending. |
| 10 lodging | Unchanged from revision 3. 8 Lodging, Pink House and Desolation Gray Canyons stay Campground. Shaw House shows its own dated closure notice and White Mountains is marked as 15 cabins. |

### The 12 upgrades reviewed individually

| ID | Name | Own field | Own-record quote | Result |
| --- | --- | --- | --- | --- |
| ridb:10068183 | Little Duck Campsite on Grand Island | FacilityDescription | “This campsite is located approximately 50 yards from Lake Superior and Trout Bay Beach.” | Stays Other. One hike, bike or boat-in campsite. No campground or dispersed wording. |
| ridb:247937 | Dworshak State Park- Three Meadows Group Camp | FacilityDescription | “This recreation area is part of Dworshak Reservoir” | Stays Other. "Group Camp" supports camping. The description only names the reservoir. |
| ridb:248513 | Granite Lake Rv Park | FacilityName | “Granite Lake Rv Park” | Other → Campground. The own name is an RV park, a developed campground for RVs. The description only names the lake, so the name is the sole basis. |
| ridb:256895 | Bitter Creek Overlook Camping Area | FacilityDescription | “Campsite along Kokopelli Trail.” | Stays Other. Supports camping, not a type. |
| ridb:257133 | Rock Castle Camping Area | FacilityDescription | “Small campground along the Castle Valley Road” | Other → Campground. The own description calls it a campground. |
| ridb:261695 | Edson Creek Camping | FacilityDescription | “27 campsites with picnic tables and fire rings” | Other → Campground. The own description calls it a campground with 27 sites. |
| ridb:262649 | North Table Rock Camping Area | FacilityDescription | “no facilities are offered at this location” | Stays Other. An undeveloped RV base camp. No dispersed wording. |
| ridb:262654 | Pine Creek Camping Area | FacilityDescription | “This is a small primitive camping area within the Pine Creek Exclosure.” | Stays Other. "Primitive" alone does not establish Dispersed. |
| ridb:262772 | Ft. Meade Horse Camp | FacilityDescription | “Alkali Creek Horsecamp (11 acres) contains six fee camping units” | Stays Other. "Horse Camp" supports camping. The site details describe a differently named camp (Alkali Creek Horsecamp). |
| ridb:262796 | Horse Mountain Primitive Camp | FacilityDescription | “Primitive camping area. No toilets, water, and hookups.” | Stays Other. "Primitive" alone does not establish Dispersed. |
| ridb:265204 | Wolf Ford Horse Camp | FacilityDescription | “this 13-site camp provides access to many miles of equestrian trails” | Other → Campground. The own record describes a 13-site camp. Judgement call: it gives a site count but no amenities. |
| ridb:273835 | North Fork Primitive Camp | FacilityDescription | “it makes a great short or introductory backpacking adventure” | Stays Other. The description is about the river and hiking. No campsites are described. |

"Primitive" alone did not establish Dispersed (Horse Mountain, Pine Creek, North Fork). A name naming a camp supports camping but not a type unless the record describes a campground. Two rows are judgement calls for the owner to confirm. Granite Lake Rv Park rests on its name alone. Wolf Ford Horse Camp gives a site count but no amenities.

### Decision 4 exceptions

Two of the 16 proposed keeps depend only on a name-and-point match for their type. They come out of the accepted set and stay at their current label, pending.

| ID | Name | Own-record quote | Reason |
| --- | --- | --- | --- |
| ridb:243702 | Head O' Boulder Forest Camp | “This rustic camp offers a few sites” | Held at Campground, pending. The own record establishes camping but not Campground. The Campground label came from the USFS record usfs:39956, matched by name and point only. |
| ridb:249902 | Wolf Gap Recreation Area | “Stay at one of our charming campsites” | Held at Campground, pending. The own record establishes camping but not Campground. The Campground label came from the USFS record usfs:74043, matched by name and point only. |

The other 14 keeps quote their own description for the label (see the deferred tables below). None of them uses a Forest Service field.

### Withdrawal cases (none applied)

| ID | Name | Strength | Own-record evidence | Withdrawal case |
| --- | --- | --- | --- | --- |
| ridb:237765 | Kirkwood Ranch | strong | FacilityDescription: “The Kirkwood Historic Ranch is an area rich in river history” | Its own record describes a historic ranch and museum. Historic bunk houses are buildings, not campsites. |
| ridb:244404 | Wakeley Lake Area | weak | FacilityDescription: “Recreation areas near the Wakeley Lake Area.” | Its own record lists nearby recreation areas. That is an absence of camping detail, not a statement that there is no camping. |
| ridb:245273 | Buckhorn | weak | FacilityDescription: “This is a great recreation area.” | Its own record says nothing about facilities either way. |
| ridb:246536 | Bingo | weak | FacilityDescription: “General Forest Camping Recreational Opportunity Guide” | Its own record links a general forest camping guide. That points toward camping without establishing a site. |
| ridb:247835 | Daisy State Park | weak | FacilityDescription: “This recreation area is part of Greeson Lake” | A park record that only names its lake. |
| ridb:247915 | River Forks | weak | FacilityDescription: “This recreation area is part of Lake Sidney Lanier” | A park record that only names its lake. |
| ridb:247922 | Don Carter State Park | weak | FacilityDescription: “This recreation area is part of Lake Sidney Lanier” | A park record that only names its lake. |
| ridb:248072 | Scusset Beach State Reservation | weak | FacilityDescription: “This recreation area is part of Cape Cod Canal” | A reservation record that only names the canal. |
| ridb:248261 | Potato Hills Central | moderate | FacilityName: “Potato Hills Central” | Its retained own record names the facility as part of Sardis Lake. The campground wording in the merged row is copied from another record (ridb:233590) and does not classify this one. |

Strength reflects what the own record says. Kirkwood Ranch's record positively describes a non-camping use (historic ranch and museum). The others are silent or only name a lake or canal, which is weak evidence. Potato Hills Central is moderate: its own record says nothing about camping, and the only campground wording is copied from ridb:233590. Any later withdrawal needs a tested notice page for every canonical and legacy id it retires. That includes usfs:18814, usfs:5889, usfs:65003, osm:way:941066426 and osm:relation:13942065, which today resolve to these listings.

## Fresh evidence

- [RIDB facility evidence](tourism/ridb-facility-evidence-2026-11-01.json), committed unchanged. SHA-256 `ec8da8c2c93ae75e3267ca42c7beeab8040d86965da4bcb98776dfc9ccd760b5`. Retrieved 2026-11-01T21:14:28Z by [workflow run 41350953975](https://github.com/prowebpromo/kamptrail/actions/runs/41350953975). All 72 facilities status ok.
- [Request groups](tourism/ridb-evidence-request-2026-11-01.json) (SHA-256 `30f0f0be082312e6d5ff3d1a9f75de54edfadcb1c999d48d897e84a73db587fe`).
- [Revision 3 reviewer recommendations](tourism/fresh-evidence-review-2026-11-01.json), superseded by the ledger where they differ.
- [Decided outcomes](tourism/owner-decisions-2026-11-01.json), generated per facility. `observed.*` is copied from the evidence file. `derived.*`, decision and action are computed. `current.*` comes from main's catalogue and `candidate.*` from this build.

All 72 refreshed records match their listing's own name and point (0 m). The 62 non-lodging records report only the generic type "Facility", are not reservable and have no campsite records. No label in this build comes from those fields. Every accepted label rests on the own name or description quoted in the ledger.

## Per-facility tables

Raw type, LastUpdatedDate, retrieved_at and campsite records are observed (evidence file). Main label is observed (main's catalogue). Build label is this build. The quote is from the listing's own retained Recreation.gov record. The result is the owner's decision as applied.

#### Nine proposed withdrawals (withdrawal_9)

| ID | Name | Raw type | LastUpdatedDate | retrieved_at | Campsite records | Main label | Build label | Own-record quote | Result and reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ridb:237765 | Kirkwood Ranch | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “The Kirkwood Historic Ranch is an area rich in river history” | Stays listed with its current label and the pending notice. Case strength: strong. Its own record describes a historic ranch and museum. Historic bunk houses are buildings, not campsites. |
| ridb:244404 | Wakeley Lake Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Dispersed | Dispersed | FacilityDescription: “Recreation areas near the Wakeley Lake Area.” | Stays listed with its current label and the pending notice. Case strength: weak. Its own record lists nearby recreation areas. That is an absence of camping detail, not a statement that there is no camping. |
| ridb:245273 | Buckhorn | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This is a great recreation area.” | Stays listed with its current label and the pending notice. Case strength: weak. Its own record says nothing about facilities either way. |
| ridb:246536 | Bingo | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “General Forest Camping Recreational Opportunity Guide” | Stays listed with its current label and the pending notice. Case strength: weak. Its own record links a general forest camping guide. That points toward camping without establishing a site. |
| ridb:247835 | Daisy State Park | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This recreation area is part of Greeson Lake” | Stays listed with its current label and the pending notice. Case strength: weak. A park record that only names its lake. |
| ridb:247915 | River Forks | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This recreation area is part of Lake Sidney Lanier” | Stays listed with its current label and the pending notice. Case strength: weak. A park record that only names its lake. |
| ridb:247922 | Don Carter State Park | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This recreation area is part of Lake Sidney Lanier” | Stays listed with its current label and the pending notice. Case strength: weak. A park record that only names its lake. |
| ridb:248072 | Scusset Beach State Reservation | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This recreation area is part of Cape Cod Canal” | Stays listed with its current label and the pending notice. Case strength: weak. A reservation record that only names the canal. |
| ridb:248261 | Potato Hills Central | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityName: “Potato Hills Central” | Stays listed with its current label and the pending notice. Case strength: moderate. Its retained own record names the facility as part of Sardis Lake. The campground wording in the merged row is copied from another record (ridb:233590) and does not classify this one. |

#### Twenty-two deferred (downgrade_22)

| ID | Name | Raw type | LastUpdatedDate | retrieved_at | Campsite records | Main label | Build label | Own-record quote | Result and reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ridb:10049041 | Morrow Bridge and Midway Seasonal Camps | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Other | FacilityDescription: “offer primitive facilities in a setting ideal for hunting” | → Other, pending review |
| ridb:10068990 | Willow Creek Transfer Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “Campground amenities include picnic tables, fire rings, a restroom” | Keeps Campground on its own description |
| ridb:237148 | Gateway Boat Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “The campground has 5 sites with tables and fire rings.” | Keeps Campground on its own description |
| ridb:240871 | Enduro Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Other | FacilityDescription: “The Enduro camp has vaulted restrooms.” | → Other, pending review |
| ridb:240903 | Sugar Creek Hunter Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Dispersed | Other | FacilityDescription: “Sugar Creek Hunter Camp” | → Other, pending review |
| ridb:241301 | Bear Creek Lake Recreation Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Other | FacilityDescription: “the recreation area offers three campgrounds” | → Other, pending review |
| ridb:243195 | McDougle Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Other | FacilityDescription: “McDougle Camp” | → Other, pending review |
| ridb:243218 | Coleman Lake Recreation Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “There are 39 campsites with water and electrical hookups” | Keeps Campground on its own description |
| ridb:243702 | Head O' Boulder Forest Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This rustic camp offers a few sites” | Held at Campground, pending. The own record establishes camping but not Campground. The Campground label came from the USFS record usfs:39956, matched by name and point only. |
| ridb:244320 | Bowman Lake Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Dispersed | Other | FacilityDescription: “The Bowman Lake area is located in Lake and Sweetwater Townships in Lake County.” | → Other, pending review |
| ridb:244321 | Condon Lakes West | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Other | FacilityDescription: “This area is very popular for mushroom and berry picking, as well as hunting, fishing and camping.” | → Other, pending review |
| ridb:245164 | Hunter Creek Transfer Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “the campground offers 3 single camping units, and 1 multi-family unit” | Keeps Campground on its own description |
| ridb:245165 | Bear Creek Transfer Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “The transfer camp offers 6 campsites with picnic tables and fire rings” | Keeps Campground on its own description |
| ridb:249627 | Joe Elliot Yellow Post Sites | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Dispersed | FacilityDescription: “These two remote yellow post sites are located near the end of Forest Road 1N34” | Campground → Dispersed |
| ridb:249642 | Coon Creek Yellow Post Sites | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Dispersed | Dispersed | FacilityDescription: “These 19 yellow post sites are individual camping sites.” | Keeps Dispersed on its own description |
| ridb:249674 | Stockton Flats Yellow Post Sites | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Dispersed | FacilityDescription: “these sites do NOT contain the amenities found at developed campgrounds” | Campground → Dispersed |
| ridb:249741 | Thomas Hunting Grounds Yellow Post Sites | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Dispersed | Dispersed | FacilityDescription: “these sites do NOT contain the amenities found at developed campgrounds” | Keeps Dispersed on its own description |
| ridb:249752 | Clark's Ranch Yellow Post Site | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Dispersed | Dispersed | FacilityDescription: “this site does NOT contain the amenities found at developed campgrounds” | Keeps Dispersed on its own description |
| ridb:249902 | Wolf Gap Recreation Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “Stay at one of our charming campsites” | Held at Campground, pending. The own record establishes camping but not Campground. The Campground label came from the USFS record usfs:74043, matched by name and point only. |
| ridb:255188 | Spring Recreation Site | Facility | 2026-09-03 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “The RV and tent camping sites, boat launch, boarding dock, and fish cleaning station” | Keeps Campground on its own description |
| ridb:255232 | Mica Bay Boater Park | Facility | 2026-05-14 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This unique boat-in campground offers 16 tent camping units” | Keeps Campground on its own description |
| ridb:255239 | McKay's Bend Recreation Site | Facility | 2026-06-05 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “This recreation site offers developed camping for RVs and tents” | Keeps Campground on its own description |

#### Four deferred (downgrade_4)

| ID | Name | Raw type | LastUpdatedDate | retrieved_at | Campsite records | Main label | Build label | Own-record quote | Result and reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ridb:237191 | Camp 32 | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “The Camp 32 campground is located 15 miles southwest of Eureka” | Keeps Campground on its own description |
| ridb:243219 | Pine Glen Recreation Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “Pine Glen Recreation Area offers camping sites for 21 campsites, cooking grills, sanitary facilities” | Keeps Campground on its own description |
| ridb:255262 | Wolf Flats Recreation Area | Facility | 2026-09-15 | 2026-11-01T21:14:28Z | none | Campground | Dispersed | FacilityDescription: “Wolf Flats is a dispersed, undeveloped camping area with 25 locations to camp.” | Campground → Dispersed |
| ridb:260547 | Priest Hole Recreation Site | Facility | 2026-09-04 | 2026-11-01T21:14:28Z | none | Campground | Campground | FacilityDescription: “Priest Hole contains 14 drive-in campsites with fire rings and picnic tables” | Keeps Campground on its own description |

#### Twenty-seven upgrades (upgrade_27)

| ID | Name | Raw type | LastUpdatedDate | retrieved_at | Campsite records | Main label | Build label | Own-record quote | Result and reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ridb:10007101 | Large Vehicle Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Large Vehicle Campground” | Other → Campground |
| ridb:10048852 | Miller Flat Reservoir Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Miller Flat Reservoir Campground” | Other → Campground |
| ridb:10060062 | Campo Alto Group Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Campo Alto Group Campground” | Other → Campground |
| ridb:10068183 | Little Duck Campsite on Grand Island | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “This campsite is located approximately 50 yards from Lake Superior and Trout Bay Beach.” | Stays Other. One hike, bike or boat-in campsite. No campground or dispersed wording. |
| ridb:10070265 | Wildcat Creek Campground #2 Upper | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Wildcat Creek Campground #2 Upper” | Other → Campground |
| ridb:10072074 | Home Gulch Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Home Gulch Campground” | Other → Campground |
| ridb:10072265 | Smith Lake Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Smith Lake Campground” | Other → Campground |
| ridb:10078445 | Fulford Cave Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Fulford Cave Campground” | Other → Campground |
| ridb:10078676 | Godman Campground/Trailhead | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Godman Campground/Trailhead” | Other → Campground |
| ridb:10078697 | Conrad Crossing Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Conrad Crossing Campground” | Other → Campground |
| ridb:10134443 | Muchwater Dispersed Campground and Recreation Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Dispersed | FacilityName: “Muchwater Dispersed Campground and Recreation Area” | Other → Dispersed |
| ridb:10134448 | Deer Creek Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Deer Creek Campground” | Other → Campground |
| ridb:10134449 | Peninsula Dispersed Campground and Recreation Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Dispersed | FacilityName: “Peninsula Dispersed Campground and Recreation Area” | Other → Dispersed |
| ridb:10278932 | Muleshoe Campground | Facility | 2026-10-05 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Muleshoe Campground” | Other → Campground |
| ridb:240676 | Table Meadows Campground | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Table Meadows Campground” | Other → Campground |
| ridb:247937 | Dworshak State Park- Three Meadows Group Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “This recreation area is part of Dworshak Reservoir” | Stays Other. "Group Camp" supports camping. The description only names the reservoir. |
| ridb:248513 | Granite Lake Rv Park | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Granite Lake Rv Park” | Other → Campground. The own name is an RV park, a developed campground for RVs. The description only names the lake, so the name is the sole basis. |
| ridb:256895 | Bitter Creek Overlook Camping Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “Campsite along Kokopelli Trail.” | Stays Other. Supports camping, not a type. |
| ridb:257133 | Rock Castle Camping Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityDescription: “Small campground along the Castle Valley Road” | Other → Campground. The own description calls it a campground. |
| ridb:261695 | Edson Creek Camping | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityDescription: “27 campsites with picnic tables and fire rings” | Other → Campground. The own description calls it a campground with 27 sites. |
| ridb:262649 | North Table Rock Camping Area | Facility | 2026-10-13 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “no facilities are offered at this location” | Stays Other. An undeveloped RV base camp. No dispersed wording. |
| ridb:262654 | Pine Creek Camping Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “This is a small primitive camping area within the Pine Creek Exclosure.” | Stays Other. "Primitive" alone does not establish Dispersed. |
| ridb:262772 | Ft. Meade Horse Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “Alkali Creek Horsecamp (11 acres) contains six fee camping units” | Stays Other. "Horse Camp" supports camping. The site details describe a differently named camp (Alkali Creek Horsecamp). |
| ridb:262796 | Horse Mountain Primitive Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “Primitive camping area. No toilets, water, and hookups.” | Stays Other. "Primitive" alone does not establish Dispersed. |
| ridb:265204 | Wolf Ford Horse Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityDescription: “this 13-site camp provides access to many miles of equestrian trails” | Other → Campground. The own record describes a 13-site camp. Judgement call: it gives a site count but no amenities. |
| ridb:272101 | Jericho Campground and Picnic Area | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Campground | FacilityName: “Jericho Campground and Picnic Area” | Other → Campground |
| ridb:273835 | North Fork Primitive Camp | Facility | 2026-02-25 | 2026-11-01T21:14:28Z | none | Other | Other | FacilityDescription: “it makes a great short or introductory backpacking adventure” | Stays Other. The description is about the river and hiking. No campsites are described. |

#### Ten lodging proposals (lodging_10)

| ID | Name | Raw type | LastUpdatedDate | retrieved_at | Campsite records | Main label | Build label | Own-record quote | Result and reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ridb:10344823 | Coldfoot Cabin | Campground | 2026-06-17 | 2026-11-01T21:14:28Z | 1/1 overnight (CABIN NONELECTRIC 1) | Campground | Lodging |  | Coldfoot Cabin's own campsite page shows two bedrooms with bunk beds. |
| ridb:233178 | SHAW HOUSE | Campground | 2026-09-11 | 2026-11-01T21:14:28Z | 1/1 overnight (CABIN ELECTRIC 1) | Campground | Lodging |  | The retained facility describes Shaw House as a rentable historic stone cabin. A dated notice in that same record reports temporary closure after fire damage. Do not infer availability. Own dated closure notice (2026-09-10) shown in the popup. |
| ridb:234149 | PICKETT BUTTE LOOKOUT | Campground | 2026-02-25 | 2026-11-01T21:14:28Z | 1/1 overnight (CABIN NONELECTRIC 1) | Campground | Lodging |  | Pickett Butte's facility record describes a one-room structure and seasonal lodging use. |
| ridb:234159 | SNOW CAMP LOOKOUT | Campground | 2026-07-07 | 2026-11-01T21:14:28Z | 1/1 overnight (CABIN NONELECTRIC 1) | Campground | Lodging |  | Snow Camp's record describes guests staying in the rebuilt lookout cabin. |
| ridb:234185 | DRAKE PEAK LOOKOUT | Campground | 2026-02-25 | 2026-11-01T21:14:28Z | 1/1 overnight (CABIN NONELECTRIC 1) | Campground | Lodging |  | Drake Peak's record describes overnight lodging in the former lookout cabin. |
| ridb:234745 | DESOLATION GRAY CANYONS SCREEN CABINS | Campground | 2026-06-27 | 2026-11-01T21:14:28Z | 4/4 overnight (CABIN NONELECTRIC 4) | Campground | Campground |  | All four reservations are structurally labelled cabin. Each unit's official instructions say it is a gathering place and visitors should sleep in their own tent or trailer. |
| ridb:251352 | Henneberry House | Campground | 2026-08-10 | 2026-11-01T21:14:28Z | 1/1 overnight (CABIN ELECTRIC 1) | Campground | Lodging |  | The facility describes a historic cabin that sleeps eight people. |
| ridb:251354 | Axolotl Cabin | Campground | 2026-07-28 | 2026-11-01T21:14:28Z | 1/1 overnight (CABIN ELECTRIC 1) | Campground | Lodging |  | Axolotl's facility describes a cabin for visitors. |
| ridb:252494 | White Mountains National Recreation Area - Alaska Cabins | Campground | 2026-08-03 | 2026-11-01T21:14:28Z | 15/15 overnight (CABIN NONELECTRIC 15) | Campground | Lodging |  | This is a group of public-use cabins across the recreation area. Its own record describes the cabins and cabin permits. Do not imply the map point gives a particular cabin location. Popup states that the one listing covers 15 cabins and that the point is not a particular cabin. |
| ridb:255240 | Pink House Recreation Site | Campground | 2026-02-25 | 2026-11-01T21:14:28Z | 20/20 overnight (RV ELECTRIC 16, TENT ONLY NONELECTRIC 4) | Campground | Campground |  | The BLM facility's fee record distinguishes RV full hookups and tent camping. Its official page describes the campground and tent and RV sites. House is part of a proper name here. |

## Counts

| Catalogue | Listings | Campground | Dispersed | Lodging | Other | Pending review | Withdrawn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Main b0dfbdbc (before) | 33,370 | 32,479 | 813 | 0 | 78 | 0 | 0 |
| Revision 3 8df61a78 | 33,370 | 32,494 | 817 | 8 | 51 | 16 | 0 |
| This build | 33,370 | 32,480 | 816 | 8 | 66 | 16 | 0 |

Pending review is 9 pending withdrawals and 7 pending admissions shown as Other. Two more listings carry a held label (the decision-4 exceptions). Index changes from main: 17 Other → Campground, 2 Other → Dispersed, 3 Campground → Dispersed, 5 Campground → Other, 2 Dispersed → Other, 8 Campground → Lodging, and 5 state-file loading hints (Bingo NY, Kirkwood Ranch OR, Willow Creek and Hunter Creek Transfer Camps UT, Wolf Gap KY and VA). No fee, access, rig, amenity, point, alias or name changed. All four access holds stay active.

## Build, digests and continuity

| Output | SHA-256 |
| --- | --- |
| search-index.json | `9abd8fa5943a16c32e3794f09dda756957777112605621dbb121832e10e8be1c` |
| coordinate-index.json | `63d43712e74e0114dfd2ede278bc01fa31f8df77e40fffed17f7d35baf322375` |
| identity-hosts.json | `4bb82e9abf1a82b2261f8da208e08895fe65fd20e120d7c586be86282754cc5d` |
| withdrawn.json (committed, no listings) | `b0a6ccc47e0088045f8a52a78518bb997a8cb9fe52defa07c6a7d8d78b4c1867` |
| Manifest of 50 snapshots and the four files above | `47f74acf7cb63c9004107f5b262f94bcd0641ba91ee389e27ffcec87dfb7f620` |

The same manifest came from the two runs inside `run-all.sh` and from a clean rebuild in a fresh `git worktree add` of pushed head `b4674b41`, against a separate unchanged worktree of main b0dfbdbc. The verifier rebuilt the index byte for byte and found 0 unexpected deltas over the 734-record ledger.

`check-id-continuity.js` against main's search-index.json and `withdrawn.json`, on both builds: 36,290 published ids before and after, 0 lost, 0 moved, 0 conflicting.

The branch is a source checkpoint. The rebuilt snapshots and indexes stay uncommitted. Rebuild before comparing a map from the branch.

## Reproduce

Run `bash scripts/tourism-type-admission/run-all.sh /absolute/path/to/main-checkout /absolute/path/to/output` from this worktree. It replays the snapshots, builds the indexes, writes the ledger, repeats the rebuild, runs the provenance and admission verifiers, checks the owner decisions and quotes, runs the continuity check and writes `key-digests.txt`.

## Code changes

- `data-quality.js`: `HELD_PUBLISHED_LABELS` (11: 9 pending withdrawals and 2 exceptions), `OWNER_REVIEWED_LABELS` (29 labels accepted from own records, `type_evidence.kind = owner_reviewed_own_record`), the pending-withdrawal set and the Shaw House closure notice pinned to its retrieval and wording. The 7 Other listings use the existing pending-admission path.
- `data-loader.js`: popup notices for a pending withdrawal, a held label, an own-record closure, the multi-cabin record, and an accepted own-record type. Spanish and French strings added.
- `scripts/verify-tourism-type-admission.js` and `owner-decisions.js` check the build against the ledger.
- Tests: unit tests for each decision and for ledger agreement. `tests/browser/tourism-review.spec.js` covers 16 listings on desktop and mobile.

## Tests

All runs used the rebuilt candidate in this worktree. Main b0dfbdbc was served from an unchanged worktree for comparison. Each server ran as `PORT=<port> node scripts/serve.js` with its cwd confirmed by `readlink /proc/<pid>/cwd` and its search-index digest checked.

| Suite | Candidate | Main b0dfbdbc |
| --- | --- | --- |
| `npm test` | 537 passed, 0 failed, 0 skipped | not rerun |
| `npm run test:python` | 419 ran, OK, 9 skipped (native forecast and parser tests) | not rerun |
| Browser, Chromium, desktop and mobile: tourism-review, app, features, identity, saved-stops, fee-evidence, amenity-evidence, rig-evidence, ridb-amenities, usfs-site-amenities, locale | 59 of 61 passed | app and locale: 12 of 14 passed |

- `app.spec.js` "mobile controls remain clickable" fails the map-height check (493 px, expected more than 500) on both candidate and main.
- `locale.spec.js` "French ... falls back to labeled English" failed once on the candidate (zoom button accessible name empty). It failed the same way on main, and it passed when rerun alone on the candidate. It is intermittent and not caused by this revision.
- `tourism-review.spec.js` passes on desktop and mobile for all 16 listings and 18 canonical and legacy ids.

## Limitations

- In English the popup prints the raw type value ("established", "lodging"). Main does the same. Not fixed here.
- Held labels are review holds, not own-record evidence of a type.
- Accepted labels stay valid only while the quoted wording is in the own record. A source refresh that drops it fails `owner-decisions.js` and must be reviewed again.
- Pending or rejected reviews, photos, corrections, permissions, shared links outside the site and privately saved trips could not be enumerated. The id-resolution checks apply whether or not such references exist.
- The Bird Creek partial-load issue recorded on main is unchanged.

## Earlier review records

- [Independent evidence for the 31 withdrawals and ten lodging proposals](candidates/tourism-independent-source-review.json) and [prior labels](candidates/tourism-type-review.json).
- [Revision 2 independent review and hash record](candidates/TOURISM_INDEPENDENT_REVIEW.md). Its digests are superseded.

Ownership rules are unchanged. The snapshot builder keeps the primary record's own type, keeps an absorbed OSM element's tourism and rig values on that member and marks copied descriptions. Classification moves only between exact identities.

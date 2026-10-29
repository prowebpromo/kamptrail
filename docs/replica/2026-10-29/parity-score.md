## Parity: 79.4 / 100

features 79.4  (61 counted, must-haves 13 of 13 done)

## By area, weakest first
- other                         25.0  (2 features)
- amenities                     50.0  (5 features)
- filters                       62.5  (10 features)
- layers                        72.7  (7 features)
- ugc                           77.8  (6 features)
- trips                         82.4  (9 features)
- place                         85.7  (11 features)
- map                          100.0  (8 features)
- offline                      100.0  (3 features)

## Missing, in build order
- [should] layers: Cell carrier coverage overlay, no  (No public overlay. Private credential intake deployed; server authentication/access denied; FCC support request submitted. Real download, geometry validation and publication remain unfinished.)
- [should] amenities: Overnight parking places (Walmart truck stops rest areas), partial  (Type filter exists; few records)
- [should] place: Place detail: amenities list, partial  (Shown when source reports them)
- [could] amenities: Cell tower location discovery, no  (Historical developer description advertises nearby cell towers. No tower layer in live controls; old audit.spec.js assertions do not establish a shipped feature.)
- [could] amenities: Laundry showers groceries gas facilities, no  (Not in current POI data)
- [could] amenities: Low clearance hazards, no  (Needs clearance dataset)
- [could] filters: Filter by cell signal, no  (Needs coverage data)
- [could] filters: Filter by crowds noise shade safety, no  (Moderation backend exists. These structured fields, aggregates and discovery workflows are not implemented; text reviews do not satisfy this row.)
- [could] filters: Filter by elevation, no
- [could] filters: Filter by minimum rating, no  (Live filter panel has no rating control. Published popup averages are not integrated into the discovery index.)
- [could] filters: Filter by road difficulty, no  (Internal filter property exists, but the live panel has no control and adequate approach-road difficulty evidence is absent. MVUM designation is not difficulty.)
- [could] filters: Filter by weather forecast, no
- [could] layers: Fire weather and smoke layers, no  (NOAA smoke/fire tiles possible)
- [could] other: Multi-language (es fr), no
- [could] place: Campsite videos, no  (Historical developer description advertises videos of campsites. No current campsite video flow; photo gallery is separate.)
- [could] place: Place detail: seasonal sub-scores, no  (Moderation backend exists. These structured fields, aggregates and discovery workflows are not implemented; text reviews do not satisfy this row.)
- [could] trips: Rig profile, no
- [could] trips: Route elevation chart, no
- [could] trips: Route settings rig height avoid highways, no
- [could] ugc: Overnight allowed voting, no  (Moderation backend exists. These structured fields, aggregates and discovery workflows are not implemented; text reviews do not satisfy this row.)
- [could] ugc: Review sub-scores and cell signal reports, no  (Moderation backend exists. These structured fields, aggregates and discovery workflows are not implemented; text reviews do not satisfy this row.)
- [could] other: Leave No Trace / respect the land guidance, partial  (Agency stay-limit and land rules in spot check)

## Left out on purpose (not scored)
- Turn-by-turn navigation: Native app only in original; hand off to Google/Apple Maps
- Accounts and profiles: No-account design is a deliberate choice
- Friends DMs groups forum events: A deliberate scope exclusion. A new community can be built; the original community, accounts and content cannot be transferred without authorization.
- Notifications: Tied to social features
- Donations and partners: Business model item not a user feature
- Product guides and backpack: Affiliate content belongs on Boondock or Bust

## Yours, not in the original (not scored)
- Export / import trip (GPX)
- Offline map tile download
- About the data / transparency
- Land manager lookup with agency stay-limit guidance
- Fee status with source wording (free, conditional, paid, unknown)
- Fee context and negation safeguards
- Joint site suitability evidence
- Per-source freshness and degraded refresh status
- Account-light correction status for campers
- MVUM coverage gaps and seasonal source context
- Predicted versus observed carrier evidence
- Domain migration and portable saved-stop guidance
- Offline area readiness checklist

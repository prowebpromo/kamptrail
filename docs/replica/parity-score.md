## Parity: 80.8 / 100

features 80.8  (59 counted, must-haves 13 of 13 done)

## By area, weakest first
- other                         25.0  (2 features)
- amenities                     57.1  (4 features)
- filters                       62.5  (10 features)
- layers                        72.7  (7 features)
- ugc                           77.8  (6 features)
- trips                         82.4  (9 features)
- place                         90.0  (10 features)
- map                          100.0  (8 features)
- offline                      100.0  (3 features)

## Missing, in build order
- [should] layers: Cell carrier coverage overlay, no  (FCC authenticated/current data access and mobile-data usage conditions unverified; see FCC_COVERAGE_ACCESS.md)
- [should] amenities: Overnight parking places (Walmart truck stops rest areas), partial  (Type filter exists; few records)
- [should] place: Place detail: amenities list, partial  (Shown when source reports them)
- [could] amenities: Laundry showers groceries gas facilities, no  (Not in current POI data)
- [could] amenities: Low clearance hazards, no  (Needs clearance dataset)
- [could] filters: Filter by cell signal, no  (Needs coverage data)
- [could] filters: Filter by crowds noise shade safety, no  (Needs reviews)
- [could] filters: Filter by elevation, no
- [could] filters: Filter by minimum rating, no  (Source-rating engine exists; published community averages are not integrated into national filter metadata)
- [could] filters: Filter by road difficulty, no  (Engine supports it; data sparse)
- [could] filters: Filter by weather forecast, no
- [could] layers: Fire weather and smoke layers, no  (NOAA smoke/fire tiles possible)
- [could] other: Multi-language (es fr), no
- [could] place: Place detail: seasonal sub-scores, no  (Needs reviews)
- [could] trips: Rig profile, no
- [could] trips: Route elevation chart, no
- [could] trips: Route settings rig height avoid highways, no
- [could] ugc: Overnight allowed voting, no  (Needs backend)
- [could] ugc: Review sub-scores and cell signal reports, no  (Core star reviews now live; structured seasonal/noise/shade/signal sub-scores remain absent)
- [could] other: Leave No Trace / respect the land guidance, partial  (Agency stay-limit and land rules in spot check)

## Left out on purpose (not scored)
- Turn-by-turn navigation: Native app only in original; hand off to Google/Apple Maps
- Accounts and profiles: No-account design is a deliberate choice
- Friends DMs groups forum events: Community network cannot be cloned; out of scope
- Notifications: Tied to social features
- Donations and partners: Business model item not a user feature
- Product guides and backpack: Affiliate content belongs on Boondock or Bust

## Yours, not in the original (not scored)
- Export / import trip (GPX)
- Offline map tile download
- About the data / transparency
- Land manager lookup with agency stay-limit guidance
- Fee status with source wording (free, conditional, paid, unknown)

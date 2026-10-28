## Parity: 67.3 / 100

features 67.3  (59 counted, must-haves 12 of 13 done)

Not shippable yet: 1 must-have features are not done.

## By area, weakest first
- other                         25.0  (2 features)
- amenities                     35.7  (4 features)
- filters                       43.8  (10 features)
- ugc                           44.4  (6 features)
- layers                        54.5  (7 features)
- trips                         64.7  (9 features)
- place                         80.0  (10 features)
- map                          100.0  (8 features)
- offline                      100.0  (3 features)

## Missing, in build order
- [must] amenities: Dump water propane facility layer, partial  (Dump 3,494 and propane 702 live. OSM water fill points wired into the weekly refresh; 0 until it runs)
- [should] filters: Filter by rig length, no  (No reliable max-length field in current data)
- [should] layers: Cell carrier coverage overlay, no  (Original self-hosted tiles; no free keyless national tile source verified)
- [should] trips: Find places along route, no  (Original used Mapbox server routing)
- [should] ugc: Reviews with star rating, no  (Needs backend)
- [should] amenities: Overnight parking places (Walmart truck stops rest areas), partial  (Type filter exists; few records)
- [should] filters: Filter by amenities / hookups, partial  (Reported toilet/water/dump/shower. Data sparse)
- [should] place: Place detail: amenities list, partial  (Shown when source reports them)
- [should] place: Place detail: nearby dump water propane, partial  (Nearest dump and propane, straight-line)
- [should] trips: Trip distance and time totals, partial  (Straight-line miles and planned nights. No drive time)
- [could] amenities: Laundry showers groceries gas facilities, no  (Not in current POI data)
- [could] amenities: Low clearance hazards, no  (Needs clearance dataset)
- [could] filters: Filter by cell signal, no  (Needs coverage data)
- [could] filters: Filter by crowds noise shade safety, no  (Needs reviews)
- [could] filters: Filter by elevation, no
- [could] filters: Filter by minimum rating, no  (Needs reviews)
- [could] filters: Filter by road difficulty, no  (Engine supports it; data sparse)
- [could] filters: Filter by weather forecast, no
- [could] layers: Fire weather and smoke layers, no  (NOAA smoke/fire tiles possible)
- [could] layers: MVUM motor vehicle use map layer, no  (USFS MVUM ArcGIS service possible)
- [could] layers: Per-layer opacity, no
- [could] other: Multi-language (es fr), no
- [could] place: Place detail: photos, no  (Needs UGC backend)
- [could] place: Place detail: seasonal sub-scores, no  (Needs reviews)
- [could] trips: Rig profile, no
- [could] trips: Route elevation chart, no
- [could] trips: Route settings rig height avoid highways, no
- [could] ugc: Overnight allowed voting, no  (Needs backend)
- [could] ugc: Photo upload, no  (Needs backend and moderation)
- [could] ugc: Review sub-scores and cell signal reports, no  (Needs backend)
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

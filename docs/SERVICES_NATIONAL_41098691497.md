# National service evidence from staging run 41098691497

Application integration review found four historical synthetic-checkpoint tests comparing their 2025 dates with the newly accepted real Rhode Island source. Their accepted-source baseline is now a small, explicit temporary Utah/legacy fixture. Tests that deliberately supply a newer accepted Rhode Island source still require date-regression rejection, and both accepted-source and checkpoint loss checks remain intact. This test isolation changes no imported record, source timestamp, category predicate, source-loss guard or delivery ceiling. The eleven focused tests and full 216-test local Python suite passed (six optional skips); current exact-head GitHub application checks remain required.

Review branch candidate only. Source: https://github.com/prowebpromo/kamptrail/actions/runs/41098691497, exact reviewed head `369efee3ed2f2b81ce867f269ff08bad523c039b`. All 50 immutable state artifacts and their source/report/receipt hashes were checked against the same batch and registry. The complete aggregate was rebuilt with current accepted freshness/loss guards and unchanged delivery ceilings.

Measured candidate: 254,149 deduplicated service identities, 1,138 shards, 349,801 manifest bytes, snapshot `d05ed287cff1c41ac3c6ab2e`. Canonical legacy evidence is retained byte-for-byte; complete state extracts own their states, so obsolete legacy rows do not resurrect. This is a data review branch, not a merge, deployment, permission guarantee or current-operation claim.

| State | Accepted identities | Quarantined | Dump / water / LPG / showers / laundry / groceries / fuel | PBF bytes | Runtime seconds | Peak RSS KiB |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| AK | 873 | 9 | 77 / 21 / 20 / 33 / 63 / 362 / 317 | 144,177,422 | 91.847 | 583,800 |
| AL | 4,136 | 36 | 52 / 1 / 17 / 38 / 72 / 1581 / 2397 | 151,258,236 | 32.906 | 539,160 |
| AR | 2,486 | 26 | 21 / 4 / 25 / 16 / 50 / 1008 / 1388 | 100,279,133 | 42.715 | 381,664 |
| AZ | 5,213 | 43 | 105 / 28 / 47 / 50 / 184 / 2685 / 2137 | 304,288,958 | 114.244 | 879,820 |
| CA | 21,801 | 146 | 284 / 123 / 92 / 471 / 1406 / 11558 / 8053 | 1,334,134,102 | 505.885 | 2,821,804 |
| CO | 4,783 | 24 | 88 / 27 / 31 / 84 / 232 / 2339 / 2004 | 386,336,795 | 165.168 | 1,044,368 |
| CT | 2,419 | 9 | 9 / 1 / 3 / 22 / 118 / 1135 / 1140 | 217,271,479 | 64.509 | 549,348 |
| DE | 696 | 11 | 1 / 0 / 2 / 12 / 17 / 359 / 306 | 22,243,167 | 14.56 | 197,388 |
| FL | 12,981 | 79 | 190 / 33 / 20 / 357 / 379 / 6418 / 5674 | 659,897,103 | 194.176 | 1,851,572 |
| GA | 8,654 | 42 | 47 / 8 / 26 / 89 / 188 / 3910 / 4481 | 358,169,689 | 77.675 | 873,020 |
| HI | 925 | 2 | 2 / 3 / 0 / 135 / 37 / 474 / 276 | 27,572,063 | 11.197 | 204,280 |
| IA | 3,386 | 27 | 63 / 36 / 3 / 56 / 73 / 1581 / 1639 | 134,250,944 | 40.984 | 513,784 |
| ID | 1,747 | 14 | 63 / 3 / 5 / 17 / 66 / 796 / 802 | 130,179,841 | 27.132 | 482,424 |
| IL | 9,065 | 96 | 72 / 9 / 8 / 120 / 272 / 4875 / 3732 | 362,547,475 | 96.251 | 926,192 |
| IN | 5,330 | 54 | 55 / 24 / 8 / 59 / 136 / 2451 / 2611 | 201,232,765 | 46.556 | 613,920 |
| KS | 2,610 | 31 | 66 / 11 / 6 / 134 / 75 / 1144 / 1183 | 117,419,677 | 24.231 | 424,976 |
| KY | 3,379 | 33 | 17 / 3 / 7 / 24 / 57 / 1504 / 1777 | 154,952,732 | 37.687 | 494,588 |
| LA | 2,897 | 9 | 20 / 1 / 5 / 12 / 72 / 1197 / 1604 | 147,334,568 | 41.923 | 532,712 |
| MA | 4,016 | 27 | 15 / 2 / 3 / 75 / 225 / 2118 / 1600 | 311,400,523 | 55.672 | 759,108 |
| MD | 4,559 | 52 | 55 / 27 / 10 / 50 / 183 / 2397 / 1849 | 216,155,045 | 42.414 | 588,324 |
| ME | 1,510 | 25 | 30 / 3 / 3 / 28 / 65 / 732 / 660 | 91,109,352 | 27.593 | 395,072 |
| MI | 11,634 | 25 | 193 / 65 / 20 / 148 / 253 / 6330 / 4633 | 316,150,199 | 52.715 | 890,092 |
| MN | 4,819 | 49 | 126 / 51 / 12 / 94 / 158 / 2170 / 2239 | 289,776,550 | 60.434 | 824,700 |
| MO | 4,658 | 25 | 48 / 4 / 9 / 176 / 116 / 2148 / 2178 | 200,010,462 | 43.193 | 597,152 |
| MS | 2,239 | 13 | 18 / 1 / 1 / 5 / 35 / 881 / 1318 | 95,131,728 | 18.912 | 359,612 |
| MT | 1,482 | 19 | 53 / 48 / 2 / 46 / 79 / 615 / 656 | 101,271,982 | 26.741 | 414,104 |
| NC | 8,405 | 45 | 64 / 3 / 15 / 109 / 213 / 4577 / 3503 | 430,329,784 | 528.099 | 1,081,476 |
| ND | 811 | 6 | 89 / 0 / 1 / 3 / 11 / 332 / 377 | 128,193,747 | 31.452 | 501,604 |
| NE | 1,968 | 19 | 24 / 2 / 3 / 19 / 57 / 917 / 970 | 101,402,308 | 26.302 | 391,176 |
| NH | 1,626 | 26 | 16 / 6 / 25 / 24 / 84 / 840 / 636 | 72,310,398 | 67.081 | 319,476 |
| NJ | 5,280 | 24 | 18 / 3 / 6 / 51 / 320 / 2789 / 2110 | 164,706,904 | 49.86 | 507,724 |
| NM | 2,263 | 25 | 41 / 13 / 10 / 39 / 103 / 1046 / 1023 | 136,667,983 | 29.589 | 516,992 |
| NV | 2,427 | 18 | 61 / 9 / 6 / 18 / 62 / 1172 / 1106 | 124,025,665 | 41.396 | 502,516 |
| NY | 13,726 | 70 | 71 / 1 / 8 / 147 / 1501 / 8046 / 4051 | 498,324,178 | 143.241 | 1,069,112 |
| OH | 9,322 | 69 | 107 / 40 / 26 / 85 / 288 / 4589 / 4287 | 326,466,062 | 85.256 | 873,188 |
| OK | 3,460 | 68 | 40 / 9 / 5 / 32 / 113 / 1565 / 1754 | 169,933,124 | 70.461 | 534,196 |
| OR | 3,995 | 23 | 199 / 19 / 145 / 139 / 186 / 2102 / 1236 | 254,998,871 | 55.254 | 698,584 |
| PA | 9,136 | 79 | 176 / 7 / 13 / 90 / 457 / 4589 / 3860 | 349,519,333 | 274.007 | 889,204 |
| RI | 491 | 4 | 5 / 0 / 1 / 5 / 24 / 248 / 217 | 52,513,926 | 40.683 | 285,064 |
| SC | 4,868 | 14 | 62 / 0 / 41 / 49 / 133 / 2370 / 2240 | 165,407,075 | 44.373 | 528,352 |
| SD | 1,378 | 7 | 69 / 22 / 25 / 15 / 33 / 578 / 639 | 50,132,175 | 16.262 | 274,600 |
| TN | 5,350 | 30 | 161 / 18 / 34 / 53 / 109 / 2286 / 2715 | 191,123,247 | 84.007 | 607,076 |
| TX | 22,593 | 179 | 170 / 10 / 54 / 150 / 599 / 10567 / 11171 | 726,312,911 | 174.253 | 1,685,720 |
| UT | 2,981 | 19 | 156 / 24 / 10 / 72 / 106 / 1323 / 1305 | 170,897,476 | 30.758 | 583,892 |
| VA | 8,446 | 60 | 80 / 3 / 39 / 132 / 258 / 4444 / 3558 | 429,176,238 | 143.785 | 1,055,696 |
| VT | 1,032 | 17 | 12 / 18 / 1 / 29 / 43 / 486 / 451 | 46,178,784 | 13.704 | 258,980 |
| WA | 7,449 | 58 | 283 / 24 / 56 / 282 / 303 / 3936 / 2605 | 365,225,896 | 118.625 | 955,672 |
| WI | 6,009 | 45 | 124 / 28 / 4 / 141 / 218 / 2930 / 2615 | 294,880,077 | 52.142 | 778,356 |
| WV | 2,060 | 63 | 31 / 2 / 5 / 348 / 55 / 799 / 830 | 99,229,767 | 34.306 | 496,896 |
| WY | 775 | 3 | 34 / 2 / 6 / 14 / 35 / 308 / 380 | 95,157,341 | 58.573 | 438,660 |

Full source URLs/dates, category and quarantine counts, runtime/resource measurements, OSM-linked samples and immutable artifact/file hashes: [SERVICES_NATIONAL_41098691497.json](SERVICES_NATIONAL_41098691497.json). Category totals overlap and source counts may differ from deduplicated database counts. Only normal PR checks and review may authorize a later merge and the existing Hostinger deployment path.

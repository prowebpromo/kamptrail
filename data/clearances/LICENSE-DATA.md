# License and attribution for data/clearances

The clearance candidate files in this directory (index.json, tiles/*.json, excluded/*.json) and the Rhode Island pilot file RI.json are derived from OpenStreetMap.

Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0.

- Licence text: https://opendatacommons.org/licenses/odbl/1-0/
- Copyright and attribution: https://www.openstreetmap.org/copyright

## What this means

- These files are a derived database. They stay under ODbL 1.0 with attribution and share-alike. A database built from them must be offered under the same licence.
- Any screen or product that shows these records must show the attribution sentence above, or an equivalent notice with a link to the copyright page.
- Every JSON file here except RI.json repeats the licence, licence_url, copyright_url and attribution fields in its own header. RI.json is the shipped pilot file. It keeps its original format and is covered by this notice.

## What the data is

Records are clearance candidates: OSM objects that carry a height tag. Their meaning is not established until validation. They are not verified clearances. Values are source reported, uneven and incomplete. Nothing here states that a road is passable.

See docs/CLEARANCE_NATIONAL.md for fields and rules, and docs/CLEARANCE_NATIONAL_REVIEW.md for the measured data problems this format addresses.

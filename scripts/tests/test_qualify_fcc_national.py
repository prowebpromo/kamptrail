import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import qualify_fcc_national as q


class QualificationTests(unittest.TestCase):
    def row(self,state,provider,count):
        return dict(category="Provider",subcategory="Raw Coverage",file_type="gis",technology_type="Mobile Broadband",
                    technology_code="400",state_fips=state,provider_id=provider,file_id=count,
                    file_name=f"bdc_{state}_{provider}_4GLTE_X",provider_name="Example",record_count=str(count))

    def test_contiguous_inventory_requires_each_of_three_carriers_in_all_48_states(self):
        geos = {state: str(i).zfill(2) for i, state in enumerate(sorted(q.CONUS48), 1)}
        rows = [self.row(geos[state], provider, i * 3 + k + 1)
                for i, state in enumerate(sorted(geos))
                for k, (provider, _) in enumerate(q.PROVIDERS.values())]
        lanes = q.assignments(rows, geos)
        q.check_inventory(lanes)
        self.assertEqual(sum(map(len, lanes)), 144)
        self.assertEqual({e["region"] for lane in lanes for e in lane}, q.CONUS48)
        self.assertFalse({"AK", "HI", "DC"} & q.CONUS48)
        with self.assertRaisesRegex(ValueError, "Missing FCC"):
            q.assignments(rows[:-1], geos)
        with self.assertRaises(ValueError):
            q.assignments(rows + rows[:1], geos)
        with self.assertRaises(ValueError):
            q.check_inventory([*lanes[:-1], lanes[-1][1:]])
        with self.assertRaises(ValueError):
            q.assignments(rows, {**geos, "DC": "11"})

    def test_lane_temporal_slots_never_collide_and_missed_windows_are_skipped(self):
        for slots in [1,4]:
            starts=[]
            for lane in range(slots):
                planned=q.slot_start(120.1,lane,slots)
                for _ in range(12):
                    self.assertEqual(planned%slots,lane)
                    starts.append(planned*q.SLOT)
                    planned=q.slot_start(planned*q.SLOT+.2,lane,slots,previous=planned)
            times=sorted(starts)
            self.assertTrue(all(y-x>=12 for x,y in zip(times,times[1:])))
        self.assertEqual(q.slot_start(121.01,2,4),14)
        self.assertGreaterEqual(q.slot_start(0,0,4,not_before=301)*q.SLOT,301)

    def test_stream_rejects_overflow_and_truncation(self):
        class Resp(io.BytesIO):
            headers={}
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"transfer"
            with self.assertRaises(ValueError): q.bounded_copy(Resp(b"abcd"),path,3)
            path.unlink()
            r=Resp(b"abc");r.headers={"Content-Length":"4"}
            with self.assertRaises(ValueError): q.bounded_copy(r,path,9)

    def test_known_alaska_credit_and_standard_credit_share_one_display_credit(self):
        r={"format":"4G LTE","environment":"Outdoor stationary","attribution":q.FCC_CREDIT}
        self.assertEqual(q.display_model([r,{**r,"attribution":q.FCC_ALASKA_CREDIT}])[-1],q.FCC_CREDIT)
        self.assertEqual(q.display_model([{**r,"attribution":q.FCC_ALASKA_CREDIT}])[-1],q.FCC_ALASKA_CREDIT)
        with self.assertRaises(ValueError): q.display_model([r,{**r,"format":"5G"}])
        with self.assertRaises(ValueError): q.display_model([r,{**r,"attribution":"different publisher"}])

    def test_aggregate_verifies_route_receipt_hash_and_complete_pairs(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp); work=d/"lanes/fcc-packed-lane-0"
            (work/"receipts").mkdir(parents=True)
            pm=work/"archives/att/NY.pmtiles";pm.parent.mkdir(parents=True);pm.write_bytes(b"x"*128)
            fid=124;sha="a"*64;bound="b"*64
            meta={"id":"NY","source":{"records":29,"fileId":fid,"sha256":sha,"providerId":"130077","sourceFile":"record"},
                  "boundary":{"sha256":bound},"archive":{"format":"pmtiles-v3","bytes":128,"sha256":q.file_hash(pm)}}
            item={"region":"NY","id":"att","recordCount":29,"fileId":fid,"sourceFile":"record","providerId":"130077"}
            receipt={"carrier":"att","region":"NY","asOf":"2026-06-30","retrievedAt":"2026-11-20","planId":"sample","fileId":fid,
                     "format":"4G LTE","environment":"Outdoor stationary","attribution":q.FCC_CREDIT,"sourceSha256":sha,"metadata":meta,
                     "sourceRelease":"from-builder","bytes":230,"expanded":650,"downloadSeconds":1,"qualifySeconds":1,
                     "initialFreeBytes":999,"freeBytesWithQualifiedSource":799,
                     "spatial":{"region":"NY","carrier":"att","fileId":fid,"sourceSHA256":sha,"records":29,"matches":{"covered":2}}}
            plan={"lanes":[[item]],"planId":"sample","scope":"NY","sourceCommit":"c"*40,"catalogSha256":"d"*64,
                  "componentHashes":{},"boundary":{"sha256":bound},"asOf":"2026-06-30","retrievedAt":"2026-11-20","missing":[]}
            q.write(work/"lane.json",{"lane":0,"planId":"sample","completed":1,"bytes":128,"failures":[]})
            q.write(work/"receipts/NY-att.json",receipt)
            q.assemble(plan,d/"lanes",d/"out",d/"public")
            generation=q.read(d/"out/manifest.json")["release"]
            self.assertTrue((d/"public"/generation/"att/NY.pmtiles").is_file())
            pm.write_bytes(b"z"*128)
            with self.assertRaises(ValueError): q.assemble(plan,d/"lanes",d/"bad")
            self.assertFalse((d/"bad/manifest.json").exists())


if __name__=="__main__": unittest.main()

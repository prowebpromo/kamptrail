import hashlib
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare_fcc_refresh as prepare
import publish_fcc_tiles as publish

DATA_DATE = "2026-06-30"
A, B, C = [DATA_DATE + "-" + ch * 20 for ch in "abc"]


def tile_bytes():
    def chunk(kind, data):
        return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data))
    return (publish.PNG_MAGIC + chunk(b"IHDR",struct.pack(">IIBBBBB",256,256,8,6,0,0,0))
            + chunk(b"IDAT",zlib.compress(b"\x00"*(256*(1+256*4)))) + chunk(b"IEND",b""))


def stage(base,release,ids=("att",),stamp="2026-11-20"):
    base.mkdir()
    carriers=[]
    for carrier in ids:
        region={"id":"RI","bounds":[-71.8,41.3,-71.5,41.6],"minZoom":0,"maxZoom":0,
                "source":{"fileId":12,"providerId":"130077","sha256":"0"*64},
                "boundary":{"sha256":"f"*64}}
        carriers.append({"id":carrier,"regions":[region]})
        p=base/release/carrier/"RI/0/0/0.png"
        p.parent.mkdir(parents=True)
        p.write_bytes(tile_bytes())
    data={"schema":1,"asOf":DATA_DATE,"release":release,"retrievedAt":stamp,"attribution":"FCC BDC",
          "technology":"4G LTE","environment":"Outdoor stationary","carriers":carriers}
    (base/"manifest.json").write_text(json.dumps(data),encoding="utf-8")
    return base


def run(cwd,*cmd):
    return subprocess.run(cmd,cwd=cwd,check=True,capture_output=True,text=True).stdout.strip()


class Checks(unittest.TestCase):
    def test_filters_catalog_by_provider_region_and_raw_lte(self):
        row = dict(category="Provider",subcategory="Raw Coverage",file_type="gis",technology_type="Mobile Broadband",
                   technology_code="400",state_fips="44",provider_id="131425",file_id=145,
                   file_name="bdc_44_131425_4GLTE_J26",provider_name="Verizon",record_count="3")
        rows=[{**row,"technology_code":"500"},{**row,"subcategory":"Hexagon Coverage"},
              {**row,"category":"State"},{**row,"state_fips":"45"},row]
        self.assertEqual(prepare.eligible(rows,"44","131425"),row)
        self.assertIsNone(prepare.eligible(rows,"44","130403"))
        with self.assertRaises(ValueError):
            prepare.eligible(rows+[row],"44","131425")

    def test_bounded_stream_rejects_missing_or_false_length(self):
        with prepare.LimitedStream(io.BytesIO(b"12345"),4) as stream:
            self.assertEqual(stream.read(2),b"12")
            with self.assertRaises(ValueError):
                stream.read(2**20)

    def test_partial_and_extraneous_candidate_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=stage(Path(tmp)/"stage",A)
            publish.validate_candidate(base)
            (base/"raw.gpkg").touch()
            with self.assertRaises(ValueError):
                publish.validate_candidate(base)
            (base/"raw.gpkg").unlink()
            (base/A/"att/RI/0/0/0.png").unlink()
            with self.assertRaises(ValueError):
                publish.validate_candidate(base)

    def test_publication_is_atomic_idempotent_and_retains_predecessor(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)
            remote=d/"remote"
            repo=d/"repo"
            run(d,"git","init","--bare",str(remote))
            run(d,"git","init",str(repo))
            run(repo,"git","remote","add","origin",str(remote))
            (repo/"file").write_text("test")
            run(repo,"git","add","file")
            run(repo,"git","-c","user.name=test","-c","user.email=test@example.com","commit","-m","initial")
            publish.package(repo,d/"missing")
            self.assertFalse((d/"missing").exists())
            first=stage(d/"a",A)
            publish.publish(repo,first)
            initial=publish.remote_head(repo)
            same=stage(d/"same",A,stamp="2026-11-21")
            publish.publish(repo,same)
            self.assertEqual(publish.remote_head(repo),initial)
            with self.assertRaises(ValueError):
                publish.publish(repo,stage(d/"shrink",B,("verizon",)))
            self.assertEqual(publish.remote_head(repo),initial)
            publish.publish(repo,stage(d/"b",B))
            publish.publish(repo,stage(d/"c",C))
            site=d/"site"
            publish.package(repo,site)
            self.assertEqual({p.name for p in site.iterdir()},{B,C,"manifest.json"})
            self.assertEqual(json.loads((site/"manifest.json").read_bytes())["release"],C)
            self.assertEqual(run(repo,"git","status","--short"),"")


if __name__=="__main__":
    unittest.main()

#!/usr/bin/env python3
"""Build Alaska from separate eastern and western Aleutian reporting footprints."""
import argparse
import json
import os
import tempfile
from datetime import date
from pathlib import Path
from osgeo import gdal, ogr, osr

import build_fcc_tiles as tiles


def normalize(path, target, layer=None, select=None):
    """Cut true dateline crossings before any Mercator transform. Validate every polygon component below."""
    opts=["-f","GPKG","-t_srs","EPSG:4326","-wrapdateline","-nlt","PROMOTE_TO_MULTI","-nln","polygons"]
    if select:
        opts.extend(["-where",select])
    if layer:
        opts.append(layer)
    converted=gdal.VectorTranslate(str(target),str(path),options=opts)
    tiles.check(converted is not None,"Could not normalize dateline geometry")
    converted=None
    return ogr.Open(str(target))


def pieces(geometry):
    kind=ogr.GT_Flatten(geometry.GetGeometryType())
    if kind==ogr.wkbMultiPolygon:
        for i in range(geometry.GetGeometryCount()):
            yield from pieces(geometry.GetGeometryRef(i))
    else:
        tiles.check(kind==ogr.wkbPolygon and not geometry.IsEmpty(),"Invalid geographic polygon")
        west,east,south,north=geometry.GetEnvelope()
        tiles.check(-180.0000001<=west<east<=180.0000001 and east-west<180 and south<north and not (west<0<east),
                    "Unsplit or ambiguous Alaska source polygon; keeping the prior generation")
        yield geometry


def collect_masks(layer):
    tiles.check(layer.GetFeatureCount()==1,"Alaska census boundary must resolve exactly once")
    f=layer.GetNextFeature()
    tiles.check(f["STATEFP"]=="02" and f["STUSPS"]=="AK","Incorrect Alaska region identity")
    hemispheres=[ogr.Geometry(ogr.wkbMultiPolygon),ogr.Geometry(ogr.wkbMultiPolygon)]
    for part in pieces(f.GetGeometryRef()):
        west,east,_,_=part.GetEnvelope()
        hemispheres[0 if east<=0 else 1].AddGeometry(part)
    masks=[]
    xf=osr.CoordinateTransformation(tiles.spatial_ref(4326),tiles.spatial_ref(3857))
    for shape in hemispheres:
        tiles.check(not shape.IsEmpty(),"Incomplete Alaska boundary")
        west,east,south,north=shape.GetEnvelope()
        bounds=[max(-180,west),south,min(180,east),north]
        tiles.check(shape.Transform(xf)==0,"Cannot transform Alaska footprint")
        ds=ogr.GetDriverByName("Memory").CreateDataSource("")
        output=ds.CreateLayer("scope",tiles.spatial_ref(3857),geom_type=ogr.wkbMultiPolygon)
        feature=ogr.Feature(output.GetLayerDefn())
        feature.SetGeometry(shape)
        output.CreateFeature(feature)
        masks.append((bounds,ds))
    return masks


def build(plan,output):
    gdal.UseExceptions()
    ogr.UseExceptions()
    check=tiles.check
    filing=date.fromisoformat(plan["asOf"])
    check(plan["minZoom"]==6 and plan["maxZoom"]==10 and len(plan["regions"])==1 and plan["regions"][0]["id"]=="AK",
          "Expected Alaska proof inputs")
    region=plan["regions"][0]
    check(region["boundary"]["layer"]=="tl_2025_us_state" and region["boundary"]["source"]==
          "https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip","Unexpected state boundary")
    output=Path(output)
    check(not output.exists(),"Build into a fresh directory")
    with tempfile.TemporaryDirectory(dir=output.parent,prefix=".ak-") as workdir:
        work=Path(workdir)
        stage=work/"public"
        stage.mkdir()
        boundary=Path(region["boundary"]["path"]).resolve(strict=True)
        checked=normalize("/vsizip/"+str(boundary),work/"state.gpkg",region["boundary"]["layer"],"STUSPS = 'AK'")
        masks=collect_masks(checked.GetLayer())
        print("Alaska wrapped footprints:",[bounds for bounds,_ in masks],flush=True)
        carriers=[]
        ids=set()
        for src in region["carriers"]:
            slug=src["id"]
            check(slug in tiles.PROVIDERS and slug not in ids,"Unexpected carrier")
            ids.add(slug)
            with tempfile.TemporaryDirectory(dir=work) as directory:
                tmp=Path(directory)
                path,digest=tiles.extract_source(src,"02",filing,tmp)
                raw=ogr.Open(str(path))
                check(raw.GetLayerCount()==1,"Expected one provider/state layer")
                brands=tiles.validate_coverage(raw,raw.GetLayer(),src["providerId"],src["recordCount"])
                raw=None
                geo=normalize(path,tmp/"cut.gpkg")
                layer=geo.GetLayer()
                check(layer.GetFeatureCount()==src["recordCount"],"Dateline normalization altered feature count")
                for feature in layer:
                    for part in pieces(feature.GetGeometryRef()):
                        pass
                layer.ResetReading()
                covered=0
                for bounds,mask in masks:
                    for zoom in range(plan["minZoom"],plan["maxZoom"]+1):
                        covered+=tiles.write_zoom(stage/plan["release"]/slug/"AK",tmp,mask.GetLayer(),layer,bounds,zoom)
                check(covered>0,"No qualified Alaska coverage pixels")
                provenance={"fileId":src["fileId"],"providerId":str(src["providerId"]),"asOf":plan["asOf"],
                            "sourceFile":src["sourceFile"],"sha256":digest,"records":src["recordCount"],"brands":brands}
                carriers.append({"id":slug,"regions":[{"id":"AK","footprints":[b for b,_ in masks],
                    "minZoom":plan["minZoom"],"maxZoom":plan["maxZoom"],"source":provenance,
                    "boundary":{"source":region["boundary"]["source"],"sha256":tiles.sha256(boundary)}}]})
                print("Alaska qualified carrier",slug,"records",src["recordCount"],"covered raster pixels",int(covered),flush=True)
        check(carriers,"No qualified Alaska sources")
        manifest={"schema":1,"release":plan["release"],"asOf":plan["asOf"],"retrievedAt":plan["retrievedAt"],
                  "technology":"4G LTE","environment":"Outdoor stationary",
                  "attribution":"Map layer based on FCC BDC. Boundaries: U.S. Census Bureau.", "carriers":carriers}
        (stage/"manifest.json").write_text(json.dumps(manifest,separators=(",",":")))
        os.rename(stage,output)


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--plan",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    args=p.parse_args()
    build(json.loads(args.plan.read_text()),args.output)

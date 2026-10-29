#!/usr/bin/env python3
"""Incremental USGS 3DEP terrain elevation enrichment; no browser/runtime queries.

Default: enrich the local catalogue, resuming coordinate cache. Use --limit 6
--no-publish for a bounded pilot. Publication occurs only after all coordinates
have a validated known or explicit unknown result.
"""
import argparse
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
SAMPLES = SERVICE + "/getSamples"
INTERPOLATION = "RSP_BilinearInterpolation"
MAX_BYTES = 2_000_000
MAX_BATCH = 50
MAX_SPLIT_DEPTH = 3
MIN_SPLIT_BATCH = 6
MAX_RETRY_AFTER = 60
STATES = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())


class ElevationError(RuntimeError):
    pass


class RetryableElevationError(ElevationError):
    """A transient request exhausted its three attempts, not a missing sample."""
    def __init__(self, message, retry_after=0, subdividable=False):
        super().__init__(message)
        self.retry_after = retry_after
        self.subdividable = subdividable


def utcnow():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def valid_timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def atomic_write(path, value):
    """Serialize first; a failed serialization/write never replaces the old file."""
    content = encoded(value)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix="." + path.name, delete=False) as out:
            temporary = out.name
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def number(value):
    if isinstance(value, bool):
        raise ElevationError("Boolean is not a coordinate/elevation")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ElevationError("Invalid numeric value") from exc
    if not math.isfinite(result):
        raise ElevationError("Nonfinite value")
    return result


def coordinate_key(lat, lng):
    lat, lng = number(lat), number(lng)
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise ElevationError("Coordinate outside WGS84 bounds")
    # Match JavaScript Number.toFixed(7), including exact binary ties. Converting
    # the decimal string instead would round a different value for some doubles.
    def fixed(value):
        rounded = Decimal.from_float(value).quantize(Decimal("0.0000001"), rounding=ROUND_HALF_UP)
        return f"{abs(rounded) if rounded == 0 else rounded:.7f}"
    return fixed(lat) + "," + fixed(lng)


def spatial_order(key):
    """Keep nearby quarter-degree cells together using a deterministic Z-order.

    This only changes request order. Exact coordinate keys, per-request locationId
    joins, the batch cap and serial request/checkpoint behavior remain unchanged.
    Eleven interleaved bits cover the complete 1,441 by 721 world grid.
    """
    lat, lng = map(float, key.split(","))
    x, y = math.floor((lng + 180) * 4), math.floor((lat + 90) * 4)
    morton = 0
    for bit in range(11):
        morton |= ((x >> bit) & 1) << (2 * bit)
        morton |= ((y >> bit) & 1) << (2 * bit + 1)
    return morton, lat, lng


def read_catalogue(path):
    payload = json.loads(Path(path).read_text())
    rows = payload.get("sites", payload.get("records")) if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ElevationError("Catalogue must contain nonempty sites or records")
    result = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]:
            raise ElevationError("Missing catalogue ID")
        key = coordinate_key(row.get("lat"), row.get("lng"))
        states = row.get("states")
        if not isinstance(states, list) or not states or any(not isinstance(s, str) or s not in STATES for s in states):
            raise ElevationError("Invalid catalogue state membership")
        record = {"id": row["id"], "coordinate_key": key, "states": sorted(set(states))}
        old = result.get(row["id"])
        if old and old != record:
            raise ElevationError("Conflicting duplicate catalogue ID")
        result[row["id"]] = record
    return sorted(result.values(), key=lambda r: r["id"])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ElevationError("Unexpected provider redirect")


def retry_after_seconds(headers, now=time.time):
    value = headers.get("Retry-After") if headers else None
    if value is None:
        return 0
    try:
        if re.fullmatch(r"\d+", value.strip()):
            delay = int(value.strip())
        else:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                raise ValueError("Missing Retry-After timezone")
            delay = max(0, math.ceil(date.timestamp() - now()))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ElevationError("Invalid provider Retry-After; checkpoint preserved") from exc
    if delay > MAX_RETRY_AFTER:
        raise ElevationError("Provider Retry-After exceeds 60 seconds; resume later from checkpoint")
    return delay


def request_json(endpoint, params, opener=None, sleep=time.sleep):
    if endpoint not in (SERVICE, SAMPLES):
        raise ElevationError("Unapproved provider endpoint")
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    url = endpoint + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        delay = 2 ** (attempt + 1)
        read_started = False
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "KampTrail-Elevation/1.0", "Accept": "application/json"})
            with opener(req, timeout=45) as response:
                if response.geturl().split("?")[0] != endpoint:
                    raise ElevationError("Unexpected response endpoint")
                read_started = True
                content = response.read(MAX_BYTES + 1)
                if len(content) > MAX_BYTES:
                    raise ElevationError("Provider response too large")
                data = json.loads(content)
            if not isinstance(data, dict) or "error" in data:
                raise ElevationError("USGS returned an error or invalid JSON object")
            return data
        except urllib.error.HTTPError as exc:
            if exc.code not in (408, 429, 500, 502, 503, 504):
                raise ElevationError(f"USGS HTTP {exc.code}") from exc
            retry_after = retry_after_seconds(exc.headers) if exc.code in (429, 503) else 0
            if attempt == 2:
                raise RetryableElevationError(f"USGS HTTP {exc.code} after three attempts", retry_after,
                                              subdividable=exc.code in (408, 502, 504)) from exc
            delay = max(delay, retry_after)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if attempt == 2:
                raise RetryableElevationError("USGS transport failure after three attempts",
                                              subdividable=read_started and (isinstance(exc, TimeoutError) or
                                              (isinstance(exc, urllib.error.URLError) and isinstance(exc.reason, TimeoutError)))) from exc
        except (ValueError, UnicodeError) as exc:
            raise ElevationError("Invalid provider JSON") from exc
        sleep(delay)
    raise ElevationError("Exhausted retries")


def source_metadata(data):
    """Service publication metadata is not the acquisition date of each sample."""
    if (not isinstance(data, dict) or "error" in data or data.get("name") != "3DEPElevation"
            or data.get("serviceDataType") != "esriImageServiceDataTypeElevation" or data.get("bandCount") != 1):
        raise ElevationError("Invalid service metadata")
    return {"name": "USGS 3D Elevation Program (3DEP)", "url": SERVICE,
            "sample_url": SAMPLES, "units": "metres", "interpolation": INTERPOLATION,
            "horizontal_crs": "EPSG:4326", "vertical_datum": "varies by source; not identified per sample",
            "metadata_retrieved_at": utcnow(),
            "service_metadata": {k: data[k] for k in ("name", "description", "serviceDescription", "copyrightText", "pixelType", "bandCount", "minPixelSize", "maxPixelSize", "spatialReference", "serviceDataType", "capabilities", "fields", "timeInfo") if k in data}}


def sample_params(keys):
    if not keys or len(keys) > MAX_BATCH or len(set(keys)) != len(keys):
        raise ElevationError("Invalid sample batch")
    points = [[float(k.split(",")[1]), float(k.split(",")[0])] for k in keys]
    return {"f": "json", "geometry": json.dumps({"points": points, "spatialReference": {"wkid": 4326}}),
            "geometryType": "esriGeometryMultipoint", "interpolation": INTERPOLATION,
            "returnFirstValueOnly": "true", "outFields": "*"}


def parse_samples(data, keys, source, retrieved_at=None):
    if not isinstance(data, dict) or "error" in data or not isinstance(data.get("samples"), list):
        raise ElevationError("Invalid samples response")
    rows = data["samples"]
    if len(rows) > 2 * len(keys):
        raise ElevationError("Excess provider samples")
    grouped = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ElevationError("Invalid sample object")
        location_id = row.get("locationId")
        if isinstance(location_id, bool) or not isinstance(location_id, int) or not 0 <= location_id < len(keys):
            raise ElevationError("Invalid sample locationId")
        grouped.setdefault(location_id, []).append(row)
    result = {}
    for index, key in enumerate(keys):
        matches = grouped.get(index, [])
        record = {"coordinate_key": key, "status": "unknown", "elevation_m": None,
                  "retrieved_at": retrieved_at or utcnow(), "source": {k: source[k] for k in
                      ("name", "url", "sample_url", "units", "interpolation", "horizontal_crs")},
                  "service_metadata_id": hashlib.sha256(encoded(source)).hexdigest(),
                  "sample_coordinates": None, "vertical_datum": None, "acquisition_metadata": None,
                  "reason": "missing_sample"}
        if len(matches) > 1:
            record["reason"] = "duplicate_location_id"
        elif matches:
            row = matches[0]
            location = row.get("location")
            if not isinstance(location, dict):
                raise ElevationError("Missing sample coordinates")
            sr = location.get("spatialReference", {})
            if not isinstance(sr, dict) or sr.get("latestWkid", sr.get("wkid")) != 4326:
                raise ElevationError("Unexpected sample coordinate reference system")
            if coordinate_key(location.get("y"), location.get("x")) != key:
                raise ElevationError("Sample coordinates disagree with locationId")
            value = row.get("value")
            attributes = row.get("attributes")
            record["sample_attributes"] = attributes if isinstance(attributes, dict) else {}
            record["raster_id"] = row.get("rasterId")
            record["resolution"] = row.get("resolution")
            record["sample_coordinates"] = {"lat": number(location["y"]), "lng": number(location["x"])}
            record["vertical_datum"] = record["sample_attributes"].get("VerticalDatum") or None
            record["acquisition_metadata"] = {k: record["sample_attributes"][k] for k in
                ("AcquisitionDate", "StartDate", "EndDate", "pubdate", "Cdate") if record["sample_attributes"].get(k) is not None} or None
            if value is None or (isinstance(value, str) and value.strip().lower() in ("", "nodata", "no data", "nan")):
                record["reason"] = "no_coverage"
            else:
                elevation = number(value)
                if elevation < -500 or elevation > 9000:
                    record["reason"] = "invalid_or_nodata_value"
                else:
                    record.update(status="known", elevation_m=elevation)
                    record.pop("reason")
        result[key] = record
    return result


def valid_cached(key, record):
    try:
        if not isinstance(record, dict) or record.get("coordinate_key") != key:
            return False
        lat, lng = key.split(",")
        if coordinate_key(lat, lng) != key:
            return False
        source = record.get("source", {})
        if (source.get("sample_url") != SAMPLES or source.get("url") != SERVICE
                or source.get("horizontal_crs") != "EPSG:4326"
                or source.get("units") != "metres" or source.get("interpolation") != INTERPOLATION):
            return False
        if not valid_timestamp(record.get("retrieved_at")):
            return False
        if record.get("status") == "unknown":
            if record.get("elevation_m") is not None:
                return False
            if record.get("reason") in {"missing_sample", "duplicate_location_id"}:
                return record.get("sample_coordinates") is None
            sample = record.get("sample_coordinates") or {}
            return (record.get("reason") in {"no_coverage", "invalid_or_nodata_value"}
                    and coordinate_key(sample.get("lat"), sample.get("lng")) == key)
        sample = record.get("sample_coordinates") or {}
        if coordinate_key(sample.get("lat"), sample.get("lng")) != key:
            return False
        return (record.get("status") == "known" and isinstance(record.get("elevation_m"), (int, float))
                and not isinstance(record.get("elevation_m"), bool)
                and -500 <= number(record.get("elevation_m")) <= 9000)
    except (ValueError, TypeError, AttributeError, ElevationError):
        return False


def cache_entry_valid(key, cache):
    record = cache["coordinates"].get(key)
    if not valid_cached(key, record):
        return False
    sid = record.get("service_metadata_id")
    sources = cache.get("sources", {})
    if not isinstance(sid, str) or not isinstance(sources, dict):
        return False
    source = sources.get(sid)
    if not isinstance(source, dict):
        return False
    try:
        metadata = source.get("service_metadata")
        # A checksum proves consistency, not that the cached metadata describes
        # this provider. Apply the same contract used on network responses.
        source_metadata(metadata)
        return (valid_timestamp(source.get("metadata_retrieved_at"))
                and all(source.get(field) == value for field, value in record["source"].items())
                and hashlib.sha256(encoded(source)).hexdigest() == sid)
    except (ValueError, TypeError, AttributeError, ElevationError):
        return False


def load_cache(path):
    if not Path(path).exists():
        return {"version": 1, "coordinates": {}, "sources": {}}
    cache = json.loads(Path(path).read_text())
    if (not isinstance(cache, dict) or cache.get("version") != 1
            or not isinstance(cache.get("coordinates"), dict) or not isinstance(cache.get("sources", {}), dict)):
        raise ElevationError("Invalid cache; preserve it for inspection")
    return cache


def enrich(catalogue, cache_path, request=request_json, batch_size=MAX_BATCH, limit=None, sleep=time.sleep, retry_unknown=False):
    if not 1 <= batch_size <= MAX_BATCH:
        raise ElevationError("Batch size must be 1–50")
    cache = load_cache(cache_path)
    keys = sorted({r["coordinate_key"] for r in catalogue}, key=spatial_order)
    pending = [k for k in keys if not cache_entry_valid(k, cache)
               or (retry_unknown and cache["coordinates"][k]["status"] == "unknown")]
    if limit is not None:
        if limit < 1:
            raise ElevationError("Limit must be positive")
        pending = pending[:limit]
    if pending:
        source = source_metadata(request(SERVICE, {"f": "json"}))
        cache.setdefault("sources", {})[hashlib.sha256(encoded(source)).hexdigest()] = source
        def sample_batch(batch, depth=0, required_delay=0):
            # Also pace the first sample after metadata and every split request.
            sleep(max(0.5, required_delay))
            try:
                data = request(SAMPLES, sample_params(batch))
            except RetryableElevationError as exc:
                if not exc.subdividable or depth >= MAX_SPLIT_DEPTH or len(batch) < 2 * MIN_SPLIT_BATCH:
                    raise
                middle = len(batch) // 2
                # Depth-first: a persistent first-child failure aborts immediately.
                sample_batch(batch[:middle], depth + 1, exc.retry_after)
                sample_batch(batch[middle:], depth + 1)
                return
            # Contract failures cannot trigger bisection or become NoData records.
            values = parse_samples(data, batch, source)
            cache["coordinates"].update(values)
            cache["updated_at"] = utcnow()
            atomic_write(cache_path, cache)
        for offset in range(0, len(pending), batch_size):
            sample_batch(pending[offset:offset + batch_size])
    complete = all(cache_entry_valid(k, cache) for k in keys)
    return cache, complete


def publish(catalogue, cache, directory):
    """Stage immutable files; the atomic manifest switch commits the snapshot."""
    directory = Path(directory)
    coordinates = cache["coordinates"]
    if not all(cache_entry_valid(r["coordinate_key"], cache) for r in catalogue):
        raise ElevationError("Incomplete cache; previous public snapshot preserved")
    state_records = {}
    for row in catalogue:
        for state in row["states"]:
            state_records.setdefault(state, {})[row["id"]] = coordinates[row["coordinate_key"]]
    snapshot_id = hashlib.sha256(encoded(state_records)).hexdigest()[:24]
    manifest = {"version": 1, "snapshot_id": snapshot_id, "generated_at": utcnow(),
                "source": {"name": "USGS 3DEP", "url": SERVICE, "units": "metres", "interpolation": INTERPOLATION}, "states": {}}
    for state, records in sorted(state_records.items()):
        source_ids = {r["service_metadata_id"] for r in records.values()}
        payload = {"version": 1, "snapshot_id": snapshot_id, "state": state, "records": records,
                   "sources": {sid: cache["sources"][sid] for sid in sorted(source_ids)}}
        relative = f"snapshots/{snapshot_id}/{state}.json"
        atomic_write(directory / relative, payload)
        manifest["states"][state] = {"url": relative, "sha256": hashlib.sha256(encoded(payload)).hexdigest(), "count": len(records)}
    # Every immutable sidecar exists before this single publication commit.
    previous = None
    if (directory / "index.json").exists():
        old_manifest = json.loads((directory / "index.json").read_text())
        previous = old_manifest.get("snapshot_id")
        if previous == snapshot_id:
            previous = old_manifest.get("previous_snapshot_id")
    manifest["previous_snapshot_id"] = previous
    atomic_write(directory / "index.json", manifest)
    # Keep current and immediately previous immutable generation. Cleanup cannot
    # invalidate publication; a failed cleanup merely leaves an orphan for next run.
    for generation in (directory / "snapshots").iterdir():
        if generation.is_dir() and generation.name not in {snapshot_id, previous}:
            try:
                shutil.rmtree(generation)
            except OSError:
                pass
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue", type=Path, default=ROOT / "data/campsites/search-index.json")
    parser.add_argument("--cache", type=Path, default=ROOT / "data/sources/elevation.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/campsites/elevation")
    parser.add_argument("--batch-size", type=int, default=MAX_BATCH)
    parser.add_argument("--limit", type=int, help="Maximum new coordinate requests; incomplete catalogues cannot publish")
    parser.add_argument("--no-publish", action="store_true")
    parser.add_argument("--retry-unknown", action="store_true", help="Explicitly resample prior unknown coverage; known entries remain cached")
    args = parser.parse_args()
    catalogue = read_catalogue(args.catalogue)
    cache, complete = enrich(catalogue, args.cache, batch_size=args.batch_size, limit=args.limit, retry_unknown=args.retry_unknown)
    if not args.no_publish:
        if not complete:
            raise ElevationError("Pilot complete; catalogue incomplete, publication refused")
        publish(catalogue, cache, args.output)
    print(json.dumps({"catalogue_records": len(catalogue), "cached_coordinates": len(cache["coordinates"]), "complete": complete, "published": not args.no_publish}))


if __name__ == "__main__":
    try:
        main()
    except (ElevationError, OSError, ValueError) as exc:
        raise SystemExit(f"Elevation enrichment failed: {exc}")

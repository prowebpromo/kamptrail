#!/usr/bin/env python3
"""Publish bounded forecast assets without committing volatile data to Git.

Only --publish performs remote writes. GITHUB_TOKEN is read from the environment,
never from arguments. The HTTP transport never includes response bodies or URLs in
errors; public asset requests carry no authorization, including redirects.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import email.utils
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

REPOSITORY = 'prowebpromo/kamptrail'
REPOSITORY_ID = 967717280
TAG = 'forecast-data-v1'
API_ROOT = f'/repos/{REPOSITORY}'
PUBLIC_ROOT = f'https://github.com/{REPOSITORY}/releases/download/{TAG}/'
POINTERS = ('current-a.json', 'current-b.json')
STATES = frozenset('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
REGIONS = frozenset(('conus', 'alaska', 'hawaii'))
SOURCE_ROOT = 'https://noaa-ndfd-pds.s3.amazonaws.com/opnl/'
MIB = 1024 * 1024
MAX_MANIFEST = 256 * 1024
MAX_COMPRESSED = 2 * MIB
MAX_RAW = 8 * MIB
MAX_METADATA = 2 * MIB
MAX_GENERATIONS = 8
MAX_ASSETS = (MAX_GENERATIONS + 1) * 51 + 2
MAX_REMOTE_BYTES = (MAX_GENERATIONS + 1) * 100 * MIB
GRACE_SECONDS = 1800
MAX_AGE = 10800
SNAPSHOT = re.compile(r'^[a-f0-9]{24}$')
HASH = re.compile(r'^[a-f0-9]{64}$')
ASSET = re.compile(r'^forecast-v1-([a-f0-9]{24})-([A-Z]{2}\.json\.gz|manifest\.json)$')
STAMP = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
COORDINATE = re.compile(r'^-?\d{1,2}\.\d{7},-?\d{1,3}\.\d{7}$')


class PublishError(Exception):
    """Only fixed, non-sensitive reason strings may enter this exception."""


def require(condition, reason='invalid_forecast'):
    if not condition:
        raise PublishError(reason)


def timestamp(value):
    require(isinstance(value, str) and STAMP.fullmatch(value) is not None)
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, OverflowError):
        raise PublishError('invalid_forecast') from None
    require(1577836800 <= result <= 4133980800)
    return result


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def finite(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def digest(value):
    return hashlib.sha256(value).hexdigest()


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate_json_key')
        result[key] = value
    return result


def decode_json(raw, limit=MAX_MANIFEST):
    require(isinstance(raw, bytes) and len(raw) <= limit, 'too_large')
    try:
        result = json.loads(raw.decode('utf-8'), object_pairs_hook=no_duplicates,
                            parse_constant=lambda _: (_ for _ in ()).throw(PublishError('invalid_forecast')))
    except (UnicodeError, ValueError, RecursionError):
        raise PublishError('invalid_forecast') from None
    require(isinstance(result, dict))
    return result


def encode_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def validate_manifest(raw, now, *, allow_expired=False):
    m = decode_json(raw)
    require(set(m) == {'version', 'snapshot_id', 'catalogue_sha256', 'generated_at', 'expires_at', 'source', 'regions', 'states', 'coverage'})
    require(m.get('version') == 1 and type(m['version']) is int)
    sid = m.get('snapshot_id')
    require(isinstance(sid, str) and SNAPSHOT.fullmatch(sid))
    require(isinstance(m.get('catalogue_sha256'), str) and HASH.fullmatch(m['catalogue_sha256']))
    generated, expires = timestamp(m.get('generated_at')), timestamp(m.get('expires_at'))
    require(generated <= now + 300 and generated < expires <= generated + MAX_AGE)
    if not allow_expired:
        require(expires > now, 'stale_forecast')
    source = m.get('source')
    require(isinstance(source, dict) and set(source) == {'name', 'files'} and source.get('name') == 'NOAA/NWS NDFD')
    files = source.get('files')
    require(isinstance(files, list) and len(files) == 3)
    found, total_source = set(), 0
    for entry in files:
        require(isinstance(entry, dict))
        require(set(entry) == {'region', 'url', 'etag', 'last_modified', 'bytes', 'sha256'})
        require(isinstance(entry.get('sha256'), str) and HASH.fullmatch(entry['sha256']))
        region = entry.get('region')
        require(isinstance(region, str) and region in REGIONS and region not in found)
        found.add(region)
        require(entry.get('url') == f'{SOURCE_ROOT}AR.{region}/VP.001-003/ds.temp.bin')
        modified = timestamp(entry.get('last_modified'))
        require(modified <= generated + 300 and modified <= now + 300 and expires <= modified + MAX_AGE)
        require(isinstance(entry.get('etag'), str) and len(entry['etag'].encode('utf-8')) <= 256 and not any(ord(c) < 32 or ord(c) == 127 for c in entry['etag']))
        require(integer(entry.get('bytes'), 1, 150 * MIB))
        total_source += entry['bytes']
    require(total_source <= 150 * MIB)
    regions = m.get('regions')
    require(isinstance(regions, dict) and set(regions) == REGIONS)
    for region, info in regions.items():
        require(isinstance(info, dict) and isinstance(info.get('grid_sha256'), str) and HASH.fullmatch(info['grid_sha256']))
        require(set(info) == {'times', 'grid_sha256', 'max_step_seconds', 'reference_times'})
        references = info.get('reference_times')
        require(isinstance(references, list) and 1 <= len(references) <= 100)
        parsed_references = [timestamp(value) for value in references]
        require(parsed_references == sorted(set(parsed_references)))
        require(integer(info.get('max_step_seconds'), 1, 10800))
        times = info.get('times')
        require(isinstance(times, list) and 1 <= len(times) <= 100)
        parsed = [timestamp(value) for value in times]
        require(all(0 < right - left <= info['max_step_seconds'] for left, right in zip(parsed, parsed[1:])))
        require(parsed[0] >= generated - 86400 and parsed[-1] <= generated + 8 * 86400)
        # GRIB Section 1 significance 1 is the forecast start, not publication
        # time. NOAA can publish it before that start; actual source-file times
        # above still control freshness and expiry.
        require(parsed_references[-1] <= parsed[-1])
    states = m.get('states')
    require(isinstance(states, dict) and set(states) == STATES)
    record_total = 0
    for state, entry in states.items():
        require(isinstance(entry, dict))
        require(set(entry) == {'asset', 'sha256', 'json_sha256', 'bytes', 'json_bytes', 'count'})
        require(entry.get('asset') == f'forecast-v1-{sid}-{state}.json.gz')
        require(all(isinstance(entry.get(key), str) and HASH.fullmatch(entry[key]) for key in ('sha256', 'json_sha256')))
        require(integer(entry.get('bytes'), 1, MAX_COMPRESSED) and integer(entry.get('json_bytes'), 2, MAX_RAW))
        require(integer(entry.get('count'), 0, 20000))
        record_total += entry['count']
    coverage = m.get('coverage')
    require(isinstance(coverage, dict) and set(coverage) == {'total', 'grid_known', 'unknown'} and all(integer(coverage.get(key), 0, 100000) for key in ('total', 'grid_known', 'unknown')))
    require(coverage['grid_known'] + coverage['unknown'] == coverage['total'])
    require(coverage['total'] <= record_total)
    return m


def decompress(raw):
    require(len(raw) <= MAX_COMPRESSED, 'too_large')
    try:
        reader = zlib.decompressobj(16 + zlib.MAX_WBITS)
        decoded = reader.decompress(raw, MAX_RAW + 1)
        require(len(decoded) <= MAX_RAW and not reader.unconsumed_tail, 'too_large')
        require(reader.eof and not reader.unused_data, 'invalid_gzip')
    except zlib.error:
        raise PublishError('invalid_gzip') from None
    return decoded


def validate_state(compressed, state, manifest):
    entry = manifest['states'][state]
    require(len(compressed) == entry['bytes'] and digest(compressed) == entry['sha256'], 'asset_hash_mismatch')
    raw = decompress(compressed)
    require(len(raw) == entry['json_bytes'] and digest(raw) == entry['json_sha256'], 'asset_hash_mismatch')
    data = decode_json(raw, MAX_RAW)
    require(set(data) == {'version', 'snapshot_id', 'state', 'generated_at', 'expires_at', 'records'})
    require(data.get('version') == 1 and type(data['version']) is int)
    require(all(data.get(key) == manifest[key] for key in ('snapshot_id', 'generated_at', 'expires_at')))
    require(data.get('state') == state)
    records = data.get('records')
    require(isinstance(records, dict) and len(records) == entry['count'])
    for site_id, record in records.items():
        require(isinstance(site_id, str) and 0 < len(site_id.encode('utf-8')) <= 200 and not any(ord(c) < 32 or ord(c) == 127 for c in site_id))
        require(isinstance(record, dict))
        key = record.get('coordinate_key')
        require(isinstance(key, str) and COORDINATE.fullmatch(key))
        lat, lng = map(float, key.split(','))
        require(abs(lat) <= 90 and abs(lng) <= 180)
        require(key == f'{lat if lat else 0.0:.7f},{lng if lng else 0.0:.7f}')
        if record.get('status') == 'unknown':
            require(set(record) == {'coordinate_key', 'status', 'reason'})
            require(isinstance(record['reason'], str) and 0 < len(record['reason'].encode('utf-8')) <= 100 and not any(ord(c) < 32 or ord(c) == 127 for c in record['reason']))
            continue
        require(set(record) == {'coordinate_key', 'region', 'status', 'grid_lat', 'grid_lng', 'grid_distance_m', 'temperatures_c'})
        require(record.get('status') == 'known' and record.get('region') in REGIONS)
        require(finite(record.get('grid_lat'), -90, 90) and finite(record.get('grid_lng'), -180, 180))
        require(finite(record.get('grid_distance_m'), 0, 5000))
        temperatures = record.get('temperatures_c')
        require(isinstance(temperatures, list) and len(temperatures) == len(manifest['regions'][record['region']]['times']))
        require(all(value is None or finite(value, -100, 70) for value in temperatures))
    return data


def read_file(path, limit):
    try:
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_size <= limit, 'unsafe_local_asset')
        with path.open('rb') as stream:
            result = stream.read(limit + 1)
        require(len(result) <= limit, 'too_large')
        return result
    except OSError:
        raise PublishError('local_asset_unavailable') from None


def load_package(folder, catalogue_index, now):
    folder = Path(folder)
    require(folder.is_dir() and not folder.is_symlink(), 'unsafe_local_asset')
    raw = read_file(folder / 'manifest.json', MAX_MANIFEST)
    manifest = validate_manifest(raw, now)
    index = decode_json(read_file(Path(catalogue_index), 4096), 4096)
    require(set(index) == {'version', 'sha256', 'count'} and type(index.get('version')) is int and integer(index.get('count'), 0, 100000), 'catalogue_mismatch')
    require(index.get('version') == 1 and index.get('sha256') == manifest['catalogue_sha256'], 'catalogue_mismatch')
    require(index.get('count') == manifest['coverage']['total'], 'catalogue_mismatch')
    files = {}
    unique, memberships = {}, {}
    for state, entry in manifest['states'].items():
        data = read_file(folder / entry['asset'], MAX_COMPRESSED)
        state_data = validate_state(data, state, manifest)
        files[entry['asset']] = data
        for site_id, record in state_data['records'].items():
            previous = unique.get(site_id)
            require(previous is None or previous == record, 'conflicting_site_record')
            unique[site_id] = record
            memberships.setdefault(site_id, []).append(state)
    require(len(unique) == index['count'], 'catalogue_mismatch')
    rows = [[site_id, unique[site_id]['coordinate_key'], sorted(memberships[site_id])] for site_id in sorted(unique, key=lambda value: value.encode('utf-8'))]
    require(digest(encode_json(rows)) == manifest['catalogue_sha256'], 'catalogue_mismatch')
    require(sum(record['status'] == 'known' for record in unique.values()) == manifest['coverage']['grid_known'])
    allowed = {'manifest.json', *files}
    require(all(path.name in allowed and path.is_file() and not path.is_symlink() for path in folder.iterdir()), 'unexpected_local_asset')
    return manifest, raw, files


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def response_delay(headers, now):
    value = headers.get('Retry-After') or headers.get('retry-after')
    if value is not None:
        try:
            seconds = float(value)
        except (ValueError, TypeError):
            try:
                seconds = email.utils.parsedate_to_datetime(value).timestamp() - now
            except (TypeError, ValueError, OverflowError):
                raise PublishError('rate_limited') from None
        require(math.isfinite(seconds) and 0 <= seconds <= 30, 'rate_limited')
        return max(1, seconds)
    if headers.get('X-RateLimit-Remaining') == '0':
        try:
            seconds = float(headers.get('X-RateLimit-Reset', '0')) - now
        except ValueError:
            raise PublishError('rate_limited') from None
        require(0 <= seconds <= 30, 'rate_limited')
        return max(1, seconds)
    return 2


class GitHub:
    def __init__(self, token, *, opener=None, sleep=time.sleep, clock=time.time):
        require(isinstance(token, str) and token and '\n' not in token and '\r' not in token, 'missing_github_token')
        self._token = token
        self.opener = opener or urllib.request.build_opener(NoRedirect)
        self.sleep, self.clock = sleep, clock
        self.last_mutation = None

    def _request(self, method, url, *, body=None, content_type='application/json', limit=MAX_METADATA, authenticated=False, accept='application/vnd.github+json'):
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == 'https' and not parsed.username and not parsed.password and parsed.port in (None, 443), 'invalid_transport_target')
        if authenticated:
            require(parsed.hostname in ('api.github.com', 'uploads.github.com') and (parsed.path == API_ROOT or parsed.path.startswith(API_ROOT + '/')), 'invalid_transport_target')
        headers = {'User-Agent': 'KampTrail-forecast-publisher', 'Accept': accept}
        if authenticated:
            headers['Authorization'] = 'Bearer ' + self._token
            headers['X-GitHub-Api-Version'] = '2022-11-28'
        if body is not None:
            headers['Content-Type'] = content_type
        if method not in ('GET', 'HEAD'):
            if self.last_mutation is not None:
                self.sleep(max(0, 1 - (self.clock() - self.last_mutation)))
            self.last_mutation = self.clock()
        for attempt in range(3 if method == 'GET' else 1):
            try:
                req = urllib.request.Request(url, data=body, method=method, headers=headers)
                try:
                    response = self.opener.open(req, timeout=20)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    status, response_headers = response.code, response.headers
                    raw = response.read(limit + 1)
                # Error pages are not asset bytes or API results. Bound the read
                # above, discard their bodies, and retain status for retry logic.
                if status >= 400:
                    raw = b''
                else:
                    require(len(raw) <= limit, 'remote_response_too_large')
            except (urllib.error.URLError, OSError, TimeoutError, ValueError):
                if method == 'GET' and attempt < 2:
                    self.sleep(2 ** attempt)
                    continue
                raise PublishError('github_transport_failed') from None
            if status in (429, 500, 502, 503, 504) or (status == 403 and (response_headers.get('Retry-After') or response_headers.get('X-RateLimit-Remaining') == '0')):
                if method == 'GET' and attempt < 2:
                    self.sleep(response_delay(response_headers, self.clock()))
                    continue
                raise PublishError('github_rate_or_service_unavailable')
            return status, response_headers, raw
        raise PublishError('github_transport_failed')

    def api(self, method, suffix, body=None, allowed=(200,)):
        require(suffix == '' or suffix.startswith('/'), 'invalid_transport_target')
        status, _, raw = self._request(method, 'https://api.github.com' + API_ROOT + suffix,
                                      body=None if body is None else encode_json(body), authenticated=True)
        require(status in allowed, 'github_api_failed')
        if status == 204 or not raw:
            return status, None
        try:
            result = json.loads(raw.decode('utf-8'), object_pairs_hook=no_duplicates)
        except (UnicodeError, ValueError, RecursionError):
            raise PublishError('github_api_invalid') from None
        return status, result

    def _download(self, url, limit, *, api_first=False):
        for hop in range(4):
            parsed = urllib.parse.urlsplit(url)
            first_api = hop == 0 and api_first
            allowed = ('api.github.com',) if first_api else (('github.com',) if hop == 0 else ('release-assets.githubusercontent.com',))
            require(parsed.scheme == 'https' and parsed.hostname in allowed and not parsed.username and not parsed.password and parsed.port in (None, 443), 'invalid_redirect')
            for visibility_attempt in range(4):
                status, headers, raw = self._request('GET', url, limit=limit, authenticated=first_api, accept='application/octet-stream')
                # A just-uploaded public asset may not yet be visible at the
                # download endpoint. Keep pointers unchanged until its exact
                # bytes pass verification. Authenticated draft reads and 403s
                # do not receive this visibility retry.
                if status != 404 or api_first or visibility_attempt == 3:
                    break
                delay = response_delay(headers, self.clock()) if headers.get('Retry-After') else 2 ** visibility_attempt
                self.sleep(delay)
            if status == 200:
                return raw
            require(status in (301, 302, 303, 307, 308), f'public_asset_unavailable_{status}')
            location = headers.get('Location')
            require(isinstance(location, str) and location, 'invalid_redirect')
            url = urllib.parse.urljoin(url, location)
        raise PublishError('redirect_limit')

    def public(self, name, limit):
        require(name in POINTERS or ASSET.fullmatch(name), 'invalid_asset_name')
        return self._download(PUBLIC_ROOT + name, limit)

    def asset_bytes(self, asset, limit, *, draft=False):
        if not draft:
            return self.public(asset['name'], limit)
        require(integer(asset.get('id'), 1, 2**63 - 1), 'invalid_asset_id')
        # Draft assets require authenticated API download, but a redirect receives
        # no Authorization header. The fixed API path is constructed locally.
        return self._download(f'https://api.github.com{API_ROOT}/releases/assets/{asset["id"]}', limit, api_first=True)

    def upload(self, release_id, name, data):
        require(integer(release_id, 1, 2**63 - 1) and (name in POINTERS or ASSET.fullmatch(name)), 'invalid_asset_name')
        url = f'https://uploads.github.com{API_ROOT}/releases/{release_id}/assets?name={urllib.parse.quote(name)}'
        status, _, raw = self._request('POST', url, body=data, content_type='application/octet-stream', authenticated=True)
        require(status == 201, 'github_upload_failed')
        result = decode_json(raw, MAX_METADATA)
        require(result.get('name') == name and result.get('state') == 'uploaded' and result.get('size') == len(data), 'github_upload_invalid')
        reported = result.get('digest')
        require(reported in (None, 'sha256:' + digest(data)), 'asset_hash_mismatch')
        return result

    def delete(self, asset_id):
        require(integer(asset_id, 1, 2**63 - 1), 'invalid_asset_id')
        self.api('DELETE', f'/releases/assets/{asset_id}', allowed=(204,))

    def assets(self, release_id):
        result = []
        for page in range(1, 7):
            _, batch = self.api('GET', f'/releases/{release_id}/assets?per_page=100&page={page}')
            require(isinstance(batch, list), 'invalid_release_assets')
            result.extend(batch)
            require(len(result) <= MAX_ASSETS, 'remote_quota')
            if len(batch) < 100:
                break
        else:
            raise PublishError('remote_quota')
        seen, total = set(), 0
        for entry in result:
            require(isinstance(entry, dict) and isinstance(entry.get('name'), str), 'invalid_release_assets')
            name = entry['name']
            require(name not in seen and (name in POINTERS or ASSET.fullmatch(name)), 'unexpected_release_asset')
            require(integer(entry.get('id'), 1, 2**63 - 1) and integer(entry.get('size'), 0, MAX_COMPRESSED), 'invalid_release_assets')
            require(entry.get('state') in ('uploaded', 'starter'), 'invalid_release_assets')
            seen.add(name)
            total += entry['size']
        require(total <= MAX_REMOTE_BYTES, 'remote_quota')
        return {entry['name']: entry for entry in result}


def release_check(release, *, allow_draft=False):
    require(isinstance(release, dict) and integer(release.get('id'), 1, 2**63 - 1), 'invalid_release')
    require(release.get('tag_name') == TAG and release.get('prerelease') is True and (release.get('draft') is False or (allow_draft and release.get('draft') is True)), 'invalid_release')
    require(release.get('immutable') is False, 'immutable_release')
    return release


def ensure_release(api, source_sha):
    _, repository = api.api('GET', '')
    require(isinstance(repository, dict) and repository.get('id') == REPOSITORY_ID and repository.get('full_name') == REPOSITORY and repository.get('private') is False, 'repository_mismatch')
    status, release = api.api('GET', '/releases/tags/' + TAG, allowed=(200, 404))
    if status == 404:
        # Bootstrap as a draft: no empty public immutable release is created.
        # GitHub's policy-inspection endpoint needs Administration:read, outside
        # GITHUB_TOKEN's scope. Published release.immutable is authoritative;
        # if policy activates while bootstrapping, leave the complete immutable
        # release intact and halt rather than weakening the policy.
        _, release = api.api('POST', '/releases', {
            'tag_name': TAG, 'target_commitish': source_sha,
            'name': 'KampTrail forecast data v1',
            'body': 'KampTrail derived NOAA/NWS NDFD forecast data. Automated bounded data channel; not an application release.',
            'draft': True, 'prerelease': True, 'make_latest': 'false',
            'generate_release_notes': False,
        }, allowed=(201,))
    return release_check(release, allow_draft=True)


def read_pointers(api, assets, now, *, draft=False):
    pointers = {}
    for name in POINTERS:
        entry = assets.get(name)
        if not entry or entry.get('state') != 'uploaded':
            continue
        try:
            raw = api.asset_bytes(entry, MAX_MANIFEST, draft=draft)
            require(len(raw) == entry['size'], 'asset_hash_mismatch')
            manifest = validate_manifest(raw, now, allow_expired=True)
            pointers[name] = (manifest, raw)
        except PublishError:
            # A malformed/missing slot can be repaired while the other survives.
            continue
    if len(pointers) == 2:
        left, right = (value[0] for value in pointers.values())
        require(left['generated_at'] != right['generated_at'] or left['snapshot_id'] == right['snapshot_id'], 'pointer_conflict')
        if left['snapshot_id'] == right['snapshot_id']:
            require(left == right, 'pointer_conflict')
    return pointers


def generation_groups(assets):
    result = {}
    for name, asset in assets.items():
        match = ASSET.fullmatch(name)
        if match:
            result.setdefault(match[1], []).append(asset)
    return result


def cleanup(api, assets, pointers, now, *, preserve=()):
    protected = {item[0]['snapshot_id'] for item in pointers.values()} | set(preserve)
    groups = generation_groups(assets)
    removed = []
    for sid, entries in groups.items():
        if sid in protected:
            continue
        manifest_name = f'forecast-v1-{sid}-manifest.json'
        if manifest_name in assets and assets[manifest_name].get('state') == 'uploaded':
            raw = api.public(manifest_name, MAX_MANIFEST)
            manifest = validate_manifest(raw, now, allow_expired=True)
            require(manifest['snapshot_id'] == sid, 'generation_conflict')
            delete_after = timestamp(manifest['expires_at']) + GRACE_SECONDS
        else:
            # Interrupted uploads without a manifest cannot establish source expiry.
            # Every valid generation expires by generated_at+3h; upload time is later.
            delete_after = max(timestamp(entry.get('created_at')) for entry in entries) + MAX_AGE + GRACE_SECONDS
        if now <= delete_after:
            continue
        # Delete manifest last, so interruption retains authoritative expiry.
        for entry in sorted(entries, key=lambda item: item['name'].endswith('-manifest.json')):
            api.delete(entry['id'])
            removed.append(entry['name'])
    for name in removed:
        assets.pop(name, None)
    return len(removed)


def ensure_asset(api, release_id, assets, name, raw, *, allow_starter=False, draft=False):
    current = assets.get(name)
    if current is not None:
        if current.get('state') == 'starter' and allow_starter:
            api.delete(current['id'])
        else:
            require(current.get('state') == 'uploaded' and current.get('size') == len(raw), 'immutable_asset_conflict')
            downloaded = api.asset_bytes(current, max(len(raw), 1), draft=draft)
            require(downloaded == raw, 'immutable_asset_conflict')
            return current
    result = api.upload(release_id, name, raw)
    assets[name] = result
    require(api.asset_bytes(result, max(len(raw), 1), draft=draft) == raw, 'public_asset_verification_failed')
    return result


def publish(api, manifest, raw, files, now, source_sha):
    require(isinstance(source_sha, str) and re.fullmatch('[a-f0-9]{40}', source_sha), 'invalid_source_commit')
    # Validation is repeated here because callers may use the publisher as a library.
    require(validate_manifest(raw, now) == manifest, 'manifest_mismatch')
    require(set(files) == {entry['asset'] for entry in manifest['states'].values()}, 'incomplete_generation')
    for state, entry in manifest['states'].items():
        validate_state(files[entry['asset']], state, manifest)
    release = ensure_release(api, source_sha)
    assets = api.assets(release['id'])
    draft = release.get('draft') is True
    pointers = read_pointers(api, assets, now, draft=draft)
    sid = manifest['snapshot_id']
    already_current = False
    for previous, previous_raw in pointers.values():
        if previous['snapshot_id'] == sid:
            require(previous_raw == raw, 'immutable_asset_conflict')
            already_current = True
            continue
        require(timestamp(previous['generated_at']) < timestamp(manifest['generated_at']), 'forecast_rollback')
    deleted = 0 if draft else cleanup(api, assets, pointers, now, preserve=(sid,))
    groups = generation_groups(assets)
    require(sid in groups or len(groups) < MAX_GENERATIONS, 'remote_quota')
    manifest_name = f'forecast-v1-{sid}-manifest.json'
    additions = {**files, manifest_name: raw}
    projected = sum(entry['size'] for entry in assets.values()) + sum(len(data) for name, data in additions.items() if name not in assets)
    require(projected + len(raw) <= MAX_REMOTE_BYTES and len(set(assets) | set(additions) | set(POINTERS)) <= MAX_ASSETS, 'remote_quota')
    protected = {item[0]['snapshot_id'] for item in pointers.values()}
    for name, data in additions.items():
        ensure_asset(api, release['id'], assets, name, data, allow_starter=sid not in protected, draft=draft)
    validate_manifest(raw, max(now, api.clock()))
    if already_current and not draft:
        return {'snapshot_id': sid, 'status': 'unchanged', 'deleted_assets': deleted}
    if draft:
        for name in POINTERS:
            old = assets.get(name)
            if old and api.asset_bytes(old, MAX_MANIFEST, draft=True) != raw:
                api.delete(old['id'])
                assets.pop(name)
            ensure_asset(api, release['id'], assets, name, raw, allow_starter=True, draft=True)
        validate_manifest(raw, max(now, api.clock()))
        _, release = api.api('PATCH', f'/releases/{release["id"]}',
                             {'draft': False, 'prerelease': True, 'make_latest': 'false'})
        release_check(release)  # An immutable result halts without further writes.
        for name, data in {**additions, **{pointer: raw for pointer in POINTERS}}.items():
            require(api.public(name, max(len(data), 1)) == data, 'public_asset_verification_failed')
        return {'snapshot_id': sid, 'status': 'published', 'pointer': 'both', 'deleted_assets': 0}
    # Re-read before the destructive slot step; serialize in Actions, and also
    # detect any external editor or another publisher that ignored that lock.
    _, current_release = api.api('GET', f'/releases/{release["id"]}')
    release_check(current_release)
    latest_assets = api.assets(release['id'])
    latest = read_pointers(api, latest_assets, now)
    require({name: digest(value[1]) for name, value in latest.items()} == {name: digest(value[1]) for name, value in pointers.items()}, 'concurrent_publication')
    require({name: assets.get(name, {}).get('id') for name in POINTERS} == {name: latest_assets.get(name, {}).get('id') for name in POINTERS}, 'concurrent_publication')
    missing = [name for name in POINTERS if name not in pointers]
    target = missing[0] if missing else min(POINTERS, key=lambda name: timestamp(pointers[name][0]['generated_at']))
    # If a valid pointer exists, never select the only valid slot.
    require(not pointers or target not in pointers or len(pointers) == 2, 'unsafe_pointer_replacement')
    validate_manifest(raw, max(now, api.clock()))
    old = latest_assets.get(target)
    if old:
        api.delete(old['id'])
    api.upload(release['id'], target, raw)
    require(api.public(target, MAX_MANIFEST) == raw, 'pointer_propagation_pending')
    final_assets = api.assets(release['id'])
    final_pointers = read_pointers(api, final_assets, now)
    require(target in final_pointers and final_pointers[target][1] == raw, 'pointer_propagation_pending')
    deleted += cleanup(api, final_assets, final_pointers, now, preserve=(sid,))
    return {'snapshot_id': sid, 'status': 'published', 'pointer': target, 'deleted_assets': deleted}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--catalogue-index', type=Path, default=Path('data/campsites/coordinate-index.json'))
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args(argv)
    try:
        now = time.time()
        manifest, raw, files = load_package(args.input, args.catalogue_index, now)
        if not args.publish:
            print(json.dumps({'status': 'validated', 'snapshot_id': manifest['snapshot_id'], 'states': len(files), 'bytes': sum(map(len, files.values()))}))
            return 0
        require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY and os.environ.get('GITHUB_REF') == 'refs/heads/main' and os.environ.get('GITHUB_EVENT_NAME') in ('schedule', 'workflow_dispatch'), 'untrusted_workflow_context')
        api = GitHub(os.environ.get('GITHUB_TOKEN', ''))
        result = publish(api, manifest, raw, files, now, os.environ.get('GITHUB_SHA', ''))
        print(json.dumps(result))
        return 0
    except PublishError as error:
        print('Forecast publication stopped: ' + str(error), file=sys.stderr)
        return 1
    except Exception:
        # Never print traceback, request/response object, environment or exception
        # message from HTTP libraries: they can contain a token/signed URL.
        print('Forecast publication stopped: unexpected_failure', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

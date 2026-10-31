#!/usr/bin/env python3
"""Private FCC public-data download worker. No credentials in argv or output.

API paths and header names must be checked against the current FCC public API
specification before production use. This worker is deliberately not web-routed.
"""
import argparse
import time
import datetime as dt
import getpass
import warnings
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import urllib.error
import urllib.request

BASE = 'https://bdc.fcc.gov/api/public/map/'
ROOT = Path(__file__).resolve().parents[1]
LIMIT = 2 * 1024**3

class SafeError(Exception):
    """Only fixed, non-sensitive messages may leave the worker."""

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SafeError('FCC redirected the request. Review the official download flow before continuing.')

def outside_public(path):
    resolved = Path(path).expanduser().resolve()
    # Also refuse repository-contained storage and conventional hosting web roots.
    if resolved == ROOT or ROOT in resolved.parents or any(p.lower() in {'public_html', 'www', 'htdocs', 'httpdocs'} for p in resolved.parts):
        raise SafeError('Choose a private directory outside the repository and web root.')
    return resolved

def secure_dir(path):
    if os.name != 'posix':
        raise SafeError('Private file operations require Unix. Use check-local for a one-request test.')
    raw = Path(path).expanduser().absolute()
    if any(p.is_symlink() for p in [raw, *raw.parents]):
        raise SafeError('Private storage must not use symbolic links.')
    path = outside_public(raw)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    mode = path.stat()
    if stat.S_IMODE(mode.st_mode) & 0o077 or mode.st_uid != os.getuid():
        raise SafeError('Private directory must be owned by the worker user and have mode 700.')
    return path

def atomic_bytes(path, content):
    fd, tmp = tempfile.mkstemp(prefix='.fcc-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def load_credentials(directory):
    path = directory / 'credentials.json'
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
                raise SafeError('Credential file must be owned by the worker user and have mode 600.')
            try:
                value = json.load(stream)
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise SafeError('Credential file is not valid JSON.') from None
        if not isinstance(value, dict):
            raise SafeError('Credential file must be a JSON object.')
        if not isinstance(value.get('username'), str) or not value['username']:
            raise SafeError('FCC account email field is missing or empty.')
        if not isinstance(value.get('token'), str) or not value['token']:
            raise SafeError('FCC token field is missing or empty.')
        username, token = value['username'], value['token']
        if not all(isinstance(v, str) and v and len(v) <= 512 and not re.search(r'[\x00-\x20\x7f]', v) for v in (username, token)):
            raise SafeError('Credential fields contain whitespace/control characters or exceed the permitted length.')
        return username, token
    except SafeError:
        raise
    except Exception:
        raise SafeError('Private credentials are missing or invalid.') from None

def prompt_credentials():
    if not sys.stdin.isatty():
        raise SafeError('Use an interactive private terminal. Piped credential entry is disabled.')
    # getpass otherwise falls back to echoed input on an unsuitable terminal.
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        username = getpass.getpass('FCC account email (hidden): ').strip()
        token = getpass.getpass('FCC Public Map Data API token (hidden): ').strip()
    if not all(v and len(v) <= 512 and not re.search(r'[\x00-\x20\x7f]', v) for v in (username, token)):
        raise SafeError('Credential input is invalid.')
    return username, token

def setup(directory):
    path = directory / 'credentials.json'
    if path.exists() or path.is_symlink():
        raise SafeError('Credentials already exist. Remove them privately before rotating.')
    username, token = prompt_credentials()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'username': username, 'token': token}, stream)
    print('Credentials saved privately. Values are never printed.')

def reserve_request(directory):
    import fcntl  # The one-shot Windows check never uses Unix private storage or its lock.
    fd = os.open(directory / 'request.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        previous = stream.read().strip()
        try:
            last = float(previous) if previous else 0
        except ValueError:
            raise SafeError('Private rate-limit state is invalid.') from None
        now = time.time()
        if now - last < 6.1:
            raise SafeError('Wait at least seven seconds between FCC requests.')
        stream.seek(0)
        stream.truncate()
        stream.write(str(now))
        stream.flush()
        os.fsync(stream.fileno())


def request(path, credentials, opener=None):
    # API route is constrained; no user-controlled host, query string or redirect.
    if not re.fullmatch(r'(listAsOfDates|downloads/listAvailabilityData/\d{4}-\d{2}-\d{2}|downloads/downloadFile/availability/\d+/[12])', path):
        raise SafeError('Unsupported FCC operation.')
    username, token = credentials
    req = urllib.request.Request(BASE + path, headers={
        'username': username, 'hash_value': token,
        'User-Agent': 'KampTrail coverage importer (+https://github.com/prowebpromo/kamptrail)',
        'Accept': 'application/json, application/zip, application/octet-stream',
    })
    try:
        return (opener or urllib.request.build_opener(NoRedirect())).open(req, timeout=90)
    except urllib.error.HTTPError as exc:
        # Return only fixed format labels. Never emit raw upstream headers or bodies.
        code = exc.code
        try:
            media = (exc.headers or {}).get('Content-Type', '').split(';', 1)[0].strip().lower()
        finally:
            exc.close()
        if code in (401, 403):
            kind = {'application/json': 'JSON', 'application/problem+json': 'JSON',
                    'text/html': 'HTML'}.get(media, 'other/unspecified')
            raise SafeError(f'HTTP {code}; declared response format: {kind}. FCC authentication unconfirmed.') from None
        if code == 429:
            raise SafeError('FCC rate limit reached. Stop and retry later.') from None
        raise SafeError('FCC returned an HTTP error. No response details were logged.') from None
    except SafeError:
        raise
    except Exception:
        raise SafeError('FCC connection failed. No request or credential details were logged.') from None

def read_json(response):
    with response:
        data = response.read(16 * 1024**2 + 1)
    if len(data) > 16 * 1024**2:
        raise SafeError('FCC metadata exceeds the permitted size.')
    try:
        value = json.loads(data)
    except Exception:
        raise SafeError('FCC did not return valid metadata.') from None
    if not isinstance(value, dict) or value.get('status_code') != 200 or value.get('status') in {'fail', 'failed', 'error'} or not isinstance(value.get('data'), list):
        raise SafeError('FCC metadata schema or authentication result was not accepted.')
    return value

def download(response, destination):
    fd, tmp = tempfile.mkstemp(prefix='.download-', dir=destination.parent)
    size, digest = 0, hashlib.sha256()
    try:
        with response, os.fdopen(fd, 'wb') as stream:
            first = True
            while True:
                block = response.read(1024**2)
                if not block:
                    break
                if first and not block.startswith(b'PK\x03\x04'):
                    raise SafeError('FCC did not return a ZIP archive. The previous download was preserved.')
                first = False
                size += len(block)
                if size > LIMIT:
                    raise SafeError('FCC archive exceeds the permitted size.')
                digest.update(block)
                stream.write(block)
            if size < 4:
                raise SafeError('FCC archive was empty.')
            stream.flush()
            os.fsync(stream.fileno())
        import zipfile
        if not zipfile.is_zipfile(tmp):
            raise SafeError('FCC archive validation failed.')
        os.replace(tmp, destination)
        return {'bytes': size, 'sha256': digest.hexdigest()}
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-dir', help='Owned mode-700 directory outside repo/web root (Unix)')
    parser.add_argument('--spec-verified', action='store_true', help='Confirm paths/headers against current official public API specification')
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('setup')
    sub.add_parser('check')
    sub.add_parser('check-local', help='Use hidden prompts for one dates request; saves no credentials (Windows or Unix)')
    listing = sub.add_parser('list')
    listing.add_argument('--as-of', required=True, type=dt.date.fromisoformat)
    dl = sub.add_parser('download')
    dl.add_argument('--file-id', required=True, type=int)
    dl.add_argument('--format', choices=('1', '2'), default='2')
    dl.add_argument('--as-of', required=True, type=dt.date.fromisoformat)
    args = parser.parse_args()
    if args.action == 'check-local':
        if args.private_dir:
            parser.error('check-local does not use private storage')
    else:
        if not args.private_dir:
            parser.error('--private-dir is required for private-storage commands')
        directory = secure_dir(args.private_dir)
    if args.action == 'setup':
        return setup(directory)
    if not args.spec_verified:
        raise SafeError('Verify the current official API specification before network access. No request was sent.')
    if args.action == 'check-local':
        credentials = prompt_credentials()
    else:
        credentials = load_credentials(directory)
        reserve_request(directory)
    if args.action in ('check', 'check-local'):
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        print(f'FCC dates request: {stamp}', flush=True)
        response = request('listAsOfDates', credentials)
        if response.getcode() != 200:
            response.close()
            raise SafeError('Unexpected HTTP success status. Authentication is unconfirmed.')
        dates = read_json(response)
        if not any(isinstance(row, dict) and row.get('data_type') == 'availability'
                   and isinstance(row.get('as_of_date'), str)
                   and re.fullmatch(r'\d{4}-\d{2}-\d{2}', row['as_of_date']) for row in dates['data']):
            raise SafeError('No availability filing date recognized. Authentication is unconfirmed.')
        print('HTTP 200; FCC availability filing dates received. Authentication succeeded.')
    elif args.action == 'list':
        value = read_json(request(f'downloads/listAvailabilityData/{args.as_of}', credentials))
        # Retain metadata privately; do not echo arbitrary upstream fields to logs.
        atomic_bytes(directory / 'availability.json', json.dumps(value).encode())
        print('Availability metadata saved privately. Select only Mobile Broadband availability files, never Fabric.')
    else:
        if args.file_id < 1:
            raise SafeError('File ID must be positive.')
        destination = directory / f'availability-{args.as_of}-{args.file_id}-{args.format}.zip'
        meta = download(request(f'downloads/downloadFile/availability/{args.file_id}/{args.format}', credentials), destination)
        meta.update({'as_of': str(args.as_of), 'file_id': args.file_id, 'retrieved_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'source': BASE, 'published': False})
        atomic_bytes(destination.with_suffix('.json'), json.dumps(meta).encode())
        print('Archive saved privately with SHA-256 and retrieval date. Nothing was published.')

if __name__ == '__main__':
    try:
        main()
    except SafeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        # No traceback: libraries may include request details in exception strings.
        print('Worker stopped safely. No diagnostic request details were printed.', file=sys.stderr)
        sys.exit(1)

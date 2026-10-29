#!/usr/bin/env python3
"""Hostinger CLI-only authentication probe. Never outputs credentials or raw errors."""
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import time

BASE = Path(__file__).resolve().parent
DATA = BASE.parent / 'fcc-data'

def main():
    module = importlib.util.spec_from_file_location('fcc_download', BASE / 'scripts/fcc_download.py')
    worker = importlib.util.module_from_spec(module)
    module.loader.exec_module(worker)
    directory = worker.secure_dir(DATA)
    lock = os.open(directory / 'auth-probe.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock, 'w') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        report = {'authenticated': False, 'checked_at': dt.datetime.now(dt.timezone.utc).isoformat()}
        try:
            credentials = worker.load_credentials(directory)
            worker.reserve_request(directory)
            dates = worker.read_json(worker.request('listAsOfDates', credentials))
            available = sorted({r['as_of_date'] for r in dates['data'] if r.get('data_type') == 'availability' and isinstance(r.get('as_of_date'), str) and len(r['as_of_date']) == 10})
            if not available:
                raise worker.SafeError('No availability filing dates returned.')
            for date in available:
                dt.date.fromisoformat(date)
            report.update(authenticated=True, availability_dates=available)
            time.sleep(7)
            worker.reserve_request(directory)
            metadata = worker.read_json(worker.request('downloads/listAvailabilityData/' + available[-1], credentials))
            keys = ('file_id', 'category', 'subcategory', 'technology_type', 'technology_code', 'technology_code_desc', 'speed_tier', 'state_fips', 'state_name', 'provider_id', 'provider_name', 'file_type', 'file_name', 'record_count')
            mobile = [{k:row.get(k) for k in keys} for row in metadata['data'] if row.get('technology_type') == 'Mobile Broadband' and row.get('category') == 'Provider' and row.get('file_type') == 'gis']
            worker.atomic_bytes(directory / 'mobile-manifest.json', json.dumps({'as_of': available[-1], 'files': mobile}).encode())
            ny = [row for row in mobile if row.get('state_fips') == '36']
            worker.atomic_bytes(directory / 'pilot-candidates.json', json.dumps({'as_of': available[-1], 'files': ny}).encode())
            report.update(mobile_files=len(mobile), ny_pilot_files=len(ny), metadata_ready=True)
        except worker.SafeError as error:
            report['error'] = str(error)
        except Exception:
            report['error'] = 'Probe failed safely. No exception details were recorded.'
        worker.atomic_bytes(directory / 'auth-v2-status.json', json.dumps(report).encode())

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # A probe infrastructure failure must not print a traceback or request data.
        pass

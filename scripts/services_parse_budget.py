"""Run native geometry parsing in an expendable resource-limited child.

No accepted source is written by the child. Linux RLIMIT_AS bounds the native
location index too; disk, CPU and wall budgets fail closed, retaining last good.
"""
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import tempfile
import time

MAX_PARSE_SECONDS = 30 * 60
MAX_ADDRESS_BYTES = 4 * 1024**3
MAX_PARSE_DISK_BYTES = 12 * 1024**3
MAX_RESULT_BYTES = 512 * 1024**2


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (MAX_ADDRESS_BYTES, MAX_ADDRESS_BYTES))
    resource.setrlimit(resource.RLIMIT_CPU, (MAX_PARSE_SECONDS, MAX_PARSE_SECONDS))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_PARSE_DISK_BYTES, MAX_PARSE_DISK_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def bounded_process(command, directory, seconds=MAX_PARSE_SECONDS, disk_bytes=MAX_PARSE_DISK_BYTES):
    """Kill the complete child group on timeout, disk excess or caller cancellation."""
    started = time.monotonic()
    peak_disk = 0
    with (Path(directory) / 'worker.log').open('wb') as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True, preexec_fn=limits)
        old_handlers = {}
        def interrupted(signum, frame):
            raise SystemExit(128 + signum)
        for sig in (signal.SIGTERM, signal.SIGINT):
            old_handlers[sig] = signal.signal(sig, interrupted)
        try:
            while process.poll() is None:
                if time.monotonic() - started > seconds:
                    raise ValueError('Native parse walltime budget exceeded')
                used = sum(p.stat().st_size for p in Path(directory).rglob('*') if p.is_file())
                peak_disk = max(peak_disk, used)
                if used > disk_bytes:
                    raise ValueError('Native parse disk budget exceeded')
                time.sleep(.1)
            if process.returncode:
                # Logs may contain native diagnostics but never credentials or source metadata.
                detail = (Path(directory) / 'worker.log').read_bytes()[-2000:].decode(errors='replace')
                raise ValueError(f'Native parse failed (exit {process.returncode}); last good retained: {detail}')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
    return {'wall_seconds': round(time.monotonic() - started, 3), 'sampled_peak_disk_bytes': peak_disk}


def bounded_import(path, region, metadata, scratch):
    from import_services import ROOT
    scratch = Path(scratch).resolve()
    if scratch.is_relative_to(ROOT):
        raise ValueError('Parse scratch must remain outside checkout')
    with tempfile.TemporaryDirectory(prefix=f'{region}-parse-', dir=scratch) as temporary:
        directory = Path(temporary)
        (directory / 'request.json').write_text(json.dumps({'path': str(Path(path).resolve()), 'region': region, 'metadata': metadata}))
        elapsed = bounded_process([sys.executable, str(Path(__file__).resolve()), '--worker', str(directory)], directory)
        result = directory / 'result.json'
        if not result.is_file() or result.stat().st_size > MAX_RESULT_BYTES:
            raise ValueError('Native parse result byte budget exceeded')
        wrapper, quarantine, stats = json.loads(result.read_bytes())
        stats.update({'bounded_parse_seconds': elapsed['wall_seconds'], 'sampled_peak_parse_disk_bytes': elapsed['sampled_peak_disk_bytes'], 'parse_address_limit_bytes': MAX_ADDRESS_BYTES,
                      'parse_disk_limit_bytes': MAX_PARSE_DISK_BYTES, 'parse_wall_limit_seconds': MAX_PARSE_SECONDS})
        return wrapper, quarantine, stats


def worker(directory):
    from import_services import import_pbf
    from build_agency_states import StateBoundaries
    request = json.loads((directory / 'request.json').read_bytes())
    result = import_pbf(request['path'], request['region'], request['metadata'], StateBoundaries(),
                        location_index=f"sparse_file_array,{directory / 'locations.idx'}")
    result[2]['peak_rss_kib'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    raw = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()
    if len(raw) > MAX_RESULT_BYTES:
        raise ValueError('Native parse result byte budget exceeded')
    (directory / 'result.json').write_bytes(raw)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--worker':
        raise ValueError('Internal native parser worker entry only')
    worker(Path(sys.argv[2]))

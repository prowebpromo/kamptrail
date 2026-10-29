#!/usr/bin/env python3
"""Private POSIX server helper: update only FCC username, never print credentials."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile

BASE = Path(__file__).resolve().parent
DATA = BASE.parent / 'fcc-data'

def set_email(directory, email):
    if not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+', email) or len(email) > 254:
        raise ValueError('Invalid account email')
    fd = os.open(directory / 'credentials.json', os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Private credential permissions required')
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError('JSON object required')
    value['username'] = email
    temp_fd, temp_name = tempfile.mkstemp(prefix='.email-', dir=directory)
    try:
        with os.fdopen(temp_fd, 'w') as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, directory / 'credentials.json')
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('email')
    args = parser.parse_args()
    try:
        set_email(DATA, args.email)
        module = importlib.util.spec_from_file_location('fcc_server_auth', BASE / 'server_auth.py')
        runner = importlib.util.module_from_spec(module)
        module.loader.exec_module(runner)
        runner.main()
    except Exception:
        # Never expose parsing errors, request data, or credential values.
        pass

if __name__ == '__main__':
    main()

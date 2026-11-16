#!/usr/bin/env python3
"""Read-only, bounded public-extract connectivity evidence; never reads a body."""
import argparse
import ipaddress
import itertools
import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from import_services import FixedRedirect
from services_regions import URLS, validate_resolved_url


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}, sort_keys=True), flush=True)


def error_fields(exc):
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    return {'error_class': type(exc).__name__, 'reason_class': type(reason).__name__,
            'errno': getattr(reason, 'errno', None),
            'http_status': exc.code if isinstance(exc, urllib.error.HTTPError) else None}


def diagnose(region):
    url = URLS[region]
    validate_resolved_url(region, url)
    host = urllib.parse.urlsplit(url).hostname
    emit('configuration', state=region, host=host,
         proxy_configured=bool(urllib.request.getproxies()),
         connect_timeout_seconds=5, max_addresses=6, head_attempts=2)
    addresses = []
    try:
        resolved = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        seen = set()
        for family, socktype, proto, _, address in resolved:
            ip = ipaddress.ip_address(address[0])
            if not ip.is_global or family not in (socket.AF_INET, socket.AF_INET6):
                continue
            if str(ip) not in seen:
                addresses.append((family, socktype, proto, address))
                seen.add(str(ip))
        # Alternate families so a resolver's ordering cannot hide IPv6/IPv4.
        v4 = [a for a in addresses if a[0] == socket.AF_INET]
        v6 = [a for a in addresses if a[0] == socket.AF_INET6]
        addresses = [a for pair in itertools.zip_longest(v4, v6)
                     for a in pair if a is not None][:6]
        emit('resolver', addresses=[a[3][0] for a in addresses],
             total_public_addresses=len(seen))
    except OSError as exc:
        emit('resolver_error', **error_fields(exc))
    context = ssl.create_default_context()
    for family, socktype, proto, address in addresses:
        phase = 'tcp'
        started = time.monotonic()
        try:
            with socket.socket(family, socktype, proto) as connection:
                connection.settimeout(5)
                connection.connect(address)
                emit('address_tcp', address=address[0], family=family.name, ok=True)
                phase = 'tls'
                with context.wrap_socket(connection, server_hostname=host):
                    pass  # Default trust roots and hostname validation stay enabled.
            emit('address_tls', address=address[0], family=family.name, ok=True,
                 elapsed_seconds=round(time.monotonic() - started, 3))
        except (OSError, ValueError) as exc:
            emit('address_' + phase, address=address[0], family=family.name, ok=False,
                 elapsed_seconds=round(time.monotonic() - started, 3), **error_fields(exc))
    for attempt in (1, 2):
        if attempt == 2:
            time.sleep(10)
        started = time.monotonic()
        request = urllib.request.Request(url, method='HEAD', headers={
            'User-Agent': 'KampTrail-services/2.14 (+https://www.openstreetmap.org/copyright)'})
        try:
            with urllib.request.build_opener(FixedRedirect(region)).open(request, timeout=5) as response:
                validate_resolved_url(region, response.geturl())
                emit('urllib_head', attempt=attempt, ok=True, http_status=response.status,
                     elapsed_seconds=round(time.monotonic() - started, 3))
        except (OSError, ValueError) as exc:
            emit('urllib_head', attempt=attempt, ok=False,
                 elapsed_seconds=round(time.monotonic() - started, 3), **error_fields(exc))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('region', choices=sorted(URLS))
    diagnose(parser.parse_args().region)

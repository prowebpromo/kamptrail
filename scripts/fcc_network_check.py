#!/usr/bin/env python3
"""Compare the two FCC Public Map API hosts for support ticket 64052."""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html import unescape

MAP_HOST = "broadbandmap.fcc.gov"
PREVIOUS_HOST = "bdc.fcc.gov"
PATH = "/api/public/map/listAsOfDates"
UA = "KampTrail coverage importer (+https://github.com/prowebpromo/kamptrail)"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def report_html_error(body, headers, credentials):
    # Publish only recognizable support fields. Never log raw response data.
    page = unescape(body.decode("utf-8", "replace"))
    title = re.search(r"<title\b[^>]*>([^<]{1,160})</title\s*>", page, re.I)
    if title:
        value = " ".join(title[1].split())
        if re.fullmatch(r"[\w .,:/()'!–—-]{1,120}", value) and all(
            credential.casefold() not in value.casefold() for credential in credentials
        ):
            print(f"HTML title: {value}")
    reference = re.search(
        r"\bReference\s*(?:#|ID\s*[:#]|Number\s*[:#])\s*([A-Za-z0-9][A-Za-z0-9.-]{2,95})",
        page, re.I,
    )
    fields = {"Page reference": reference[1].rstrip(".") if reference else ""}
    for name in ("X-Request-ID", "X-Reference-ID", "Akamai-GRN", "CF-Ray"):
        fields[name] = headers.get(name, "")
    for name, value in fields.items():
        if re.fullmatch(r"[A-Za-z0-9.-]{3,96}", value) and all(
            credential.casefold() not in value.casefold() for credential in credentials
        ):
            print(f"{name}: {value}")


def check(host, user, token):
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    request = urllib.request.Request(f"https://{host}{PATH}", headers={
        "username": user, "hash_value": token, "User-Agent": UA, "Accept": "application/json",
    })
    try:
        try:
            response = urllib.request.build_opener(NoRedirect()).open(request, timeout=90)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.getcode()
            media = response.headers.get_content_type()
            body = response.read(2_000_000 if status == 200 else 16_384)
            print(f"{stamp} | {host} | HTTP {status} | {media}")
            if status == 403 and media == "text/html":
                report_html_error(body, response.headers, (user, token))
            if status == 200 and media in ("application/json", "application/problem+json"):
                payload = json.loads(body)
                rows = payload.get("data") if isinstance(payload, dict) else None
                if not isinstance(rows, list):
                    print("No data array in JSON response.")
                    return status, False
                dates = {row["as_of_date"] for row in rows if isinstance(row, dict)
                         and row.get("data_type") == "availability"
                         and isinstance(row.get("as_of_date"), str) and row["as_of_date"]}
                print(f"Availability dates returned: {len(dates)}")
                return status, bool(dates)
            return status, False
    except (OSError, ValueError) as error:
        print(f"{stamp} | {host} | check failed ({type(error).__name__})")
        return None, False


def main():
    user = os.environ.get("FCC_USERNAME", "").strip()
    token = os.environ.get("FCC_TOKEN", "").strip()
    if not user or not token:
        print("Missing FCC credential. No request was sent.")
        return 2
    status, valid_dates = check(MAP_HOST, user, token)
    if status == 403:
        check(PREVIOUS_HOST, user, token)
    return 0 if valid_dates else 1


if __name__ == "__main__":
    sys.exit(main())

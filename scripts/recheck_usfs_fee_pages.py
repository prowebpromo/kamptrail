#!/usr/bin/env python3
"""Check approved USFS page snapshots without changing human observation dates."""
import argparse
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import hashlib
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import time
import uuid
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASELINES = ROOT / 'scripts/fixtures/usfs_fee_page_baselines.json'
CHECKS = ROOT / 'data/sources/usfs-fee-checks.json'
REVIEWS = ROOT / 'scripts/fixtures/usfs_fee_overrides.json'
PILOT = frozenset((35347, 35355, 35645, 35651, 35655, 60306, 60320, 60666, 66336, 67118))
VALID_DAYS = 30
MANUAL_DAYS = 180
LIMIT = 2_000_000
VOID = frozenset('area base br col embed hr img input link meta param source track wbr'.split())
IGNORED = frozenset(('script', 'style', 'svg', 'template', 'noscript'))


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def text(value):
    return re.sub(r'\s+', ' ', value).strip()


def utc_now():
    return datetime.now(timezone.utc)


def stamp():
    return utc_now().isoformat(timespec='seconds').replace('+00:00', 'Z')


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value):
        raise ValueError('Invalid automated check timestamp')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def day(value):
    return instant(value).date()


def official_url(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != 'https' or p.netloc != 'www.fs.usda.gov' or p.query or p.fragment or not p.path.startswith('/r'):
        raise ValueError('Expected an exact official Forest Service page URL')
    return url


class Page(HTMLParser):
    """Snapshot all meaningful main text and links, including notices and context.

    Template header/footer, whitespace, scripts and styles do not renew/change
    evidence. Text or link changes anywhere inside main require human review.
    """
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.parts, self.titles, self.fees, self.links = [], [], [], [], []
        self.mains = self.h1s = self.fee_sections = 0

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'main':
            self.mains += 1
        inside = tag == 'main' or any(t == 'main' for t, _ in self.stack)
        if inside and tag == 'h1':
            self.h1s += 1
        if inside and attrs.get('id') == 'rec_acc_fees':
            self.fee_sections += 1
        ignored = tag in IGNORED or any(t in IGNORED for t, _ in self.stack)
        if inside and not ignored and tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag not in VOID:
            self.stack.append((tag, attrs.get('id')))

    def handle_endtag(self, tag):
        # Real USFS pages are not XHTML; a closing void tag has no stack item.
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, value):
        if not any(t == 'main' for t, _ in self.stack) or any(t in IGNORED for t, _ in self.stack):
            return
        self.parts.append(value)
        if any(t == 'h1' for t, _ in self.stack):
            self.titles.append(value)
        if any(i == 'rec_acc_fees' for _, i in self.stack):
            self.fees.append(value)


def snapshot(raw, review=None):
    if not isinstance(raw, bytes) or not 100 <= len(raw) <= LIMIT:
        raise ValueError('Page is empty or outside its size bound')
    parser = Page()
    parser.feed(raw.decode('utf-8', errors='strict'))
    if parser.mains != 1 or parser.h1s != 1:
        raise ValueError('Missing or ambiguous main/title (possibly an error page)')
    content = {'title': text(' '.join(parser.titles)), 'text': text(' '.join(parser.parts)),
               'links': parser.links}
    if len(content['text']) < 200:
        raise ValueError('Main page content is unexpectedly short')
    if review:
        if content['title'].casefold() != text(review.get('observed_name', review['name'])).casefold():
            raise ValueError('Official page identity changed')
        if parser.fee_sections != 1 or text(' '.join(parser.fees)) != text(review['text']):
            raise ValueError('Dedicated fee wording changed or is ambiguous')
        coordinates = []
        for label in ('Longitude', 'Latitude'):
            matches = re.findall(r'\b' + label + r':\s*(-?\d+(?:\.\d+)?)\b', content['text'])
            if len(matches) != 1:
                raise ValueError('Official coordinates missing or ambiguous')
            coordinates.append(float(matches[0]))
        expected = review['identity_coordinates']
        distance = 111195 * math.hypot(coordinates[1] - expected[1],
            (coordinates[0] - expected[0]) * math.cos(math.radians((coordinates[1] + expected[1]) / 2)))
        if distance > 300:
            raise ValueError('Official location moved outside the reviewed identity radius')
    return {**content, 'semantic_sha256': digest(content), 'raw_sha256': hashlib.sha256(raw).hexdigest()}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('Official page redirected; destination requires review')


def fetch(url):
    official_url(url)
    req = urllib.request.Request(url, headers={'User-Agent': 'KampTrail official fee evidence check (+https://kamptrail.com)',
                                               'Cache-Control': 'no-cache'})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=30) as response:
        if response.status != 200 or response.headers.get_content_type() != 'text/html':
            raise ValueError('Expected a complete HTML page')
        return response.read(LIMIT + 1)


def load_reviews():
    values = json.loads(REVIEWS.read_text())['records']
    reviews = {r['recareaid']: r for r in values if r.get('review_after')}
    if set(reviews) != PILOT:
        raise ValueError('Pilot scope changed; review before adding maintained records')
    return reviews


def dependency_urls(review):
    notice = review.get('notice_review', {}).get('source_url')
    return [notice] if notice else []


def capture_baselines(reviews, getter=fetch):
    result = {'schema_version': 1, 'captured_at': stamp(), 'records': [], 'dependencies': {}}
    for rid, review in sorted(reviews.items()):
        page = snapshot(getter(review['source_url']), review)
        result['records'].append({'recareaid': rid, 'review_sha256': digest(review),
            'source_url': review['source_url'], 'page': page,
            'dependencies': dependency_urls(review)})
        for url in dependency_urls(review):
            if url not in result['dependencies']:
                result['dependencies'][url] = snapshot(getter(url))
    return result


def run_checks(reviews, baseline, getter=fetch, checked_at=None, now=None):
    checked_at = checked_at or stamp()
    if not instant(baseline['captured_at']) <= instant(checked_at) <= (now or utc_now()):
        raise ValueError('Automated check must follow baseline capture and cannot be in the future')
    checked = day(checked_at)
    results, dependencies = [], {}
    for url, prior in baseline['dependencies'].items():
        try:
            page = snapshot(getter(url))
            dependencies[url] = {'status': 'unchanged' if page['semantic_sha256'] == prior['semantic_sha256'] else 'changed',
                                 'page_sha256': page['semantic_sha256']}
        except Exception as error:
            dependencies[url] = {'status': 'unavailable', 'reason': type(error).__name__}
    for prior in baseline['records']:
        rid = prior['recareaid']
        review = reviews[rid]
        row = {'recareaid': rid, 'source_url': review['source_url'], 'review_sha256': digest(review),
               'checked_at': checked_at, 'valid_until': None}
        try:
            if digest(review) != prior['review_sha256'] or review['source_url'] != prior['source_url']:
                raise ValueError('Maintained evidence changed; new baseline needs review')
            raw = getter(review['source_url'])
            current = snapshot(raw)
            row['observed_page_sha256'] = current['semantic_sha256']
            page = snapshot(raw, review)
            row.update(raw_sha256=page['raw_sha256'], page_sha256=page['semantic_sha256'])
            row['status'] = 'unchanged' if page['semantic_sha256'] == prior['page']['semantic_sha256'] else 'changed'
            if any(dependencies[u]['status'] != 'unchanged' for u in prior['dependencies']):
                row['status'] = 'dependency_changed_or_unavailable'
            cap = date.fromisoformat(review['retrieved_at']) + timedelta(days=MANUAL_DAYS)
            if checked >= cap:
                row['status'] = 'manual_review_due'
            if row['status'] == 'unchanged':
                row['valid_until'] = min(checked + timedelta(days=VALID_DAYS), cap).isoformat()
        except Exception as error:
            row.update(status='unavailable_or_ambiguous', reason=str(error)[:200] if isinstance(error, ValueError) else type(error).__name__)
            if row.get('observed_page_sha256') and row['observed_page_sha256'] != prior['page']['semantic_sha256']:
                row['status'] = 'changed'
        results.append(row)
    return {'schema_version': 1, 'policy_version': 1, 'checked_at': checked_at,
            'baseline_sha256': digest(baseline), 'records': results, 'dependencies': dependencies}


@lru_cache(maxsize=1)
def load_checks(now=None):
    if not CHECKS.exists():
        return None
    baseline = json.loads(BASELINES.read_text())
    checks = json.loads(CHECKS.read_text())
    expected = {r['recareaid']: r for r in baseline['records']}
    if (baseline.get('schema_version') != 1 or set(expected) != PILOT or checks.get('schema_version') != 1 or
            checks.get('policy_version') != 1 or checks.get('baseline_sha256') != digest(baseline) or
            len(checks.get('records', [])) != len(PILOT) or
            {r['recareaid'] for r in checks['records']} != PILOT):
        raise ValueError('Invalid fee recheck receipt or baseline pin')
    checked = day(checks['checked_at'])
    if not instant(baseline['captured_at']) <= instant(checks['checked_at']) <= (now or utc_now()):
        raise ValueError('Fee receipt predates its approved baseline or is in the future')
    for page in [r['page'] for r in baseline['records']] + list(baseline['dependencies'].values()):
        if page['semantic_sha256'] != digest({k: page[k] for k in ('title', 'text', 'links')}):
            raise ValueError('Baseline snapshot content does not match its semantic hash')
    for row in checks['records']:
        prior = expected[row['recareaid']]
        if row['checked_at'] != checks['checked_at'] or row['source_url'] != prior['source_url'] or row['review_sha256'] != prior['review_sha256']:
            raise ValueError('Fee receipt changed its approved evidence identity')
        if row['status'] == 'unchanged':
            valid_until = date.fromisoformat(row['valid_until'])
            if (row.get('page_sha256') != prior['page']['semantic_sha256'] or
                    not checked < valid_until <= checked + timedelta(days=VALID_DAYS) or
                    any(checks['dependencies'].get(u, {}).get('status') != 'unchanged' or
                        checks['dependencies'][u].get('page_sha256') != baseline['dependencies'][u]['semantic_sha256']
                        for u in prior['dependencies'])):
                raise ValueError('Unchanged receipt does not prove the approved snapshot and window')
        elif row['status'] not in ('changed', 'dependency_changed_or_unavailable', 'manual_review_due', 'unavailable_or_ambiguous') or row['valid_until'] is not None:
            raise ValueError('Invalid failed fee recheck state')
    return {r['recareaid']: r for r in checks['records']}


def validation(review, imported_on):
    """None: normal manual window; False: blocked; True: automated window valid."""
    checks = load_checks()
    rid = review['recareaid']
    if checks is None or rid not in checks:
        return None
    row = checks[rid]
    if (row['status'] != 'unchanged' or row['review_sha256'] != digest(review) or
            not date.fromisoformat(review['retrieved_at']) <= day(row['checked_at']) <= imported_on):
        return False
    return imported_on < min(date.fromisoformat(row['valid_until']),
                             date.fromisoformat(review['retrieved_at']) + timedelta(days=MANUAL_DAYS))


def write(path, value):
    """Pin every parent directory before writing; never follow an output symlink."""
    path = path.absolute()
    if path.is_symlink() or any(p.is_symlink() for p in path.parents):
        raise ValueError('Refusing symlink evidence output')
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    directory = os.open(path.anchor, flags)
    temporary = '.fee-check-' + uuid.uuid4().hex
    try:
        for part in path.parent.parts[1:]:
            next_directory = os.open(part, flags, dir_fd=directory)
            os.close(directory)
            directory = next_directory
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
        current, pinned = os.stat(path.parent, follow_symlinks=False), os.fstat(directory)
        if (current.st_dev, current.st_ino) != (pinned.st_dev, pinned.st_ino):
            raise ValueError('Evidence output parent moved during publication')
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-baselines', action='store_true', help='Capture proposed baselines for human approval; never renews human review dates')
    parser.add_argument('--output', type=Path, help='Defaults to BASELINES for capture and CHECKS for normal checks')
    args = parser.parse_args(argv)
    output = args.output or (BASELINES if args.capture_baselines else CHECKS)
    reviews = load_reviews()
    # Official requests are serial, at least one second apart, with no retries.
    last_request = [0.0]
    def paced_fetch(url):
        time.sleep(max(0, 1 - (time.monotonic() - last_request[0])))
        last_request[0] = time.monotonic()
        return fetch(url)
    if args.capture_baselines:
        write(output, capture_baselines(reviews, paced_fetch))
        print('Proposed baseline captured. Review snapshots before merging; no observation dates changed.')
        return
    baseline = json.loads(BASELINES.read_text())
    results = run_checks(reviews, baseline, paced_fetch)
    write(output, results)
    problems = [r for r in results['records'] if r['status'] != 'unchanged']
    print(f"USFS fee page check: {len(results['records']) - len(problems)} unchanged; {len(problems)} require review")
    for row in problems:
        print(f"::warning::USFS {row['recareaid']}: {row['status']}; maintained override cannot be renewed")
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as handle:
            handle.write(f"### Maintained USFS fee page check\n\nChecked {results['checked_at']}. {len(results['records']) - len(problems)} unchanged; {len(problems)} exceptions. Human review dates retained.\n\n")
            for row in problems:
                handle.write(f"- USFS {row['recareaid']}: **{row['status']}**. Review the official source before renewing.\n")


if __name__ == '__main__':
    main()

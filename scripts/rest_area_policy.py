"""Resolve sourced state rest-area rules without inferring overnight permission.

Preparation tool only. It neither edits location catalogues nor feeds permission
filters. Application integration and source-monitoring remain separate gates.
"""
import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
POLICIES = ROOT / 'scripts/fixtures/rest_area_state_policies.json'
ACTIVITIES = ('overnight_parking', 'sleeping_in_vehicle', 'camping')
HOSTS = {'www.txdot.gov', 'tcss.legis.texas.gov', 'mdt.mt.gov', 'mca.legmt.gov'}


def evidence(sources, now):
    if not sources:
        raise ValueError('Missing policy evidence')
    for source in sources:
        url = urlparse(source['url'])
        checked = dt.datetime.fromisoformat(source['retrieved_at'].replace('Z', '+00:00'))
        if (url.scheme != 'https' or url.hostname not in HOSTS or url.username or
                url.password or url.query or url.fragment or checked.tzinfo is None or
                checked > now or not re.fullmatch('[a-f0-9]{64}', source['sha256'])):
            raise ValueError('Invalid policy evidence')


def validate(bundle, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if bundle.get('version') != 1 or not isinstance(bundle.get('policies'), list):
        raise ValueError('Unsupported policy catalogue')
    seen = set()
    for policy in bundle['policies']:
        scope = policy['scope']
        key = (scope['state'], scope['operator'], scope['facility_kind'])
        if key in seen or not re.fullmatch('[A-Z]{2}', scope['state']):
            raise ValueError('Duplicate or invalid policy scope')
        seen.add(key)
        evidence(policy['sources'], now)
        for activity in ACTIVITIES:
            if policy['rules'][activity] not in ('allowed', 'prohibited', 'unknown'):
                raise ValueError('Invalid activity rule')
        hours = policy['rules']['max_stay_hours']
        if hours is not None and (isinstance(hours, bool) or not isinstance(hours, (int, float)) or not 0 < hours <= 168):
            raise ValueError('Invalid duration')
    return bundle


def resolve(bundle, *, state, operator, facility_kind, facility_id=None, exceptions=(), now=None):
    """Only exact managed-facility scope inherits a state rule.

    Restrictive, sourced site exceptions can tighten the rule. A conflicting
    site-level grant or longer stay requires an authority review, returning
    unknown for that field. This never silently relaxes the statewide rule.
    """
    now = now or dt.datetime.now(dt.timezone.utc)
    validate(bundle, now)
    rules = {field: 'unknown' for field in ACTIVITIES}
    rules.update(max_stay_hours=None, conditions=[])
    output = {'rules': rules, 'policy_id': None, 'sources': [],
              'review_required': [], 'current_opening': 'unknown'}
    matches = [p for p in bundle['policies'] if p['scope'] == {
        'state': state, 'operator': operator, 'facility_kind': facility_kind}]
    if matches:
        policy = matches[0]
        output.update(policy_id=policy['id'], rules=copy.deepcopy(policy['rules']),
                      sources=copy.deepcopy(policy['sources']))
    applicable = [e for e in exceptions if facility_id and e['facility_id'] == facility_id
                  and e['state'] == state and e['operator'] == operator
                  and e['facility_kind'] == facility_kind]
    if len(applicable) > 1:
        raise ValueError('Multiple site exceptions require consolidation')
    for exception in applicable:
        evidence(exception['sources'], now)
        output['sources'].extend(copy.deepcopy(exception['sources']))
        for field, value in exception['rules'].items():
            prior = output['rules'].get(field)
            if field in ACTIVITIES:
                if value not in ('allowed', 'prohibited', 'unknown'):
                    raise ValueError('Invalid site activity rule')
                if prior == 'prohibited' and value == 'allowed':
                    output['rules'][field] = 'unknown'
                    output['review_required'].append(field)
                else:
                    output['rules'][field] = value
            elif field == 'max_stay_hours':
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 168):
                    raise ValueError('Invalid site duration')
                if prior is not None and value is not None and value > prior:
                    output['rules'][field] = None
                    output['review_required'].append(field)
                else:
                    output['rules'][field] = value
            else:
                raise ValueError('Unreviewed exception field')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policies', type=Path, default=POLICIES)
    parser.add_argument('--state', required=True)
    parser.add_argument('--operator', required=True)
    parser.add_argument('--kind', required=True)
    args = parser.parse_args()
    print(json.dumps(resolve(json.loads(args.policies.read_text()), state=args.state,
                             operator=args.operator, facility_kind=args.kind), indent=2))


if __name__ == '__main__':
    main()

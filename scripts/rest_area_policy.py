"""Resolve sourced state rest-area rules without inferring overnight permission.

Diagnostic resolver for the same reviewed policies used by the rest-area popup.
It never edits raw location records or promotes permission-filter matches.
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
# Newly reviewed publishers are accepted only at the exact audited policy URL.
# INDOT publishes one fact page per facility under this exact path.
FACILITY_PAGE = re.compile(r'https://www\.in\.gov/indot/resources/maps/welcome-centers-and-rest-areas/[a-z0-9]+(?:-[a-z0-9]+){1,8}')
EXACT_POLICY_URLS = frozenset(('https://lawfilesext.leg.wa.gov/law/RCW/RCW%20%2047%20%20TITLE/RCW%20%2047%20.%2038%20%20CHAPTER/RCW%20%2047%20.%2038%20.020.htm', 'https://sdlegislature.gov/api/Statutes/31-7-15.html', 'https://www.leg.state.nv.us/nac/NAC-408.html', 'https://dot.ca.gov/programs/design/lap-landscape-architecture-and-community-livability/lap-liv-h-safety-roadside-rest-areas', 'https://gis.iowadot.gov/agshost/rest/services/Hosted/Rest_Areas_All/FeatureServer/1', 'https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/', 'https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Facilities/Rest_Areas/MapServer/0', 'https://gisagomdot.state.mi.us/arcgis/rest/services/MDOT/MdotRestAreaPublic/MapServer/0', 'https://gis.dot.nv.gov/arcgis/rest/services/Applications/511Map/MapServer/5', 'https://dot.sd.gov/travelers/travelers/rest-areaports-of-entry/', 'https://wsdot.wa.gov/travel/safety/rest-areas/home', 'https://floridasturnpike.com/traveler-resources/service-plazas/', 'https://files.dfm.idaho.gov/dfm-admin-website/rules/current/39/390350.pdf', 'https://itd.idaho.gov/faqs/rest-areas/', 'https://codes.ohio.gov/ohio-administrative-code/rule-5501:2-4-01', 'https://tripcheck.com/Pages/Rest-Areas-Regulations', 'https://law.lis.virginia.gov/admincode/title24/agency30/chapter51/section30/', 'https://law.lis.virginia.gov/admincode/title24/agency30/chapter51/section10/'))


def evidence(sources, now):
    if not sources:
        raise ValueError('Missing policy evidence')
    for source in sources:
        url = urlparse(source['url'])
        checked = dt.datetime.fromisoformat(source['retrieved_at'].replace('Z', '+00:00'))
        if (url.scheme != 'https' or (url.hostname not in HOSTS and source['url'] not in EXACT_POLICY_URLS and not FACILITY_PAGE.fullmatch(source['url'])) or url.username or
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
    exceptions = bundle.get('exceptions', [])
    if not isinstance(exceptions, list) or len(exceptions) > 1000:
        raise ValueError('Invalid facility exceptions')
    ids = set()
    for exception in exceptions:
        fid = exception.get('facility_id')
        if (not isinstance(fid, str) or not 0 < len(fid) <= 100 or fid in ids
                or not re.fullmatch('[A-Z]{2}', str(exception.get('state')))):
            raise ValueError('Ambiguous facility exception')
        ids.add(fid)
        evidence(exception['sources'], now)
        rules = exception.get('rules')
        if not isinstance(rules, dict):
            raise ValueError('Invalid site rules')
        for field, value in rules.items():
            if field in ACTIVITIES:
                if value not in ('allowed', 'prohibited', 'unknown'):
                    raise ValueError('Invalid site activity rule')
            elif field == 'max_stay_hours':
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 168):
                    raise ValueError('Invalid site duration')
            else:
                raise ValueError('Unreviewed exception field')
        conditions = exception.get('conditions', [])
        if not isinstance(conditions, list) or len(conditions) > 4 or not all(isinstance(c, str) and 0 < len(c) <= 500 for c in conditions):
            raise ValueError('Invalid site conditions')
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
              'review_required': [], 'current_opening': 'unknown', 'facility_sources': 0}
    matches = [p for p in bundle['policies'] if p['scope'] == {
        'state': state, 'operator': operator, 'facility_kind': facility_kind}]
    if matches:
        policy = matches[0]
        if any(now - dt.datetime.fromisoformat(s['retrieved_at'].replace('Z', '+00:00')) >= dt.timedelta(days=180) for s in policy['sources']):
            return output
        output.update(policy_id=policy['id'], rules=copy.deepcopy(policy['rules']),
                      sources=copy.deepcopy(policy['sources']))
    applicable = [e for e in exceptions if facility_id and e['facility_id'] == facility_id
                  and e['state'] == state and e['operator'] == operator
                  and e['facility_kind'] == facility_kind]
    if len(applicable) > 1:
        raise ValueError('Multiple site exceptions require consolidation')
    for exception in applicable:
        evidence(exception['sources'], now)
        if any(now - dt.datetime.fromisoformat(s['retrieved_at'].replace('Z', '+00:00')) >= dt.timedelta(days=180) for s in exception['sources']):
            return {**output, 'rules': {**{f: 'unknown' for f in ACTIVITIES}, 'max_stay_hours': None, 'conditions': []},
                    'policy_id': None, 'sources': []}
        conditions = exception.get('conditions', [])
        if not isinstance(conditions, list) or len(conditions) > 4 or not all(isinstance(c, str) and 0 < len(c) <= 500 for c in conditions):
            raise ValueError('Invalid site conditions')
        output['sources'].extend(copy.deepcopy(exception['sources']))
        output['facility_sources'] = len(exception['sources'])
        output['rules']['conditions'] = output['rules']['conditions'] + list(conditions)
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

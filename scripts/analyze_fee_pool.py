#!/usr/bin/env python3
"""Select fee-review leads from canonical unknown records. Never classify fees."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OPERATOR_FIELDS = ('operator', 'operator:short', 'operator:short_name', 'operator:en')
# Generic "Forest Service", USDA alone and forest names may identify other
# operators. They are not sufficient for this federal-agency lead definition.
FEDERAL_OPERATOR = re.compile(
    r'\b(?:u\.?s\.?f\.?s\.?|blm)\b|'
    r'\b(?:united states|u\.?s\.?|usda)\s+forest service\b|'
    r'\bbureau\s+of\s+land\s+management\b', re.I)
QUOTAS = {'dispersed': 15, 'agency_other': 15, 'osm_operator_other': 20}
SEED = 'kamptrail-fee-pilot-v1'


def source_group(identity):
    return {'osm': 'OSM', 'ridb': 'RIDB', 'usfs': 'USFS',
            'blm-area': 'BLM'}.get(identity.split(':')[0], 'other')


def analyze(index, snapshots, seed=SEED):
    sites = index['sites']
    by_id, aliases = {}, {}
    for row in sites:
        identity = row['id']
        if identity in by_id:
            raise ValueError('Duplicate canonical identity: ' + identity)
        by_id[identity] = row
        for alias in [identity] + row.get('legacy_ids', []):
            if alias in aliases and aliases[alias] != identity:
                raise ValueError('Ambiguous catalogue alias: ' + alias)
            aliases[alias] = identity
    unknown = {k: r for k, r in by_id.items() if r['m']['f'] == 'unknown'}
    evidence = collections.defaultdict(set)
    conflicts = set()
    ambiguous_joins = set()
    operator_retained = set()
    osm_associated = set()
    for path, features in snapshots:
        for feature in features:
            p = feature.get('properties', {})
            ids = {v for v in [p.get('id')] + p.get('legacy_ids', [])
                   + p.get('source_ids', []) if isinstance(v, str)}
            canonical = {aliases[v] for v in ids if v in aliases}
            if len(canonical) != 1:
                if len(canonical) > 1:
                    ambiguous_joins.add((path, str(p.get('id'))))
                continue
            identity = next(iter(canonical))
            if identity not in unknown:
                continue
            if p.get('fee_conflict'):
                conflicts.add(identity)
            if not any(v.startswith('osm:') for v in ids):
                continue
            osm_associated.add(identity)
            for field in OPERATOR_FIELDS:
                value = p.get(field)
                if not isinstance(value, str) or not value.strip():
                    continue
                operator_retained.add(identity)
                if FEDERAL_OPERATOR.search(value):
                    evidence[identity].add((path, str(p.get('id')), field, value))
    dispersed = {k for k, r in unknown.items() if r['m']['t'] == 'dispersed'}
    agency = {k for k in unknown if source_group(k) in ('USFS', 'BLM')}
    operators = set(evidence)
    pool = dispersed | agency | operators
    strata = {'dispersed': dispersed, 'agency_other': agency - dispersed,
              'osm_operator_other': operators - dispersed - agency}
    selected = []
    for stratum, identities in strata.items():
        ordered = sorted(identities, key=lambda k: hashlib.sha256((seed + '\n' + k).encode()).hexdigest())
        for identity in ordered[:QUOTAS[stratum]]:
            row = unknown[identity]
            flags = [label for label, group in [('unknown_dispersed', dispersed),
                     ('unknown_primary_agency', agency), ('unknown_osm_federal_operator', operators)] if identity in group]
            selected.append({'id': identity, 'name': row['name'], 'states': row['states'],
                             'type': row['m']['t'], 'fee_status': 'unknown', 'stratum': stratum,
                             'selection_reasons': flags, 'fee_conflict_in_joined_snapshot': identity in conflicts,
                             'operator_evidence': [{'snapshot': x[0], 'source_id': x[1],
                                                    'field': x[2], 'value': x[3]}
                                                   for x in sorted(evidence[identity])]})
    return {
        'schema_version': 1, 'purpose': 'Review targeting only; no fee or federal ownership classification',
        'selection_seed': seed, 'sample_quotas': QUOTAS,
        'catalogue_count': len(sites), 'unknown_count': len(unknown),
        'unknown_by_primary_id_source': dict(sorted(collections.Counter(source_group(k) for k in unknown).items())),
        'unknown_by_type': dict(sorted(collections.Counter(r['m']['t'] for r in unknown.values()).items())),
        'eligibility_counts': {'dispersed': len(dispersed), 'primary_usfs_blm': len(agency),
                               'osm_associated_federal_operator': len(operators),
                               'operator_leads_by_canonical_source': dict(sorted(collections.Counter(source_group(k) for k in operators).items())),
                               'dispersed_and_agency_overlap': len(dispersed & agency),
                               'dispersed_and_operator_overlap': len(dispersed & operators),
                               'agency_and_operator_overlap': len(agency & operators),
                               'unique_pool': len(pool),
                               'pool_if_operator_leads_require_primary_osm_id': len(dispersed | agency | {k for k in operators if source_group(k) == 'OSM'})},
        'stratum_sizes': {k: len(v) for k, v in strata.items()},
        'retention_diagnostics': {'unknown_osm_associated': len(osm_associated),
                                  'with_selected_operator_field': len(operator_retained),
                                  'without_selected_operator_field': len(osm_associated - operator_retained),
                                  'ambiguous_snapshot_identity_joins_excluded': len(ambiguous_joins)},
        'sample_count': len(selected), 'sample': selected,
    }


def from_directory(directory):
    directory = Path(directory)
    index_path = directory / 'search-index.json'
    index_bytes = index_path.read_bytes()
    paths = sorted(directory.glob('*_merged.geojson'))
    if len(paths) != 50:
        raise ValueError('Expected exactly 50 merged state snapshots')
    digest = hashlib.sha256()
    snapshots = []
    for path in paths:
        raw = path.read_bytes()
        label = 'data/campsites/' + path.name
        digest.update((label + '\n' + hashlib.sha256(raw).hexdigest() + '\n').encode())
        doc = json.loads(raw)
        if doc.get('type') != 'FeatureCollection':
            raise ValueError('Invalid merged snapshot: ' + path.name)
        snapshots.append((label, doc['features']))
    result = analyze(json.loads(index_bytes), snapshots)
    result['input_provenance'] = {'search_index_sha256': hashlib.sha256(index_bytes).hexdigest(),
                                 'merged_snapshot_set_sha256': digest.hexdigest(), 'merged_state_files': len(paths),
                                 'source_updated_at': None,
                                 'date_note': 'Analysis hashes identify saved inputs, not fresh provider retrievals.'}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=ROOT / 'data/campsites')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = from_directory(args.directory)
    raw = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
    if args.output:
        args.output.write_text(raw, encoding='utf-8')
    else:
        print(raw, end='')


if __name__ == '__main__':
    main()

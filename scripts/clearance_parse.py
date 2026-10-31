"""Pure OSM height-tag parsing and rig comparison. No native or network imports.

The accepted syntax matches build_clearances.parse_height and clearances.js:
bare metres, an optional " m" suffix, and ASCII feet/inches such as 9'4" or 12'.
Everything else stays unknown. Unknown is never treated as infinite or safe.
"""
from decimal import Decimal, ROUND_FLOOR
import re

HEIGHT_KEYS = ('maxheight', 'maxheight:physical', 'height')
# Documented non-numeric maxheight values that carry no number.
UNKNOWN_WORDS = frozenset({'', 'none', 'default', 'no_indications', 'unsigned', 'unknown'})
BELOW_DEFAULT = 'below_default'
STATUSES = ('numeric', BELOW_DEFAULT, 'unknown', 'unparseable')
INCH = Decimal('0.0254')
MAX_METRES = Decimal(100)

_METRIC = re.compile(r'(\d+(?:\.\d{1,6})?)(?: m)?')
_IMPERIAL = re.compile(r"(\d+)'(?:(\d{1,2})\")?")


def parse_height_text(raw):
    """Return {'status', 'metres', 'inches'} for one raw tag value.

    status is numeric, below_default, unknown or unparseable. Metres and inches
    are None unless the status is numeric. Inches are exact for feet/inches
    input and floored to 0.01 in for metric input, so rounding never raises a
    hazard's height.
    """
    if not isinstance(raw, str):
        return {'status': 'unparseable', 'metres': None, 'inches': None}
    metric = _METRIC.fullmatch(raw)
    imperial = _IMPERIAL.fullmatch(raw)
    metres = inches = None
    if metric:
        metres = Decimal(metric[1])
        inches = (metres / INCH).quantize(Decimal('0.01'), rounding=ROUND_FLOOR)
    elif imperial and (imperial[2] is None or int(imperial[2]) < 12):
        inches = Decimal(int(imperial[1]) * 12 + int(imperial[2] or 0))
        metres = inches * INCH
    if metres is not None:
        if 0 < metres <= MAX_METRES:
            return {'status': 'numeric', 'metres': float(metres), 'inches': float(inches)}
        return {'status': 'unparseable', 'metres': None, 'inches': None}
    word = raw.strip().lower()
    if word == BELOW_DEFAULT:
        return {'status': BELOW_DEFAULT, 'metres': None, 'inches': None}
    if word in UNKNOWN_WORDS:
        return {'status': 'unknown', 'metres': None, 'inches': None}
    return {'status': 'unparseable', 'metres': None, 'inches': None}


def compare_to_rig(clearance_inches, rig_inches, margin_inches=0):
    """Compare one numeric clearance to a rig height, both in inches.

    relation is below, equal, above or unknown. comfortable is True only when
    the clearance is strictly greater than rig height plus margin. Equality is
    never comfortable. Neither relation claims safe passage.
    """
    if clearance_inches is None or rig_inches is None:
        return {'relation': 'unknown', 'comfortable': False}
    if isinstance(clearance_inches, bool) or isinstance(rig_inches, bool) or margin_inches < 0:
        raise ValueError('Heights must be numbers and the margin cannot be negative')
    clearance = Decimal(str(round(clearance_inches, 2)))
    rig = Decimal(str(round(rig_inches, 2)))
    if clearance <= 0 or rig <= 0:
        raise ValueError('Heights must be positive')
    if clearance < rig:
        relation = 'below'
    elif clearance == rig:
        relation = 'equal'
    else:
        relation = 'above'
    return {'relation': relation, 'comfortable': clearance > rig + Decimal(str(margin_inches))}


def height_fields(tags):
    """Parsed metres, inches and status for each height key present in tags."""
    metres, inches, status = {}, {}, {}
    for key in HEIGHT_KEYS:
        if key in tags:
            parsed = parse_height_text(tags[key])
            metres[key], inches[key], status[key] = parsed['metres'], parsed['inches'], parsed['status']
    return metres, inches, status


# ---------------------------------------------------------------- record assessment (candidate status, plausibility, applies_to)
#
# Bare numbers follow the OSM wiki (https://wiki.openstreetmap.org/Key:maxheight, fetched 2026-10-31):
# "If no unit is included, the value is assumed to be in metres." Values are never changed or relabelled.

PLAIN_KEYS = ('maxheight', 'maxheight:physical', 'height')
DIRECTIONAL_KEYS = ('maxheight:forward', 'maxheight:backward', 'maxheight:lanes')
STATUSES_CANDIDATE = ('numeric_only', 'mixed', 'directional_only', 'conditional', 'unknown', 'suspect')
NON_MOTOR_HIGHWAYS = frozenset({'footway', 'cycleway', 'path', 'pedestrian', 'steps', 'bridleway', 'corridor', 'elevator', 'platform'})
MIN_HIGHWAY_INCHES = Decimal(5 * 12)
MAX_HIGHWAY_INCHES = Decimal(18 * 12)
BARE_SUSPECT_FROM = Decimal(6)
BARE_FEET_LIKE_TO = Decimal(20)
EXCLUDED_HEIGHT_REASON = 'plain_height_not_vehicle_path'
# A plain `height` on a bridge is the structure's own height. It does not limit traffic on the bridge,
# and a bridge's presence is not evidence about the road below it.
BRIDGE_HEIGHT_REASON = 'plain_height_is_bridge_structure_height'


def value_unit(raw):
    """metres_assumed for a bare number, metres for a ' m' suffix, feet_inches for 9'4", otherwise None."""
    if not isinstance(raw, str):
        return None
    if _METRIC.fullmatch(raw):
        return 'metres' if raw.endswith(' m') else 'metres_assumed'
    if _IMPERIAL.fullmatch(raw):
        return 'feet_inches'
    return None


def is_conditional(key, raw):
    return ':conditional' in key or (isinstance(raw, str) and '@' in raw)


def highway_of(context):
    value = (context or {}).get('highway')
    return value if value and value not in NON_MOTOR_HIGHWAYS else None


def height_use(context, structure):
    """(use, reason). Plain `height` counts only where it plausibly limits a vehicle path."""
    context = context or {}
    structure = structure or []
    if context.get('barrier') == 'height_restrictor' or 'height_restrictor' in structure:
        return True, 'height_kept_height_restrictor'
    if context.get('highway'):
        if 'tunnel' in structure or 'covered' in structure:
            return True, 'height_kept_tunnel_or_covered_highway'
    if 'bridge' in structure:
        return False, BRIDGE_HEIGHT_REASON
    return False, EXCLUDED_HEIGHT_REASON


def object_tag(context, structure):
    """The tag that names what a plain-height record is, for exclusion counts."""
    context = context or {}
    if context.get('barrier'):
        return 'barrier=' + context['barrier']
    if context.get('highway'):
        return 'highway=' + context['highway']
    if context.get('railway'):
        return 'railway=' + context['railway']
    if structure:
        return 'structure=' + '+'.join(sorted(structure))
    return 'none'


def lowest_inches(items):
    """Lowest (inches, metres) pair, or None for an empty set. An empty set never yields a value."""
    items = list(items)
    if not items:
        return None
    return min(items, key=lambda pair: pair[0])


def _applies_to(context, structure, restriction_on):
    context = context or {}
    structure = structure or []
    highway = context.get('highway')
    if restriction_on == 'way' and highway:
        below = []
        if 'tunnel' in structure:
            below.append('way_is_tunnel')
        if 'covered' in structure:
            below.append('way_is_covered')
        try:
            if float(context.get('layer', 0)) < 0:
                below.append('way_on_negative_layer')
        except (TypeError, ValueError):
            pass
        if below:
            return 'road_below', ['tag_on_highway_way', 'highway=' + highway] + below
        return 'way_itself', ['tag_on_highway_way', 'highway=' + highway]
    if restriction_on == 'node' and (context.get('barrier') == 'height_restrictor' or 'height_restrictor' in structure):
        return 'unknown', ['barrier_node_parent_way_not_recorded']
    return 'unknown', ['no_highway_way_evidence']


def assess(tags, context, structure, restriction_on):
    """Derive status, comparability, plausibility, unit flags and applies_to from raw tags and context.

    Returns a dict of record fields. Raw values are never altered. min_inches and min_metres exist only
    when the record is comparable, so a minimum over an empty set cannot appear.
    """
    context = context or {}
    structure = structure or []
    reasons = []
    use_height, height_reason = height_use(context, structure)
    keys = {}
    for key, raw in tags.items():
        if key == 'height':
            if not use_height:
                reasons.append('height_ignored_' + height_reason)
                continue
            reasons.append(height_reason)
        keys[key] = raw
    parsed = {key: parse_height_text(raw) for key, raw in keys.items()}
    highway = highway_of(context)
    conditional = any(is_conditional(key, raw) for key, raw in keys.items())
    numeric = {key: p for key, p in parsed.items() if p['status'] == 'numeric'}
    suspect = []
    bare = False
    for key, p in numeric.items():
        unit = value_unit(keys[key])
        metres, inches = Decimal(str(p['metres'])), Decimal(str(p['inches']))
        if unit == 'metres_assumed':
            bare = True
            if metres >= BARE_SUSPECT_FROM:
                suspect.append('bare_number_likely_feet' if metres <= BARE_FEET_LIKE_TO else 'bare_number_implausible_metres')
        if highway and inches < MIN_HIGHWAY_INCHES:
            suspect.append('under_5ft_on_highway')
        # The upper bound only checks numbers whose unit is assumed. An explicit value above 18 ft
        # (for example 20'0") is what the mapper stated, and a high clearance is ordinary.
        if highway and unit == 'metres_assumed' and inches > MAX_HIGHWAY_INCHES:
            suspect.append('over_18ft_on_highway')
    suspect = sorted(set(suspect))
    plain_numeric = [k for k in numeric if k in PLAIN_KEYS]
    directional = [k for k in keys if k in DIRECTIONAL_KEYS]
    plain_other = [k for k in keys if k in PLAIN_KEYS and k not in numeric]
    for key, p in parsed.items():
        if p['status'] != 'numeric':
            reasons.append(f'{key}_{p["status"]}')
    if conditional:
        status = 'conditional'
        reasons.append('conditional_value')
    elif suspect:
        status = 'suspect'
    elif plain_numeric:
        status = 'mixed' if (directional or plain_other) else 'numeric_only'
    elif directional and not any(k in PLAIN_KEYS for k in keys):
        status = 'directional_only'
    else:
        status = 'unknown'
    if status == 'mixed':
        reasons.append('plain_and_other_tags')
    if status == 'directional_only':
        reasons.append('direction_or_lane_specific')
    reasons.extend(suspect)
    comparable = status == 'numeric_only'
    applies, evidence = _applies_to(context, structure, restriction_on)
    out = {
        'status': status, 'comparable': comparable,
        'plausibility': 'suspect' if suspect else ('ok' if numeric else 'not_assessed'),
        'reasons': sorted(set(reasons)),
        'applies_to': applies, 'applies_to_evidence': evidence,
        'metres': {k: p['metres'] for k, p in parsed.items()},
        'inches': {k: p['inches'] for k, p in parsed.items()},
        'parse': {k: p['status'] for k, p in parsed.items()},
    }
    if bare:
        out['unit_assumed'] = 'metres'
    if comparable:
        low = lowest_inches((p['inches'], p['metres']) for k, p in numeric.items() if k in PLAIN_KEYS)
        out['min_inches'], out['min_metres'] = low
    return out

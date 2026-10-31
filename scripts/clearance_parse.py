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

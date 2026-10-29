"""Classify agency fee wording into free, paid, conditional, or unknown.

The wording itself is kept as evidence. Rules are conservative:
- free: the text says camping has no fee and names no dollar charge above $0.
- conditional: camping is stated free but the text also names a charge or a required
  pass or permit (extra vehicles, seasons, an Adventure Pass).
- paid: the text states a camping charge (a dollar amount, a fee station, "camping is not free").
- unknown: blank, ambiguous, or only a pointer elsewhere ("see Recreation.gov for fees").
Free ancillary services (drinking water, showers, parking, day use) never make camping free.
Negated statements ("camping is not free") never make camping free.
Reservability is not fee evidence and is not used here.
"""
import html
import re

DOLLAR = re.compile(r'\$\s?(\d{1,4}(?:\.\d{2})?)|\b(\d{1,4}(?:\.\d{2})?)\s?\$')
NIGHTLY = re.compile(r'\$\s?(\d{1,3}(?:\.\d{2})?)\s*(?:/|per|a|each)\s*(?:night|site|campsite|unit)', re.I)

# Camping is said to cost money.
NEG_FREE_CAMP = re.compile(
    r"\b(?:camping|campsites?|campground|overnight(?:\s+use)?|this\s+(?:site|area|campground|facility)|the\s+(?:site|area|campground|facility)|it)"
    r"\s+(?:is|are)\s+(?:not|no\s+longer)\s+free\b"
    r"|\b(?:camping|campsites?|campground)\s+(?:isn['’]t|aren['’]t)\s+free\b", re.I)
# Any other negated "free" (subject unclear) removes the free signal but proves nothing.
NEG_FREE_ANY = re.compile(r"\b(?:not|no\s+longer|isn['’]t|aren['’]t|never)\s+(?:\w+\s+){0,2}free\b", re.I)
# Free things that are not camping.
ANCILLARY_FREE = re.compile(
    r"\bfree\s+(?:(?:drinking|potable|fresh|non-potable)\s+)?(?:water|wi-?fi|internet|showers?|parking|firewood|dump(?:ing)?(?:\s+station)?|"
    r"admission|entry|entrance|maps?|brochures?|day[\s-]?use|trailhead|programs?|ice|coffee|tours?|boat\s+launch(?:ing)?|launch)\b"
    r"|\b(?:drinking\s+water|water|wi-?fi|showers?|parking|firewood|dump\s+station|admission|entry|entrance|day[\s-]?use(?:\s+areas?)?|"
    r"picnicking|picnic\s+areas?|maps?|boat\s+launch(?:ing)?|trailhead\s+parking)\b[^.;]{0,30}?\b(?:is|are)\s+(?:also\s+)?free\b"
    r"|\bday[\s-]?use(?:\s+areas?)?\s*[:\-\u2013]\s*(?:no\s+fees?|free|none)\b"
    r"|(?:no\s+fees?(?:\s+currently\s+charged)?|none|free|no\s+charge)\s+(?:for|at)\s+(?:day[\s-]?use|parking|picnic(?:king)?|riding|the\s+trails?|trails?|boat\s+launch(?:ing)?|entry|entrance)(?!\s+(?:or|and|&)\s+(?:overnight\s+)?camp)", re.I)
FEE_FREE = re.compile(
    r"\bnot\s+a\s+fee\s+(?:site|area|campground)\b|\b(?:non-fee|no-fee|fee-free|no[\s-]charge|not\s+charging(?:\s+any)?(?:\s+use)?\s+fees?|no\s+(?:camping\s+|use\s+|overnight\s+|user\s+)?fees?|no\s+charge|no\s+cost|"
    r"fees?\s*:?\s*(?:none|free|\$\s?0(?:\.00)?)\b|free\s+of\s+charge)\b", re.I)
STATED_FREE = re.compile(
    r"^(?:free|none|no|no\s+fees?)\s*[.!]?$|^(?:none|no\s+fees?)\s*[.!]\s|\bremains?\s+free\b|^free\b(?!\s+(?:drinking|potable|water|wi-?fi|showers?|parking|firewood|dump|admission|entry|day))"
    r"|\b(?:it|this|camping|campsites?|sites?|the\s+(?:site|area|campground|facility)|this\s+(?:site|area|campground|facility))\s+(?:is|are)\s+(?:completely\s+|always\s+)?free\b"
    r"|\bfree\s+(?:dispersed\s+)?(?:camping|campsites?|campground|facility|site)\b"
    r"|\bthis\s+is\s+a\s+free\s+(?:facility|site|campground|area)\b"
    r"|\b(?:camping|campsites?|sites?)(?:\s+fee)?\s*[:\-]?\s*free\b"
    r"|\bavailable\s+at\s+no\s+(?:charge|cost)\b", re.I)
CAMP_STATED_FREE = re.compile(r"\bcamping(?:\s+(?:and|&)\s+[\w\s-]{1,20}?)?\s+(?:is|are)\s+(?:completely\s+|always\s+)?free\b", re.I)
# Explicit camping statement from the BLM feed; require a complete sentence so
# negated quotations and statements about parking or entry do not qualify.
CAMP_NO_FEE_REQUIREMENT = re.compile(r'(?:^|[.!?]\s+)(?:there\s+is\s+)?no\s+permit\s+or\s+fee\s+requirement\s+to\s+camp(?=[.!?]|$)', re.I)
SEASONAL_FREE = re.compile(r"(?:\bfree|\bno\s+fees?|\bfee-free|\bno\s+charge)\s*,?\s+(?:after|until|before|during|when|outside(?:\s+of)?|from|in\s+(?:the\s+)?(?:off|winter|summer|fall|spring))\b", re.I)
SEASON_BEFORE_FREE = re.compile(r'\b(?:after\s+(?:the\s+)?season|off[ -]season)\b[^.!?]{0,140}\b(?:no\s+fees?|free)\b', re.I)
TEMPORARY_NO_COLLECTION = re.compile(
    r'^(?:camping\s+)?fees?\s+are\s+not\s+(?:being\s+)?collected\s+at\s+this\s+time[.!]?$'
    r'|^at\s+this\s+time\s+we\s+are\s+not\s+charging\s+(?:any\s+)?(?:use\s+)?fees?\b'
    r'|^no\s+(?:camping\s+)?fees?\s+(?:is\s+|are\s+)?currently\s+charged[.!]?$', re.I)
# The four BLM campground fee fields use this mandatory-payment statement.
# Keep it tied to the named campground, not booking or ancillary-service prose.
MANDATORY_CAMP_PAYMENT = re.compile(
    r'^(?!nearby\b|another\b|other\b)(?:[\w\u2019\x27() -]{1,100}\s+campground|the\s+campground\s+at\s+[\w\u2019\x27() -]{1,100})'
    r'\s+is\s+first\s+come,\s*first\s+served\s+and\s+payment\s+must\s+be\s+made\s+upon\s+arrival\b', re.I)
NO_FEE_TO_CAMP = re.compile(r"\bno\s+(?:camping\s+fees?|fees?\s+(?:to|for)\s+camp(?:ing)?)\b", re.I)
CAMP_PAID = re.compile(r'\bcamping\s+fees?\b(?!\s*(?::\s*)?(?:free|none|no\b))|\bfees?\s+(?:for|to)\s+camp|\bcamping:?\s*\$\s?[1-9]', re.I)
PASS_REQUIRED = re.compile(r'\b(?:pass|permit)\b(?![^.]{0,30}\bnot\s+required)[^.]{0,30}\b(?:is\s+|are\s+)?required\b|\brequires?\b[^.]{0,30}\b(?:pass|permit)\b', re.I)
NEED_PASS = re.compile(r'\b(?:need|must\s+(?:have|display|purchase|buy)|have|display|purchase)\s+(?:to\s+(?:have|display|purchase)\s+)?(?:a\s+|an\s+)?(?:[\w-]+\s+){0,3}?(?:pass|permit)\b', re.I)
NO_PASS = re.compile(r'\bno\s+(?:permits?|passes)\b|\b(?:pass|permit)\w*\s+(?:is\s+|are\s+)?not\s+required', re.I)
# Statements that a charge exists, without an amount.
CHARGE = re.compile(r'\buser[\s-]fee\s+station\b|\bself[\s-]service\s+(?:fee|pay)|\bfee\s+(?:area|site|campground|tube|envelope)\b|\bthere\s+is\s+a\s+(?:nightly\s+|camping\s+|daily\s+)?fee\b'
                    r'|\bfees?\s+(?:apply|are\s+charged|are\s+collected|vary|range)\b|\bnightly\s+fee\b|\bper[\s-]night\s+fee\b', re.I)


def clean(text):
    t = html.unescape(re.sub(r'<[^>]+>', ' ', text or ''))
    return re.sub(r'\s+', ' ', t).strip()


def classify_cost(t):
    nightly = sorted({float(a) for a in NIGHTLY.findall(t) if float(a) > 0} | {float(a) for a in re.findall(r'\b(\d{1,3}(?:\.\d{2})?)\s?\$\s*/\s*night', t, re.I) if float(a) > 0})
    if len(nightly) != 1:
        return None
    return int(nightly[0]) if nightly[0].is_integer() else nightly[0]


def required_pass(text):
    """A negated permit in one sentence does not cancel a later requirement."""
    text = CAMP_NO_FEE_REQUIREMENT.sub(' ', clean(text))
    # Keep named permits containing a person's initial in the same sentence.
    text = re.sub(r'\b([A-Z])\.(?=\s+[A-Z][a-z])', r'\1', text)
    for clause in re.split(r'[.;]|\bbut\b|\bhowever\b', text, flags=re.I):
        clause = clause.strip(' ,')
        # These complete agency clauses describe commercial/group exceptions or
        # explicitly different land, not ordinary camping at the named site.
        if re.fullmatch(
                r'commercial, competitive, and large organized group events require a special recreation permit'
                r'|use of public lands in connection with commercial recreational use requires a BLM special recreation permit'
                r'|recreational activities on any nearby state trust land require a permit from the State of Arizona'
                r'|visitors should note that entering the adjacent San Carlos Indian Reservation, which shares the wilderness[\u2019\x27] northeastern border, requires a recreation permit from the tribe',
                clause, re.I):
            continue
        named_range_permit = re.search(r'\brequires? a free Barry M Goldwater Range permit\b', clause, re.I)
        if (PASS_REQUIRED.search(clause) or NEED_PASS.search(clause) or named_range_permit) and not NO_PASS.search(clause):
            return True
    return False


def classify(text):
    """Return (status, cost) where cost is a nightly amount or None."""
    t = clean(text)
    if not t:
        return 'unknown', None
    amounts = [float(a or b) for a, b in DOLLAR.findall(t)]
    charges = [a for a in amounts if a > 0]
    if NEG_FREE_CAMP.search(t):
        return 'paid', classify_cost(t)
    if MANDATORY_CAMP_PAYMENT.search(t) and not re.search(r'\b(?:not true|incorrect|not accurate|false that)\b', t, re.I):
        return 'paid', classify_cost(t)
    if TEMPORARY_NO_COLLECTION.search(t):
        return 'conditional', None
    # Strip wording about free non-camping services and other negations before looking for a free signal.
    core = NEG_FREE_ANY.sub(' ', ANCILLARY_FREE.sub(' ', t))
    free_signal = bool(FEE_FREE.search(core) or STATED_FREE.search(core) or CAMP_STATED_FREE.search(t) or CAMP_NO_FEE_REQUIREMENT.search(t))
    if amounts and not charges and not re.search(r'\$\s?0(?:\.00)?\s*(?:for|at)\s+(?:day|parking)', t, re.I):
        free_signal = True
    if CAMP_PAID.search(t) and not NO_FEE_TO_CAMP.search(t):
        return ('conditional', None) if free_signal and re.search(r'\bcamping\b[^.]{0,40}\b(?:free|no\s+fees?)', core, re.I) else ('paid', classify_cost(t) if charges else None)
    if free_signal and not charges and (SEASONAL_FREE.search(t) or SEASON_BEFORE_FREE.search(t)):
        # Free only in some seasons or conditions.
        return 'conditional', None
    if free_signal and not charges:
        # Free camping that still needs a paid pass or permit is conditional, not free.
        # The explicit no-camping-permit statement does not negate a separate
        # vehicle/pass requirement elsewhere in the wording.
        if required_pass(t):
            return 'conditional', None
        return 'free', 0
    if free_signal and charges:
        return 'conditional', None
    if charges:
        return 'paid', classify_cost(t)
    if CHARGE.search(t):
        return 'paid', None
    # A pointer to Recreation.gov or "current fees" does not establish what camping costs.
    return 'unknown', None

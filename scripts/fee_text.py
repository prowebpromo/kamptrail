"""Classify agency fee wording into free, paid, conditional, or unknown.

The wording itself is kept as evidence. Rules are conservative:
- free: the text says there is no camping fee and names no dollar charge above $0.
- conditional: the text says something is free and also names a charge
  (extra vehicles, reservations, some sites). The camping itself may be free.
- paid: the text names a charge, or points to Recreation.gov or a fee page for current fees.
- unknown: blank or ambiguous.
Day-use-only statements ("no fee for day use") never make camping free.
"""
import html
import re

DOLLAR = re.compile(r'\$\s?(\d{1,4}(?:\.\d{2})?)')
FREE = re.compile(r'\b(?:non-fee|no-fee|not\s+charging(?:\s+any)?(?:\s+use)?\s+fees?|no\s+(?:camping\s+)?fees?|free(?:\s+of\s+charge)?|no\s+charge|no\s+cost|fee:?\s*none|none)\b', re.I)
FREE_WHOLE = re.compile(r'^(?:camping\s+)?(?:fees?:?\s*)?(?:none|no)\.?$', re.I)
PASS_REQUIRED = re.compile(r'\b(?:pass|permit)\b(?![^.]{0,30}\bnot\s+required)[^.]{0,30}\b(?:is\s+|are\s+)?required\b|\brequires?\b[^.]{0,30}\b(?:pass|permit)\b', re.I)
NO_PASS = re.compile(r'\bno\s+(?:permits?|passes)\b|\b(?:pass|permit)\w*\s+(?:is\s+|are\s+)?not\s+required', re.I)
CAMP_PAID = re.compile(r'\bcamping\s+fees?\b(?!\s*(?::\s*)?(?:free|none|no\b))|\bfees?\s+(?:for|to)\s+camp|\bcamping:?\s*\$\s?[1-9]', re.I)
DAY_USE_ONLY_FREE = re.compile(r'(?:no\s+fees?|free|no\s+charge)\s+(?:for|at)\s+(?:day[\s-]?use|parking|picnic)|day[\s-]?use[^.]{0,40}\b(?:is\s+)?(?:free|no\s+fee)', re.I)
CAMP_FREE = re.compile(r'(?:camping|campsites?|campground|overnight|this\s+(?:is\s+a\s+)?free\s+facility|this\s+site)[^.]{0,60}\b(?:free|no\s+fees?|no\s+charge)\b|\b(?:free|no\s+fees?|no\s+charge)\b[^.]{0,40}\b(?:camping|campsites?|campground|overnight)', re.I)
POINTER = re.compile(r'fees?\s+for\s+camping|user[\s-]fee\s+station|self[\s-]service\s+(?:fee|pay)|recreation\.gov|current\s+(?:fees|pricing)|fee\s+information|fees?\s+(?:vary|apply|are\s+charged|range)|per\s+night|/\s*night|nightly', re.I)
NIGHTLY = re.compile(r'\$\s?(\d{1,3}(?:\.\d{2})?)\s*(?:/|per|a|each)\s*(?:night|site|campsite|unit)', re.I)


def clean(text):
    t = html.unescape(re.sub(r'<[^>]+>', ' ', text or ''))
    return re.sub(r'\s+', ' ', t).strip()


def classify_cost(t):
    nightly = sorted({float(a) for a in NIGHTLY.findall(t) if float(a) > 0})
    if len(nightly) != 1:
        return None
    return int(nightly[0]) if nightly[0].is_integer() else nightly[0]


def classify(text):
    """Return (status, cost) where cost is a nightly amount or None."""
    t = clean(text)
    if not t:
        return 'unknown', None
    amounts = [float(a) for a in DOLLAR.findall(t)]
    charges = [a for a in amounts if a > 0]
    free_signal = bool(FREE_WHOLE.match(t) or (FREE.search(t) and not DAY_USE_ONLY_FREE.search(t)) or CAMP_FREE.search(t))
    if free_signal and DAY_USE_ONLY_FREE.search(t) and not CAMP_FREE.search(t):
        free_signal = False
    if amounts and not charges:
        free_signal = True
    if CAMP_PAID.search(t) and not re.search(r'no\s+camping\s+fee', t, re.I):
        return ('conditional', None) if free_signal and CAMP_FREE.search(t) else ('paid', None if not charges else classify_cost(t))
    if free_signal and not charges:
        # Free camping that still needs a paid pass or permit is conditional, not free.
        if PASS_REQUIRED.search(t) and not NO_PASS.search(t):
            return 'conditional', None
        return 'free', 0
    if free_signal and charges:
        return 'conditional', None
    if charges:
        nightly = sorted({float(a) for a in NIGHTLY.findall(t) if float(a) > 0})
        cost = nightly[0] if len(nightly) == 1 else None
        if cost is not None and cost.is_integer():
            cost = int(cost)
        return 'paid', cost
    if POINTER.search(t):
        return 'paid', None
    return 'unknown', None

"""Shared validation for fetched datasets. A failed/empty fetch never replaces saved data."""
import json
import math
from pathlib import Path


def valid_coordinates(coords):
    return (isinstance(coords, (list, tuple)) and len(coords) >= 2
            and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                    and math.isfinite(v) for v in coords[:2])
            and -180 <= coords[0] <= 180 and -90 <= coords[1] <= 90)


def save_geojson(path, data):
    """Validate and atomically replace a nonempty Point FeatureCollection."""
    path = Path(path)
    features = data.get('features') if isinstance(data, dict) else None
    if not isinstance(data, dict) or data.get('type') != 'FeatureCollection' or not isinstance(features, list) or not features:
        raise ValueError(f'Refusing empty or invalid dataset: {path}')
    if any(f.get('type') != 'Feature' or f.get('geometry', {}).get('type') != 'Point'
           or not valid_coordinates(f.get('geometry', {}).get('coordinates')) for f in features):
        raise ValueError(f'Refusing dataset with invalid point geometry: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    tmp.replace(path)

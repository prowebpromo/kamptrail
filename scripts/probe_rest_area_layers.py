#!/usr/bin/env python3
"""Read-only probe of candidate official rest-area layers (metadata, count, 3 samples)."""
import json, sys, time, urllib.parse, urllib.request
UA = 'KampTrail rest-area importer (+https://github.com/prowebpromo/kamptrail)'
CANDIDATES = {
 'CA': 'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Rest_Areas/FeatureServer/0',
 'CO': 'https://maps.codot.gov/server/rest/services/Hosted/Rest_Areas/FeatureServer/0',
 'WA': 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/FacilitiesData/FeatureServer/8',
 'WA6': 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/FacilitiesData/FeatureServer/6',
 'GA': 'https://egisp.dot.ga.gov/arcgis/rest/services/EOC_SUPPORT_LAYERS/MapServer/3',
 'SD': 'https://dotgis.sd.gov/missouririver/rest/services/Operations/DOT_Rest_Areas/MapServer/1',
 'IN': 'https://gis.indot.in.gov/ro/rest/services/DOT/INDOT_Rest_Areas/FeatureServer/0',
 'NV': 'https://gis.dot.nv.gov/arcgis/rest/services/Applications/511Map/MapServer/5',
 'KS': 'https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Facilities/Rest_Areas/MapServer/0',
 'NE': 'https://giscat.ne.gov/enterprise/rest/services/Rest_Areas/FeatureServer/0',
 'KY': 'https://test-maps.kytc.ky.gov/arcgis/rest/services/RestAreaLocations/MapServer/0',
 'MI': 'https://gisagomdot.state.mi.us/arcgis/rest/services/MDOT/MdotRestAreaPublic/MapServer/0',
 'IA': 'https://gis.iowadot.gov/agshost/rest/services/Hosted/Rest_Areas_All/FeatureServer/1',
 'UT': 'https://maps.udot.utah.gov/central/rest/services/Maintenance/Facility_Inventory_OMS/MapServer',
}
def get(url, params):
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read(3_000_000))
out = {}
for state, url in CANDIDATES.items():
    row = {'url': url}
    try:
        meta = get(url, {'f': 'json'})
        row['meta'] = {k: meta.get(k) for k in ('name', 'type', 'geometryType', 'description', 'copyrightText', 'serviceDescription', 'editingInfo', 'maxRecordCount')}
        row['fields'] = [(f.get('name'), f.get('type'), f.get('alias')) for f in meta.get('fields') or []]
        row['layers'] = [(l.get('id'), l.get('name')) for l in meta.get('layers') or []]
        if meta.get('fields'):
            row['count'] = get(url + '/query', {'where': '1=1', 'returnCountOnly': 'true', 'f': 'json'}).get('count')
            sample = get(url + '/query', {'where': '1=1', 'outFields': '*', 'outSR': '4326', 'returnGeometry': 'true', 'resultRecordCount': 3, 'f': 'json'})
            row['sample'] = [{'attributes': f.get('attributes'), 'geometry': f.get('geometry')} for f in sample.get('features') or []]
    except Exception as e:
        row['error'] = f'{type(e).__name__}: {str(e)[:200]}'
    out[state] = row
    print(state, row.get('count'), row.get('meta', {}).get('name') if row.get('meta') else '', row.get('error', ''))
    time.sleep(1)
json.dump(out, open(sys.argv[1], 'w'), indent=1)

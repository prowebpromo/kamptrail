# DRAFT ONLY. Not committed. Merge into REGIONS in scripts/fetch_official_rest_areas.py after review.
# Helper names slug, join, epoch_iso and us_date come from that module and are not redefined here.
# Every entry needs a matching reviewed (operator, facility_kind) scope in data/rest-areas/state-policies.json.
# Fields marked UNVERIFIED in review.md were not provable from the 3-sample probe.
# `re` is also used from the module namespace.

def _num(value):
    """Format a numeric milepost like the original (no trailing .0). Returns None for blanks."""
    return None if value in (None, '') else f"{float(value):g}"


NEW_REGIONS = {
    'CA': {
        'operator': 'caltrans', 'facility_kind': 'safety_roadside_rest_area',
        'publisher': 'Caltrans, Division of Maintenance',
        'layer': 'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Rest_Areas/FeatureServer/0',
        'info_url': 'https://dot.ca.gov/programs/design/lap-landscape-architecture-and-community-livability/lap-liv-h-safety-roadside-rest-areas',
        # Layer is Caltrans' "Safety Roadside Rest Areas" and has no type or status field. 1=1 relies on the layer scope.
        'where': '1=1', 'min': 60, 'max': 120,
        'bbox': (-124.6, 32.4, -114.0, 42.1),
        'native_id': lambda a: slug(a.get('CT_NO')),
        'name': lambda a: a.get('MAP_LABEL_NAME'),
        'location': lambda a: join(a.get('ROUTE') and f"Route {str(a['ROUTE']).strip()}", a.get('LANDMARK_LOCATION'), a.get('COUNTY') and f"{a['COUNTY']} County"),
        'milepost': lambda a: _num(a.get('POSTMILE')),
        'updated': lambda a: None,
    },
    'CO': {
        'operator': 'cdot', 'facility_kind': 'rest_area',
        'publisher': 'Colorado Department of Transportation',
        'layer': 'https://maps.codot.gov/server/rest/services/Hosted/Rest_Areas/FeatureServer/0',
        'info_url': 'https://www.codot.gov/travel/state-highway-rest-areas/map-of-rest-areas',
        # location_t and site_descr are real fields. Closed sites carry "(Closed)" inside site_descr. UNVERIFIED: other location_t values.
        'where': "location_t = 'Rest Area' AND site_descr LIKE 'CDOT%' AND site_descr NOT LIKE '%Closed%'", 'min': 10, 'max': 40,
        'bbox': (-109.1, 36.9, -102.0, 41.1),
        'native_id': lambda a: slug(None if a.get('id') in (None, '') else int(a['id'])),
        'name': lambda a: a.get('site_locat') or a.get('name'),
        'location': lambda a: join(a.get('highway'), a.get('nearest_to')),
        'milepost': lambda a: None if str(a.get('mile_marke') or '').strip() == '' else str(a['mile_marke']).strip(),
        'updated': lambda a: None,
    },
    'WA': {
        'operator': 'wsdot', 'facility_kind': 'safety_rest_area',
        'publisher': 'Washington State Department of Transportation',
        'layer': 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/FacilitiesData/FeatureServer/8',
        'info_url': 'https://wsdot.wa.gov/travel/safety/rest-areas/home',
        # Layer 8 is "Sites Active Rest Area" (site points). Layer 6 (buildings) is not used. SiteStatus samples: OWNED. Leased sites are still WSDOT facilities.
        'where': '1=1', 'min': 30, 'max': 70,
        'bbox': (-124.9, 45.5, -116.9, 49.1),
        'native_id': lambda a: slug(str(a.get('SiteFCR') or '').strip()),
        'name': lambda a: a.get('SiteName'),
        'location': lambda a: join(re.sub(r'\s+', ' ', str(a.get('SiteLocation') or '')).strip(), a.get('SiteCity')),
        'milepost': lambda a: (re.search(r'\bMP\s+(\d+(?:\.\d+)?)', str(a.get('SiteLocation') or '')) or [None, None])[1],
        'updated': lambda a: None,
    },
    'SD': {
        'operator': 'sddot', 'facility_kind': 'rest_area',
        'publisher': 'South Dakota Department of Transportation',
        'layer': 'https://dotgis.sd.gov/missouririver/rest/services/Operations/DOT_Rest_Areas/MapServer/1',
        'info_url': 'https://dot.sd.gov/travelers/travelers/rest-areaports-of-entry/',
        # Welcome_Center = Y/N marks SDDOT welcome centers that sit at rest areas. They stay in scope. UNVERIFIED: other Type_ values.
        'where': "Type_ = 'Rest Area'", 'min': 15, 'max': 60,
        'bbox': (-104.2, 42.4, -96.3, 46.0),
        'native_id': lambda a: str(a.get('GlobalID') or '').strip('{}').lower(),
        'name': lambda a: a.get('Location') and join(f"{a['Location']} Rest Area", a.get('Lane_Dir')).replace(', ', ' ', 1),
        'location': lambda a: join(a.get('Hwy_route'), a.get('County') and f"{a['County']} County"),
        'milepost': lambda a: None if a.get('MRM') in (None, '') else str(a['MRM']),
        'updated': lambda a: None,
    },
    'IN': {
        'operator': 'indot', 'facility_kind': 'rest_area_or_welcome_center',
        'publisher': 'Indiana Department of Transportation',
        'layer': 'https://gis.indot.in.gov/ro/rest/services/DOT/INDOT_Rest_Areas/FeatureServer/0',
        'info_url': 'https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/',
        # STATUS and MAINT_BY are real fields (samples: Open, INDOT). Truck-only sites are named "... Truck Parking ..." in SITE_NAME (one sample). UNVERIFIED: that naming holds for every truck-only site.
        'where': "MAINT_BY = 'INDOT' AND STATUS = 'Open' AND SITE_NAME NOT LIKE '%Truck Parking%'", 'min': 15, 'max': 45,
        'bbox': (-88.2, 37.7, -84.7, 41.8),
        'native_id': lambda a: str(a.get('GLOBALID') or '').strip('{}').lower(),
        'name': lambda a: a.get('SITE_NAME'),
        'location': lambda a: a.get('LOCATION'),
        'milepost': lambda a: (re.search(r'Mile Marker\s+(\d+(?:\.\d+)?)', str(a.get('LOCATION') or '')) or [None, None])[1],
        'updated': lambda a: epoch_iso(a.get('LAST_EDITED_DATE')),
    },
    'NV': {
        'operator': 'ndot', 'facility_kind': 'rest_area',
        'publisher': 'Nevada Department of Transportation',
        'layer': 'https://gis.dot.nv.gov/arcgis/rest/services/Applications/511Map/MapServer/5',
        'info_url': 'https://www.dot.nv.gov/travel-info/rest-areas-welcome-centers',
        # Layer metadata says NDOT and county entities maintain these. MAINTAINED_BY separates them (samples: Nevada DOT, Eureka County).
        # UNVERIFIED: full list of STATUS and CATEGORY values and any other MAINTAINED_BY spelling of NDOT.
        'where': "MAINTAINED_BY = 'Nevada DOT' AND STATUS = 'Open To Traffic'", 'min': 15, 'max': 50,
        'bbox': (-120.1, 35.0, -114.0, 42.0),
        'native_id': lambda a: slug(a.get('REST_AREA_ID')),
        'name': lambda a: a.get('NAME'),
        'location': lambda a: join(a.get('ROUTE_FULL'), a.get('COUNTY') and f"{a['COUNTY']} County"),
        'milepost': lambda a: _num(a.get('MILEPOST')),
        'updated': lambda a: epoch_iso(a.get('last_edited_date')),
    },
    'KS': {
        'operator': 'kdot', 'facility_kind': 'rest_area',
        'publisher': 'Kansas Department of Transportation',
        'layer': 'https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Facilities/Rest_Areas/MapServer/0',
        'info_url': 'https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Facilities/Rest_Areas/MapServer/0',
        # No type, status or name field exists. UNVERIFIED: whether closed sites remain in the layer.
        'where': '1=1', 'min': 25, 'max': 60,
        'bbox': (-102.1, 36.9, -94.6, 40.1),
        'native_id': lambda a: slug(str(a.get('DOT_NO') or '').strip()),
        'name': lambda a: a.get('Route') and join(f"{str(a['Route']).strip()} Rest Area", str(a.get('LocationDescription') or '').strip().title()).replace(', ', ' ', 1),
        'location': lambda a: a.get('LocationDescription'),
        'milepost': lambda a: None,
        'updated': lambda a: None,
    },
    'NE': {
        # LOW CONFIDENCE. The probe returned no count and no sample records. Nothing below is checked against real values.
        'operator': 'ndot_ne', 'facility_kind': 'rest_area',
        'publisher': 'Nebraska Department of Transportation',
        'layer': 'https://giscat.ne.gov/enterprise/rest/services/Rest_Areas/FeatureServer/0',
        'info_url': 'https://dot.nebraska.gov/travel/rest-area',
        # UNVERIFIED: Site_Type values (rest area, welcome center, wayside, other).
        'where': '1=1', 'min': 8, 'max': 60,
        'bbox': (-104.1, 40.0, -95.3, 43.0),
        'native_id': lambda a: slug(str(a.get('Site_Number') or '').strip()),
        'name': lambda a: a.get('Display_Name') or a.get('Site_Name'),
        'location': lambda a: join(a.get('Ph_Address'), a.get('City')),
        'milepost': lambda a: None,
        'updated': lambda a: None,
    },
    'KY': {
        'operator': 'kytc', 'facility_kind': 'rest_area_or_welcome_center',
        'publisher': 'Kentucky Transportation Cabinet',
        'layer': 'https://test-maps.kytc.ky.gov/arcgis/rest/services/RestAreaLocations/MapServer/0',
        'info_url': 'https://transportation.ky.gov/MultimodalFreight/Documents/Rest%20Areas%20and%20Welcome%20Centers.pdf',
        # Facility_Type samples: Rest Area, Welcome Center, Trucker Rest Haven. Status samples: Open, Rest Area Closed, Rest Area and Truck Parking Closed.
        # Trucker Rest Haven is a truck-parking class and is excluded. Strict Status = 'Open' drops partial closures. UNVERIFIED: the full Status list.
        'where': "Facility_Type IN ('Rest Area','Welcome Center') AND Status = 'Open'", 'min': 10, 'max': 40,
        'bbox': (-89.6, 36.5, -81.9, 39.2),
        'native_id': lambda a: slug(a.get('FacilityName')),
        'name': lambda a: a.get('FacilityName'),
        'location': lambda a: join(a.get('DESCRIPTION'), a.get('CNTY_NAME') and f"{a['CNTY_NAME']} County"),
        'milepost': lambda a: _num(a.get('MP')),
        'updated': lambda a: epoch_iso(a.get('last_edited_date')),
    },
    'MI': {
        'operator': 'mdot', 'facility_kind': 'rest_area_or_welcome_center',
        'publisher': 'Michigan Department of Transportation',
        'layer': 'https://gisagomdot.state.mi.us/arcgis/rest/services/MDOT/MdotRestAreaPublic/MapServer/0',
        'info_url': 'https://gisagomdot.state.mi.us/arcgis/rest/services/MDOT/MdotRestAreaPublic/MapServer/0',
        # Only Status = 'Open' is proven by samples. FacilityFunction samples: "Safety Rest Area", "Safety Rest Area/Welcome Center".
        # UNVERIFIED: other Status values (seasonal, closed) and other FacilityFunction values (roadside park, truck parking, other).
        'where': "Status = 'Open'", 'min': 40, 'max': 110,
        'bbox': (-90.6, 41.6, -82.1, 48.4),
        'native_id': lambda a: slug(join(a.get('FacilityName'), a.get('RouteName'), a.get('RouteDirection'))),
        'name': lambda a: a.get('FacilityName'),
        'location': lambda a: ' '.join(str(x).strip() for x in (a.get('RouteName'), a.get('RouteDirection')) if x not in (None, '') and str(x).strip()),
        'milepost': lambda a: None if str(a.get('MileMarker') or '').strip() == '' else str(a['MileMarker']).strip(),
        'updated': lambda a: None,
    },
    'IA': {
        'operator': 'iowa_dot', 'facility_kind': 'rest_area',
        'publisher': 'Iowa Department of Transportation',
        'layer': 'https://gis.iowadot.gov/agshost/rest/services/Hosted/Rest_Areas_All/FeatureServer/1',
        'info_url': 'https://ia.iowadot.gov/maintenance/rest-areas',
        # Layer description says it also holds parking facilities and weigh areas. facility_type samples: Rest Area. UNVERIFIED: the other facility_type values.
        'where': "facility_type = 'Rest Area'", 'min': 20, 'max': 60,
        'bbox': (-96.7, 40.3, -90.1, 43.6),
        'native_id': lambda a: slug(str(a.get('inventory_id') or '').strip()),
        'name': lambda a: a.get('rest_areas'),
        'location': lambda a: a.get('address'),
        'milepost': lambda a: _num(a.get('milepost')),
        'updated': lambda a: epoch_iso(a.get('rest_updated')) or epoch_iso(a.get('edited_date')),
    },
}

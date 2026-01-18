#!/bin/bash

# Bounding box for North America (approximated)
BBOX="15,-170,72,-52"

# Overpass API query to get campsites
QUERY="[out:json][timeout:300];(node[\"tourism\"=\"camp_site\"](${BBOX});way[\"tourism\"=\"camp_site\"](${BBOX});relation[\"tourism\"=\"camp_site\"](${BBOX}););out body;>;out skel qt;"

# URL encode the query
ENCODED_QUERY=$(echo "$QUERY" | sed 's/ /%20/g' | sed 's/"/%22/g' | sed 's/(/%28/g' | sed 's/)/%29/g' | sed 's/;/%3B/g' | sed 's/=/%3D/g' | sed 's/,/%2C/g' | sed 's/|/%7C/g')

# Overpass API endpoint
API_ENDPOINT="https://overpass-api.de/api/interpreter"

# Fetch the data and convert to GeoJSON
curl -G "${API_ENDPOINT}" --data-urlencode "data=${QUERY}" | osmtogeojson > data/opencampingmap.geojson

echo "OpenCampingMap data downloaded and processed successfully."
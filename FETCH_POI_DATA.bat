@echo off
echo.
echo ========================================================
echo  KampTrail - POI Data Fetcher
echo  Fetching from Recreation.gov + OpenStreetMap
echo ========================================================
echo.
echo This will fetch:
echo   - Water stations from Recreation.gov campsites
echo   - Dump stations from OpenStreetMap
echo   - Propane fill locations from OpenStreetMap
echo.
echo This may take 2-3 minutes...
echo.

python scripts\fetch_osm_poi.py

if errorlevel 1 (
    echo.
    echo ERROR: Failed to fetch POI data
    echo.
    echo Common issues:
    echo   - Python requests library not installed
    echo     Fix: pip install requests
    echo   - Network connection issue
    echo     Fix: Check internet connection
    pause
    exit /b 1
)

echo.
echo ========================================================
echo   SUCCESS! POI data updated
echo ========================================================
echo.
echo Next steps:
echo   1. Commit the updated poi_dump_water_propane.geojson file
echo   2. Push to GitHub
echo   3. Your map will now show dump and propane stations!
echo.
pause

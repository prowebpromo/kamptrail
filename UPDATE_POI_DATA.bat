@echo off
REM ====================================================================
REM KampTrail - Update POI Data from All States
REM ====================================================================
REM Run this after fetching new state data to update water stations
REM ====================================================================

echo.
echo ========================================================
echo  KampTrail - POI Data Updater
echo ========================================================
echo.
echo Extracting water stations from all state files...
echo.

python scripts\update_poi_data.py

if errorlevel 1 (
    echo.
    echo ERROR: Failed to update POI data
    pause
    exit /b 1
)

echo.
echo ========================================================
echo   SUCCESS! POI data updated
echo ========================================================
echo.
echo Updated file: data\poi_dump_water_propane.geojson
echo.
echo The map will now show water stations from all states!
echo.
pause

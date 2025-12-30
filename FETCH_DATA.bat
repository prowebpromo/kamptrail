@echo off
REM ====================================================================
REM KampTrail - Fetch Real Campsite Data (Windows)
REM ====================================================================
REM Just double-click this file to fetch real campsite data!
REM ====================================================================

echo.
echo ========================================================
echo  KampTrail - Campsite Data Fetcher
echo ========================================================
echo.
echo This will fetch real campground data from Recreation.gov
echo and save it to the data/campsites folder.
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed!
    echo.
    echo Please install Python from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
pip install requests >nul 2>&1
echo      Done!
echo.

REM Define your API key (you can change this)
set API_KEY=9276246f-055a-4601-bbe7-a5ec1b45d654

REM Define states to fetch (edit this line to change states!)
REM Popular camping states:
set STATES=CA CO UT AZ OR WA MT WY NV ID

REM OR use New England states:
REM set STATES=NH ME VT MA CT RI

REM OR all 50 states (takes 2-3 hours):
REM set STATES=AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY

echo [2/3] Fetching campsite data...
echo      This will take about 5-10 minutes per state.
echo      States: %STATES%
echo.

set total=0

for %%s in (%STATES%) do (
    echo.
    echo ========================================
    echo   Processing: %%s
    echo ========================================

    python scripts\fetch_recreation_gov_data.py --api-key %API_KEY% --state %%s --limit 100

    if exist "data\campsites\%%s.geojson" (
        echo   Done: %%s
        set /a total+=1
    ) else (
        echo   Warning: %%s may have failed
    )

    timeout /t 3 >nul
)

echo.
echo ========================================================
echo   SUCCESS! Fetched data for %total% states
echo ========================================================
echo.
echo Your data is in: data\campsites\
echo.
echo NEXT STEPS:
echo 1. Open GitHub.com in your browser
echo 2. Go to: github.com/prowebpromo/kamptrail
echo 3. Click "Add file" - "Upload files"
echo 4. Drag all files from data/campsites/ folder
echo 5. Click "Commit changes"
echo 6. Refresh your KampTrail app!
echo.
echo ========================================================
echo.
pause

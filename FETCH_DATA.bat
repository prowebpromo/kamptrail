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
REM Fetching 40 NEW states (already have: CA CO UT AZ OR WA MT WY NV ID)
set STATES=AL AK AR CT DE FL GA HI IL IN IA KS KY LA ME MD MA MI MN MS MO NE NH NJ NM NY NC ND OH OK PA RI SC SD TN TX VT VA WV WI

REM OR all 50 states if you want to re-fetch everything (takes 2-3 hours):
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
echo 1. Open GitHub Desktop
echo 2. You'll see all the new state files
echo 3. Write commit message: "Add 40 more states with real data"
echo 4. Click "Commit to main"
echo 5. Click "Push origin"
echo 6. Wait 1-2 minutes for site to rebuild
echo.
echo ========================================================
echo.
pause

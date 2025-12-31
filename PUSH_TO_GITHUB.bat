@echo off
echo.
echo ========================================================
echo  Pushing KampTrail Updates to GitHub
echo ========================================================
echo.
echo Current directory: %CD%
echo.
echo Checking git status...
git status
echo.
echo ========================================================
echo.
echo Pushing to GitHub...
git push -u origin main
echo.
if errorlevel 1 (
    echo ERROR: Push failed
    echo.
    echo Please try pushing via GitHub Desktop instead:
    echo 1. Open GitHub Desktop
    echo 2. Make sure you're on the 'main' branch
    echo 3. Click 'Push origin' or 'Fetch origin' first, then push
    pause
    exit /b 1
)
echo.
echo ========================================================
echo   SUCCESS! Changes pushed to GitHub
echo ========================================================
echo.
pause

@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if errorlevel 1 goto :directory_error
title NEON DISTRICT 3D - Launcher
color 0A

echo ================================================================
echo                 NEON DISTRICT 3D - LAUNCHER
echo ================================================================
echo.
echo This window is supposed to stay open while the game server runs.
echo Do not close it during play.
echo.

if not exist "%~dp0index.html" goto :missing_files
if not exist "%~dp0server.ps1" goto :missing_files

where powershell.exe >nul 2>&1
if errorlevel 1 goto :missing_powershell

echo [1/3] Files found.
echo [2/3] Starting the local game server on port 8765...
echo.
echo When the server is ready, your default browser will open automatically.
echo If it does not, open: http://127.0.0.1:8765/
echo.
echo ----------------------------------------------------------------
echo SERVER OUTPUT
echo ----------------------------------------------------------------
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8765
set "SERVER_EXIT=%ERRORLEVEL%"
echo.
echo ----------------------------------------------------------------
if "%SERVER_EXIT%"=="0" (
  echo [INFO] The game server has stopped.
) else (
  echo [ERROR] The game server stopped with exit code %SERVER_EXIT%.
  echo.
  echo Check this log file for details:
  echo "%~dp0launcher.log"
  if exist "%~dp0launcher.log" type "%~dp0launcher.log"
)
echo ----------------------------------------------------------------
echo.
echo This window will remain open so you can read the result.
pause
exit /b %SERVER_EXIT%

:missing_files
echo [ERROR] Required game files are missing.
echo Make sure launch.bat, server.ps1, index.html, game.js and style.css
echo remain together in the same NEON_DISTRICT folder.
goto :fatal_pause

:missing_powershell
echo [ERROR] Windows PowerShell was not found.
echo This launcher requires the built-in Windows PowerShell.
goto :fatal_pause

:directory_error
echo [ERROR] Could not access the folder containing this launcher.
goto :fatal_pause

:fatal_pause
echo.
pause
exit /b 1

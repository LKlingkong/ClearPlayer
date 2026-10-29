@echo off
if exist "%~dp0ClearPlayer.exe" (
  start "" "%~dp0ClearPlayer.exe"
  exit /b 0
)
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.18 or newer, then open this file again.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo First launch: preparing the player dependencies...
  call npm install
  if errorlevel 1 (
    echo Installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
if not exist "dist\index.html" (
  echo Preparing the player...
  call npm run build
  if errorlevel 1 (
    echo Build failed. Please check the messages above.
    pause
    exit /b 1
  )
)
echo Starting CLEAR player. Your browser will open shortly.
echo Keep this window open while listening. Close it to stop the player.
call npm start -- --open
if errorlevel 1 pause

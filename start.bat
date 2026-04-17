@echo off
cd /d "%~dp0shelf"
if not exist node_modules\express (
  echo Installing dependencies...
  npm install --ignore-scripts
  echo Downloading better-sqlite3 native binary...
  cd node_modules\better-sqlite3
  node ..\prebuild-install\bin.js
  cd ..\..
)
echo Starting x4-onebook shelf...
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
npm run dev

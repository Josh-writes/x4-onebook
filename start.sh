#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/shelf"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi
echo "Starting x4-onebook shelf..."
npm run dev

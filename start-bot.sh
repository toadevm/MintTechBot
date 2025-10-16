#!/bin/bash

echo "🛑 Stopping any running bot processes..."
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
pkill -f "node.*index.js" 2>/dev/null || true
sleep 2

echo "🚀 Starting bot..."
npm run dev

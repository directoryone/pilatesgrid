#!/bin/bash
set -e

echo "Updating @directory packages..."
pnpm update @directoryone/core @directoryone/ui @directoryone/app

echo "Running database migrations..."
npx drizzle-kit migrate

echo "Running post-update script..."
NEW_VERSION=$(node -e "console.log(require('@directoryone/core/package.json').version)")
npx tsx scripts/post-update.ts "$NEW_VERSION"

echo ""
echo "Update complete! Now running platform version $NEW_VERSION."

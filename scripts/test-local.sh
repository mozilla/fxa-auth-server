#!/bin/sh

set -e

if [ -z "$NODE_ENV" ]; then export NODE_ENV=dev; fi;
if [ -z "$CORS_ORIGIN" ]; then export CORS_ORIGIN="http://foo,http://bar"; fi;

set -u

DEFAULT_ARGS="-R dot --recursive --timeout 5000 --exit"

./scripts/gen_keys.js
./scripts/gen_vapid_keys.js
node ./fxa-oauth-server/scripts/gen_keys.js

GLOB=$*
if [ -z "$GLOB" ]; then
  echo "Local tests"
  ./scripts/mocha-coverage.js $DEFAULT_ARGS test/local

  echo "Remote tests"
  ./scripts/mocha-coverage.js $DEFAULT_ARGS test/remote
else
  ./scripts/mocha-coverage.js $DEFAULT_ARGS $GLOB
fi

grunt eslint copyright

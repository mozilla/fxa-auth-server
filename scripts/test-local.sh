#!/bin/sh

set -e

if [ -z "$NODE_ENV" ]; then export NODE_ENV=dev; fi;
if [ -z "$CORS_ORIGIN" ]; then export CORS_ORIGIN="http://foo,http://bar"; fi;

set -u

GLOB=$*
if [ -z "$GLOB" ]; then
  GLOB="test/remote"
fi

DEFAULT_ARGS="-R dot --recursive --timeout 5000 --exit"

./scripts/gen_keys.js
./scripts/gen_vapid_keys.js

for i in 1 2 3 4 5 6 7
do
  echo "Looping ... number $i"
  ./scripts/mocha-coverage.js $DEFAULT_ARGS $GLOB
done

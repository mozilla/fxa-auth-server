#!/bin/sh

set -e

if [ -z "$NODE_ENV" ]; then export NODE_ENV=dev; fi;
if [ -z "$CORS_ORIGIN" ]; then export CORS_ORIGIN="http://foo,http://bar"; fi;

set -u

GLOB=$*
if [ -z "$GLOB" ]; then
  GLOB="test/local"
fi

DEFAULT_ARGS="-R dot --recursive --timeout 5000 --exit"

./scripts/gen_keys.js
./scripts/gen_vapid_keys.js

for ((n=0;n<10;n++))
do
    echo "Loop " $n
    ./scripts/mocha-coverage.js $DEFAULT_ARGS $GLOB
done

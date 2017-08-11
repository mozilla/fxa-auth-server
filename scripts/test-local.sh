#!/bin/sh

set -eu

glob=$*
if [ -z "$glob" ]; then
  glob="--recursive test/local test/remote"
fi

./scripts/gen_keys.js
./scripts/gen_vapid_keys.js
./scripts/mocha-coverage.js $glob
grunt eslint copyright

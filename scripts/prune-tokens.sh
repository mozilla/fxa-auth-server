#!/usr/bin/env bash

node ./bin/prune-tokens.js 2>&1 | ./node_modules/.bin/bunyan -o short

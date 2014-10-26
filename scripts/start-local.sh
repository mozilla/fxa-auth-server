#!/usr/bin/env bash
node ./scripts/gen_keys.js
node ./test/mail_helper.js &
MH=$!
node ./node_modules/fxa-auth-db-mem &
DB=$!

node ./bin/key_server.js

kill $MH
kill $DB

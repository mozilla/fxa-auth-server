#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*/

 Usage:

 node scripts/check-pending-reset.js -i ./reset.json

 This script is used to report on user accounts that are in the "must reset"
 state. It uses the same config file as key_server.js so should be run from a
 production instance.

 /*/

var butil = require('../lib/crypto/butil')
var commandLineOptions = require('commander')
var config = require('../config').getProperties()
var error = require('../lib/error')
var log = require('../lib/log')(config.log.level)
var P = require('../lib/promise')
var path = require('path')
var Token = require('../lib/tokens')(log, config.tokenLifetimes)

commandLineOptions
  .option('-i, --input <filename>', 'JSON input file')
  .parse(process.argv)

var requiredOptions = [
  'input'
]

requiredOptions.forEach(checkRequiredOption)


var DB = require('../lib/db')(
  config.db.backend,
  log,
  error,
  Token.SessionToken,
  Token.KeyFetchToken,
  Token.AccountResetToken,
  Token.PasswordForgotToken,
  Token.PasswordChangeToken
)

DB.connect(config[config.db.backend])
  .then(
    function (db) {
      var json = require(path.resolve(commandLineOptions.input))

      var uids = butil.bufferize(json.map(function (entry) {
        return entry.uid
      }), {inplace: true})

      var numMustReset = 0

      return P.all(uids.map(
        function (uid) {
          return db.account(uid)
            .then(
              function (account) {
                if (butil.buffersAreEqual(account.authSalt, butil.ONES)) {
                  log.info({ uid: uid, mustReset: true })
                  numMustReset += 1
                  return true
                }
                return false
              },
              function (err) {
                if (err.errno !== error.ERRNO.ACCOUNT_UNKNOWN) {
                  log.error({ op: 'checkPendingReset.failed', uid: uid, err: err })
                  process.exit(1)
                }
                return false
              }
            )
        }
        ))
        .then(
          function () {
            log.info({ complete: true, numMustReset: numMustReset })
          },
          function (err) {
            log.error(err)
          }
        )
        .then(db.close.bind(db))
    }
  )

function checkRequiredOption(optionName) {
  if (! commandLineOptions[optionName]) {
    console.error('--' + optionName + ' required')
    process.exit(1)
  }
}

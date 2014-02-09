/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

process.title = 'prune-tokens.js'

var config = require('../config').root()
var log = require('../log')(config.log.level)
var error = require('../error')
var Token = require('../tokens')(log, config.tokenLifetimes)

if (config.env !== 'prod') {
  log.info(config, "starting config")
}

// we can't do anything for the 'memory' backend
if ( config.db.backend === 'memory' ) {
  log.error({ op: 'startup', err: "Can't prune tokens for the memory DB_BACKEND" })
  process.exit()
}

var tokenLifetimes = config.tokenLifetimes

// get access to the database
var DB = require('../db')(
  config.db.backend,
  log,
  error,
  Token.SessionToken,
  Token.KeyFetchToken,
  Token.AccountResetToken,
  Token.PasswordForgotToken,
  Token.PasswordChangeToken
)

var db
DB.connect(config[config.db.backend])
  .then(
    function (newDb) {
      log.info({ op: 'DB.connect', msg: 'connected' })
      db = newDb
      return db.expireAccountResetTokens(tokenLifetimes.accountResetToken)
        .then(db.expirePasswordForgotTokens.bind(db, tokenLifetimes.passwordForgotToken))
        .then(db.expirePasswordChangeTokens.bind(db, tokenLifetimes.passwordChangeToken))
    },
    function (err) {
      log.error({ op: 'DB.connect', err: err })
      process.exit(1)
    }
  )
  .then(
    function() {
      log.info({ op: 'DB.expire*Tokens' })
      db.close()
    },
    function(err) {
      log.error({ op: 'DB.expire*Tokens', err: err })
      process.exit(1)
    }
  )

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var config = require('../config').root()
var jwtool = require('fxa-jwtool')

function main() {
  var log = require('../lib/log')(config.log.level)

  function logStatInfo() {
    log.stat(server.stat())
    log.stat(Password.stat())
  }

  log.event('config', config)
  if (config.env !== 'prod') {
    log.info(config, "starting config")
  }

  var error = require('../lib/error')
  var Token = require('../lib/tokens')(log, config.tokenLifetimes)
  var Password = require('../lib/crypto/password')(log, config)

  var signer = require('../lib/signer')(config.secretKeyFile, config.domain)
  var serverPublicKey = jwtool.JWK.fromFile(
    config.publicKeyFile,
    {
      algorithm: 'RS',
      use: 'sig',
      kid: 'dev-1',
      kty: 'RSA'
    }
  )

  var Customs = require('../lib/customs')(log, error)

  var Server = require('../lib/server')
  var server = null
  var mailer = null
  var statsInterval = null
  var database = null
  var customs = null

  require('../lib/mailer')(config, log)
    .done(
      function(m) {
        mailer = m

        var DB = require('../lib/db')(
          config.db.backend,
          log,
          error,
          Token.SessionToken,
          Token.KeyFetchToken,
          Token.SessionRevokeToken,
          Token.AccountResetToken,
          Token.PasswordForgotToken,
          Token.PasswordChangeToken
        )

        DB.connect(config[config.db.backend])
          .done(
            function (db) {
              database = db
              customs = new Customs(config.customsUrl)
              var routes = require('../lib/routes')(
                log,
                error,
                serverPublicKey,
                signer,
                db,
                mailer,
                Password,
                config,
                customs
              )
              server = Server.create(log, error, config, routes, db)

              server.start(
                function () {
                  log.info({ op: 'server.start.1', msg: 'running on ' + server.info.uri })
                }
              )
              statsInterval = setInterval(logStatInfo, 15000)
            },
            function (err) {
              log.error({ op: 'DB.connect', err: { message: err.message } })
              process.exit(1)
            }
          )

      }
    )

  process.on(
    'uncaughtException',
    function (err) {
      log.fatal(err)
      process.exit(8)
    }
  )
  process.on('SIGINT', shutdown)
  log.on('error', shutdown)

  function shutdown() {
    log.info({ op: 'shutdown' })
    clearInterval(statsInterval)
    server.stop(
      function () {
        customs.close()
        mailer.stop()
        database.close()
      }
    )
  }
}

main()

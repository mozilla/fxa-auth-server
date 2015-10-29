/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var config = require('../config').getProperties()
var jwtool = require('fxa-jwtool')

function main() {
  var log = require('../lib/log')(config.log.level)

  log.event('config', config)
  if (config.env !== 'prod') {
    log.info(config, 'starting config')
  }

  var error = require('../lib/error')
  var Token = require('../lib/tokens')(log, config.tokenLifetimes)
  var Password = require('../lib/crypto/password')(log, config)

  var signer = require('../lib/signer')(config.secretKeyFile, config.domain)
  var serverPublicKeys = {
    primary: jwtool.JWK.fromFile(
      config.publicKeyFile,
      {
        algorithm: 'RS',
        use: 'sig',
        kty: 'RSA'
      }
    ),
    secondary: config.oldPublicKeyFile ?
      jwtool.JWK.fromFile(
        config.oldPublicKeyFile,
        {
          algorithm: 'RS',
          use: 'sig',
          kty: 'RSA'
        }
      )
      : null
  }

  var Customs = require('../lib/customs')(log, error)

  var Server = require('../lib/server')
  var server = null
  var mailer = null
  var statsInterval = null
  var database = null
  var customs = null

  function logStatInfo() {
    log.stat(server.stat())
    log.stat(Password.stat())
  }

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
                serverPublicKeys,
                signer,
                db,
                mailer,
                Password,
                config,
                customs
              )
              server = Server.create(log, error, config, routes, db)

              server.start(
                function (err) {
                  if (err) {
                    log.fatal(err)
                    process.exit(1)
                  }

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
        process.exit() //XXX: because of openid dep ಠ_ಠ
      }
    )
  }
}

main()

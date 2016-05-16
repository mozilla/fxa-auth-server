/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('../ptaptest')
var TestServer = require('../test_server')
var Client = require('../client/index')
var JWTool = require('fxa-jwtool')

process.env.TRUSTED_JKUS = 'http://127.0.0.1:9000/.well-known/public-keys'
var config = require('../../config/index').getProperties()
var secretKey = JWTool.JWK.fromFile(
  config.secretKeyFile,
  {
    jku: config.publicUrl + '/.well-known/public-keys',
    kid: 'dev-1'
  }
)

function fail() { throw new Error('call succeeded when it should have failed')}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

TestServer.start(config)
.then(function main(server) {

  test(
    'a valid preVerifyToken creates a verified account',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'ok'
      var token = secretKey.signSync(
        {
          exp: nowSeconds() + 10,
          aud: config.domain,
          sub: email
        }
      )
      return Client.create(config.publicUrl, email, password, { preVerifyToken: token, keys: true })
        .then(
          function (c) {
            return c.keys()
          }
        )
        .then(
          function (keys) {
            t.ok(Buffer.isBuffer(keys.kA), 'kA exists')
            t.ok(Buffer.isBuffer(keys.wrapKb), 'wrapKb exists')
          }
        )
    }
  )

  test(
    'an invalid preVerifyToken return an invalid verification code error',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'ok'
      var token = secretKey.signSync(
        {
          exp: nowSeconds() + 10,
          aud: config.domain,
          sub: 'wrong@example.com'
        }
      )
      return Client.create(config.publicUrl, email, password, { preVerifyToken: token })
        .then(
          fail,
          function (err) {
            t.equal(err.errno, 105, 'invalid verification code')
          }
        )
    }
  )

  test(
    're-signup against an unverified email',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'abcdef'
      return Client.create(config.publicUrl, email, password)
        .then(
          function () {
            // delete the first verification email
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function () {
            var token = secretKey.signSync(
              {
                exp: nowSeconds() + 10,
                aud: config.domain,
                sub: email
              }
            )
            return Client.create(config.publicUrl, email, password, { preVerifyToken: token })
          }
        )
        .then(
          function (client) {
            t.ok(client.uid, 'account created')
          }
        )
    }
  )

  test(
    'teardown',
    function (t) {
      server.stop()
      t.end()
    }
  )
})

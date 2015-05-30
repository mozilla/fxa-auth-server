/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('../ptaptest')
var TestServer = require('../test_server')
var Client = require('../client')

var config = require('../../config').root()

TestServer.start(config)
.then(function main(server) {

  test(
    'revoke session token',
    function (t) {
      t.plan(4)

      var email = server.uniqueEmail()
      var password = 'foobar'
      var client = null
      var accessToken = null
      var sessionToken = null

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, { keys: false })
        .then(
          function (x) {
            client = x
            accessToken = server.mockAccessToken({
              user: client.uid,
              scope: ['account']
            })

            sessionToken = client.sessionToken
            t.ok(sessionToken, 'issued session token')
            t.ok(!client.keyFetchToken, 'did not issue key fetch token')

            return client.revokeSessionToken(accessToken)
          }
        )
        .then(
          function (x) {
            t.equal(client.sessionToken, null, 'cleared session token')
            // Try to use the revoked token.
            client.sessionToken = sessionToken
            return client.sessionStatus()
          }
        )
        .then(
          function (status) {
            t.fail('got status with revoked session token')
          },
          function (err) {
            t.equal(err.errno, 110, 'session token is revoked')
          }
        )
    }
  )

  test(
    'revoke destroyed session token',
    function (t) {
      t.plan(4)

      var email = server.uniqueEmail()
      var password = 'foobar'
      var client = null
      var accessToken = null
      var sessionToken = null

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, { keys: false })
        .then(
          function (x) {
            client = x
            accessToken = server.mockAccessToken({
              user: client.uid,
              scope: ['account']
            })

            sessionToken = client.sessionToken
            t.ok(sessionToken, 'issued session token')
            t.ok(!client.keyFetchToken, 'did not issue key fetch token')

            return client.destroySession()
          }
        )
        .then(
          function (x) {
            t.equal(client.sessionToken, null, 'destroyed session token')
            // Try to use the revoked token.
            client.sessionToken = sessionToken
            return client.revokeSessionToken(accessToken)
          }
        )
        .then(
          function (status) {
            t.fail('revoked destroyed session token')
          },
          function (err) {
            t.equal(err.errno, 110, 'session token is destroyed')
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

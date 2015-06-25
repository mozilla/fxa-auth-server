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
    'revoke key fetch token',
    function (t) {
      t.plan(4)

      var email = server.uniqueEmail()
      var password = 'foobar'
      var client = null
      var accessToken = null
      var keyFetchToken = null

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, { keys: true })
        .then(
          function (x) {
            client = x
            accessToken = server.mockAccessToken({
              user: client.uid,
              scope: ['account']
            })

            keyFetchToken = client.keyFetchToken
            t.ok(client.keyFetchToken, 'issued key fetch token')
            t.ok(client.sessionToken, 'issued session token')

            return client.revokeKeyFetchToken(accessToken)
          }
        )
        .then(
          function (x) {
            t.equal(client.keyFetchToken, null, 'cleared key fetch token')
            client.keyFetchToken = keyFetchToken
            return client.keys()
          }
        )
        .then(
          function (keys) {
            t.fail('got keys with revoked key fetch token')
          },
          function (err) {
            t.equal(err.errno, 110, 'key fetch token is revoked')
          }
        )
    }
  )

  test(
    'revoke consumed key fetch token',
    function (t) {
      t.plan(4)

      var email = server.uniqueEmail()
      var password = 'foobar'
      var client = null
      var accessToken = null
      var keyFetchToken = null

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, { keys: true })
        .then(
          function (x) {
            client = x
            accessToken = server.mockAccessToken({
              user: client.uid,
              scope: ['account']
            })

            keyFetchToken = client.keyFetchToken
            t.ok(client.keyFetchToken, 'issued key fetch token')
            t.ok(client.sessionToken, 'issued session token')

            return client.keys()
          }
        )
        .then(
          function (x) {
            t.equal(client.keyFetchToken, null, 'consumed key fetch token')
            client.keyFetchToken = keyFetchToken
            return client.revokeKeyFetchToken(accessToken)
          }
        )
        .then(
          function (keys) {
            t.fail('revoked consumed key fetch token')
          },
          function (err) {
            t.equal(err.errno, 110, 'key fetch token is consumed')
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

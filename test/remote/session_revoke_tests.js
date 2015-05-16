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
    'revoke without key fetch token',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'foobar'
      var client = null
      var sessionToken = null
      var sessionRevokeToken = null
      t.plan(6)
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, { keys: false })
        .then(
          function (x) {
            client = x

            sessionToken = client.sessionToken
            t.ok(sessionToken, 'did not issue session token')

            t.ok(!client.keyFetchToken, 'issued key fetch token')

            sessionRevokeToken = client.sessionRevokeToken
            t.ok(sessionRevokeToken, 'did not issue revocation token')

            return client.revokeSession()
          }
        )
        .then(
          function (x) {
            t.equal(client.sessionToken, null, 'did not clear session token')
            t.equal(client.sessionRevokeToken, null, 'did not clear revocation token')

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
    'revoke with key fetch token',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'foobar'
      var client = null
      var sessionToken = null
      var keyFetchToken = null
      var sessionRevokeToken = null
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, { keys: true })
        .then(
          function (x) {
            client = x

            sessionToken = client.sessionToken
            t.ok(sessionToken, 'did not issue session token')

            keyFetchToken = client.keyFetchToken
            t.ok(keyFetchToken, 'did not issue key fetch token')

            sessionRevokeToken = client.sessionRevokeToken
            t.ok(sessionRevokeToken, 'did not issue revocation token')

            return client.revokeSession()
          }
        )
        .then(
          function (x) {
            t.equal(client.sessionToken, null, 'did not clear session token')
            t.equal(client.keyFetchToken, null, 'did not clear key fetch token')
            t.equal(client.sessionRevokeToken, null, 'did not clear revocation token')

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

            client.sessionToken = sessionToken
            return client.sessionStatus().then(
              function () {
                t.fail('got status with revoked session token')
              },
              function (err) {
                t.equal(err.errno, 110, 'session token is revoked')
              }
            )
          }
        )
    }
  )

  test(
    'revoke consumed tokens',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'foobar'
      var client = null
      var sessionRevokeToken = null
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, { keys: true })
        .then(
          function (x) {
            client = x
            sessionRevokeToken = client.sessionRevokeToken

            // Consume the key fetch token.
            return client.keys()
          }
        )
        .then(
          function (keys) {
            t.ok(Buffer.isBuffer(keys.kA), 'kA exists')
            t.ok(Buffer.isBuffer(keys.wrapKb), 'wrapKb exists')
            t.equal(client.kB.length, 32, 'kB exists, has the right length')

            // Consume the session token.
            return client.destroySession()
          }
        )
        .then(
          function (x) {
            return client.revokeSession()
          }
        )
        .then(
          function (x) {
            t.equal(client.sessionRevokeToken, null, 'did not clear revocation token')

            client.sessionRevokeToken = sessionRevokeToken
            return client.revokeSession()
          }
        )
        .then(
          function (x) {
            t.fail('did not consume revocation token')
          },
          function (err) {
            t.equal(err.errno, 110, 'revocation token is consumed')
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('../ptaptest')
var TestServer = require('../test_server')
var Client = require('../client')

process.env.PASSWORD_CHANGE_TOKEN_TTL = '1'
var config = require('../../config').getProperties()

function fail() { throw new Error() }

TestServer.start(config)
.then(function main(server) {

  test(
    'token expiry',
    function (t) {
      // FYI config.tokenLifetimes.passwordChangeToken = 1
      var email = Math.random() + '@example.com'
      var password = 'ok'
      return Client.create(config.publicUrl, email, password, { preVerified: true })
        .then(
          function (c) {
            return c.changePassword('hello')
          }
        )
        .then(
          fail,
          function (err) {
            t.equal(err.errno, 110, 'invalid token')
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

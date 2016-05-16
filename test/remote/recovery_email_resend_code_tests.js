/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('../ptaptest')
var Client = require('../client')
var TestServer = require('../test_server')

var config = require('../../config').getProperties()

TestServer.start(config)
.then(function main(server) {

  test(
    'sign-in verification resend code',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'something'
      var verifyEmailCode = ''
      var client2 = null
      var options = {
        redirectTo: 'https://sync.'  + config.smtp.redirectDomain,
        service: 'sync',
        resume: 'resumeToken',
        keys: true
      }
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, options)
        .then(
          function (c) {
            // Attempt to login from new location
            return Client.login(config.publicUrl, email, password, server.mailbox, options)
          }
        )
        .then(
          function (c) {
            client2 = c
          }
        )
        .then(
          function () {
            return client2.login(options)
          }
        )
        .then(
          function () {
            return server.mailbox.waitForCode(email)
          }
        )
        .then(
          function (code) {
            verifyEmailCode = code
            return client2.requestVerifyEmail()
          }
        )
        .then(
          function () {
            return server.mailbox.waitForCode(email)
          }
        )
        .then(
          function (code) {
            t.equal(code, verifyEmailCode, 'code equal to verify email code')
            return client2.verifyEmail(code)
          }
        )
        .then(
          function () {
            return client2.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, true, 'account is verified')
            t.equal(status.emailVerified, true, 'account email is verified')
            t.equal(status.sessionVerified, true, 'account session is verified')
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

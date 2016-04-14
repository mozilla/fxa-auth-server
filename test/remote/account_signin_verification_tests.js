/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('../ptaptest')
var TestServer = require('../test_server')
var Client = require('../client')
var config = require('../../config').getProperties()

TestServer.start(config)
.then(function main(server) {

  test(
    'account signin with without keys does not set challenge',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var client = null
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
        .then(
          function (x) {
            client = x
            t.ok(client.authAt, 'authAt was set')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, true, 'account is verified')
          }
        )
        .then(
          function () {
            return client.login({keys:false})
          }
        )
        .then(
          function (response) {
            t.notOk(response.verificationMethod, 'no challenge method set')
            t.notOk(response.verificationReason, 'no challenge reason set')
            t.equal(response.verified, true, 'verified set true')
          }
        )
    }
  )

  test(
    'account signin with keys does set challenge',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var client = null
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
        .then(
          function (x) {
            client = x
            t.ok(client.authAt, 'authAt was set')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, true, 'account is verified')
          }
        )
        .then(
          function () {
            return client.login({keys:true})
          }
        )
        .then(
          function (response) {
            t.equal(response.verificationMethod, 'email', 'challenge method set')
            t.equal(response.verificationReason, 'login', 'challenge reason set')
            t.equal(response.verified, false, 'verified set to false')
          }
        )
    }
  )

  test(
    'account can verify new sign-in from email',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var client = null
      var uid
      var code
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
        .then(
          function (x) {
            client = x
            t.ok(client.authAt, 'authAt was set')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, true, 'new account is verified')
          }
        )
        .then(
          function () {
            return client.login({keys:true})
          }
        )
        .then(
          function (response) {
            t.equal(response.verificationMethod, 'email', 'challenge method set to email')
            t.equal(response.verificationReason, 'login', 'challenge reason set to signin')
            t.equal(response.verified, false, 'verified set to false')
          }
        )
        .then(
          function () {
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function (emailData) {
            uid = emailData.headers['x-uid']
            code = emailData.headers['x-verify-code']
            t.equal(emailData.subject, 'Confirm new sign-in to Firefox')
            t.ok(uid, 'sent uid')
            t.ok(code, 'sent verify code')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, false, 'account is not verified, unverified sign-in')
          }
        )
        .then(
          function () {
            return client.verifyEmail(code)
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, true, 'account is verified confirming email')
          }
        )
    }
  )

  test(
    'Unverified account becomes verified from sign-in verification',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var client = null
      var uid
      var code
      return Client.create(config.publicUrl, email, password)
        .then(
          function (x) {
            client = x
            t.ok(client.authAt, 'authAt was set')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, false, 'new account is unverified')
            t.equal(client.emailVerified, false, 'new account email unverified')
          }
        )
        .then(
          function () {
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function (emailData) {
            t.equal(emailData.subject, 'Verify your Firefox Account')
          }
        )
        .then(
          function () {
            return client.login({keys:true})
          }
        )
        .then(
          function () {
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function (emailData) {
            uid = emailData.headers['x-uid']
            code = emailData.headers['x-verify-code']
            t.equal(emailData.subject, 'Confirm new sign-in to Firefox')
            t.ok(uid, 'sent uid')
            t.ok(code, 'sent verify code')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, false, 'account is not verified, unverified sign-in')
          }
        )
        .then(
          function () {
            return client.verifyEmail(code)
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, true, 'account is verified by confirming email')
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('../ptaptest')
var url = require('url')
var Client = require('../client')
var TestServer = require('../test_server')


var config = require('../../config').getProperties()

TestServer.start(config)
.then(function main(server) {

  test(
    'create account verify with incorrect code',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var client = null
      return Client.create(config.publicUrl, email, password)
        .then(
          function (x) {
            client = x
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, false, 'new account is not verified')
          }
        )
        .then(
          function () {
            return client.verifyEmail('00000000000000000000000000000000')
          }
        )
        .then(
          function () {
            t.fail('verified email with bad code')
          },
          function (err) {
            t.equal(err.message.toString(), 'Invalid verification code', 'bad attempt')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, false, 'account not verified')
          }
        )
    }
  )

  test(
    'verification email link',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'something'
      var client = null // eslint-disable-line no-unused-vars
      var options = {
        redirectTo: 'https://sync.'  + config.smtp.redirectDomain,
        service: 'sync'
      }
      return Client.create(config.publicUrl, email, password, options)
        .then(
          function (c) {
            client = c
          }
        )
        .then(
          function () {
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function (emailData) {
            var link = emailData.headers['x-link']
            var query = url.parse(link, true).query
            t.ok(query.uid, 'uid is in link')
            t.ok(query.code, 'code is in link')
            t.equal(query.redirectTo, options.redirectTo, 'redirectTo is in link')
            t.equal(query.service, options.service, 'service is in link')
          }
        )
    }
  )

  test(
    'sign-in verification email link',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'something'
      var client = null
      var options = {
        redirectTo: 'https://sync.'  + config.smtp.redirectDomain,
        service: 'sync',
        resume: 'resumeToken',
        keys: true
      }
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, options)
        .then(
          function (c) {
            client = c
          }
        )
        .then(
          function () {
            return client.login(options)
          }
        )
        .then(
          function () {
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function (emailData) {
            var link = emailData.headers['x-link']
            var query = url.parse(link, true).query
            t.ok(query.uid, 'uid is in link')
            t.ok(query.code, 'code is in link')
            t.equal(query.service, options.service, 'service is in link')
            t.equal(query.resume, options.resume, 'resume is in link')
            t.equal(emailData.subject, 'Confirm new sign-in to Firefox')
          }
        )
    }
  )

  test(
    'sign-in verification from different client',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'something'
      var client = null
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
            client = c
          }
        )
        .then(
          function () {
            return client.login(options)
          }
        )
        .then(
          function () {
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function (emailData) {
            var link = emailData.headers['x-link']
            var query = url.parse(link, true).query
            t.ok(query.uid, 'uid is in link')
            t.ok(query.code, 'code is in link')
            t.equal(query.service, options.service, 'service is in link')
            t.equal(query.resume, options.resume, 'resume is in link')
            t.equal(emailData.subject, 'Confirm new sign-in to Firefox')
          }
        )
        .then(
          function () {
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
            // Verify account from client2
            return client2.verifyEmail(code, options)
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
            t.equal(status.sessionVerified, true, 'account session is  verified')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            t.equal(status.verified, false, 'account is not verified')
            t.equal(status.emailVerified, true, 'account email is verified')
            t.equal(status.sessionVerified, false, 'account session is not verified')
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

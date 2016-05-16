/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var Client = require('../client')
var config = require('../../config').getProperties()
var test = require('../ptaptest')
var TestServer = require('../test_server')
var url = require('url')

TestServer.start(config)
.then(function main(server) {

  test(
    'password change',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var newPassword = 'foobar'
      var kB, kA, client, firstAuthPW, originalSessionTokenId

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
            originalSessionTokenId = client.sessionToken
            firstAuthPW = x.authPW.toString('hex')
            return client.keys()
          }
        )
        .then(
          function (keys) {
            kB = keys.kB
            kA = keys.kA
          }
        )
        .then(
          function () {
            return client.changePassword(newPassword)
          }
        )
        .then(
          function (response) {
            t.notEqual(response.sessionToken, originalSessionTokenId, 'session token has changed')
            t.ok(response.keyFetchToken, 'key fetch token returned')
            t.notEqual(client.authPW.toString('hex'), firstAuthPW, 'password has changed')
          }
        )
        .then(
          function () {
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function (emailData) {
            var subject = emailData.headers['subject']
            t.equal(subject, 'Your Firefox Account password has been changed', 'password email subject set correctly')
            var link = emailData.headers['x-link']
            var query = url.parse(link, true).query
            t.ok(query.email, 'email is in the link')
          }
        )
        .then(
          function () {
            return Client.login(config.publicUrl, email, newPassword, {keys:true})
          }
        )
        .then(
          function (x) {
            client = x
            return client.keys()
          }
        )
        .then(
          function (keys) {
            t.deepEqual(keys.kB, kB, 'kB is preserved')
            t.deepEqual(keys.kA, kA, 'kA is preserved')
          }
        )
    }
  )

  test(
    'wrong password on change start',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var client = null
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
            return client.keys()
          }
        )
        .then(
          function () {
            client.authPW = Buffer('0000000000000000000000000000000000000000000000000000000000000000', 'hex')
            return client.changePassword('foobar')
          }
        )
        .then(
          t.fail,
          function (err) {
            t.equal(err.errno, 103, 'invalid password')
          }
        )
    }
  )

  test(
    'change password on locked account',
    function (t) {
      var email = server.uniqueEmail()
      var password = 'wibble'
      var client
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (c) {
            client = c
            return client.lockAccount()
          }
        )
        .then(
          function () {
            return client.changePassword('foobar')
          }
        )
        .then(
          t.fail,
          function (error) {
            t.equal(error.code, 400)
            t.equal(error.error, 'Bad Request')
            t.equal(error.errno, 121)
            t.equal(error.message, 'Account is locked')
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

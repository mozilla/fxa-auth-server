/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var path = require('path')
var test = require('../ptaptest')
var TestServer = require('../test_server')
var Client = require('../client')

process.env.CONFIG_FILES = path.join(__dirname, '../config/mock_oauth.json')
var config = require('../../config').root()

function makeMockOAuthHeader(opts) {
  var token = new Buffer(JSON.stringify(opts)).toString('hex')
  return 'Bearer ' + token
}

TestServer.start(config)
.then(function main(server) {

  test(
    'account status authenticated with oauth returns account info',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeMockOAuthHeader({
              user: c.uid,
              scopes: ['profile']
            })
            return c.api.accountStatus(c.uid)
          }
        )
        .then(
          function (response) {
            t.ok(response.exists, 'account exists')
            t.ok(response.email, 'email address is returned')
            t.equal(response.locale, 'en-US', 'locale is returned')
          }
        )
    }
  )

  test(
    'account status authenticated with oauth with no uid returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeMockOAuthHeader({
              user: c.uid,
              scopes: ['profile']
            })
            return c.api.accountStatus()
          }
        )
        .then(
          function () {
            t.fail('should get an error')
          },
          function (e) {
            t.equal(e.code, 400, 'correct error status code')
            t.equal(e.errno, 108, 'correct errno')
          }
        )
    }
  )

  test(
    'account status authenticated with invalid oauth token returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeMockOAuthHeader({
              code: 401,
              errno: 108
            })
            return c.api.accountStatus(c.uid)
          }
        )
        .then(
          function () {
            t.fail('should get an error')
          },
          function (e) {
            t.equal(e.code, 401, 'correct error status code')
            t.equal(e.errno, 110, 'correct errno')
          }
        )
    }
  )

  test(
    'account status authenticated with oauth for wrong uid returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeMockOAuthHeader({
              user: 'abcdef123456',
              scopes: ['profile']
            })
            return c.api.accountStatus(c.uid)
          }
        )
        .then(
          function () {
            t.fail('should get an error')
          },
          function (e) {
            t.equal(e.code, 401, 'correct error status code')
            t.equal(e.errno, 110, 'correct errno')
          }
        )
    }
  )

  test(
    'account status authenticated with oauth for wrong scope returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeMockOAuthHeader({
              user: c.uid,
              scopes: ['readinglist', 'payments']
            })
            return c.api.accountStatus(c.uid)
          }
        )
        .then(
          function () {
            t.fail('should get an error')
          },
          function (e) {
            t.equal(e.code, 401, 'correct error status code')
            t.equal(e.errno, 110, 'correct errno')
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

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var path = require('path')
var fs = require('fs')
var crypto = require('crypto')
var test = require('../ptaptest')
var TestServer = require('../test_server')
var Client = require('../client')
var bidcrypto = require('browserid-crypto')
require('browserid-crypto/lib/algs/rs')
var hex2b64urlencode = require('browserid-crypto/lib/utils').hex2b64urlencode
var b64 = require('browserid-crypto/lib/utils').base64urlencode

process.env.CONFIG_FILES = path.join(__dirname, '../config/preverify_secret.json')
var config = require('../../config').root()
var secretKey = bidcrypto.loadSecretKey(fs.readFileSync(config.secretKeyFile))

var error = require('../../error')
var Hawt = require('../../server/hawt-auth')(error, config)

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function makeAuthzHeader(opts) {
  if (!opts) {
    opts = {}
  }
  if (!opts.method) {
    opts.method = 'GET'
  }
  var header = {
    alg: 'RS256',
    jku: opts.jku || config.publicUrl + '/.well-known/public-keys',
    kid: opts.kid || 'dev-1'
  }
  header = b64(JSON.stringify(header))
  var claims =  {
    iss: opts.iss || 'localhost',
    aud: opts.aud || config.domain,
    exp: opts.exp || nowSeconds() + 10,
    iat: opts.iat || nowSeconds() - 10,
    nce: opts.nce || crypto.randomBytes(8).toString('base64'),
    qsh: opts.qsh,
    psh: opts.psh
  }
  if (!claims.qsh) {
    claims.qsh = Hawt._calculateQueryHash(opts, claims)
  }
  claims = b64(JSON.stringify(claims))
  var sig = opts.sig || secretKey.sign(header + '.' + claims)
  return 'Hawt ' + header + '.' + claims + '.' + hex2b64urlencode(sig)
}

TestServer.start(config)
.then(function main(server) {

  test(
    'account status authenticated with JWT returns account info',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeAuthzHeader({
              url: '/v1/account/status?uid=' + c.uid
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
    'account status authenticated with JWT with no uid returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeAuthzHeader({
              url: '/v1/account/status'
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
    'account status authenticated with invalid JWT signature returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeAuthzHeader({
              url: '/v1/account/status?uid=' + c.uid,
              sig: '00000000'
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
    'account status authenticated with expired JWT returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeAuthzHeader({
              url: '/v1/account/status?uid=' + c.uid,
              exp: nowSeconds() - 100
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
    'account status authenticated with JWT for wrong path returns an error',
    function (t) {
      return Client.create(config.publicUrl, server.uniqueEmail(), 'password', { lang: 'en-US' })
        .then(
          function (c) {
            c.api.headers.Authorization = makeAuthzHeader({
              url: '/v1/account/keys',
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

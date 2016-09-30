/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('tap').test
const Client = require('../client')()
var TestServer = require('../test_server')
var jwtool = require('fxa-jwtool')

var config = require('../../config').getProperties()
process.env.SIGNIN_CONFIRMATION_ENABLED = false

var pubSigKey = jwtool.JWK.fromFile(config.publicKeyFile)

TestServer.start(config)
.then(function main(server) {

  var email1 = server.uniqueEmail()

  test(
    'Create account flow',
    function (t) {
      var email = email1
      var password = 'allyourbasearebelongtous'
      var client = null
      var publicKey = {
        'algorithm': 'RS',
        'n': '4759385967235610503571494339196749614544606692567785790953934768202714280652973091341316862993582789079872007974809511698859885077002492642203267408776123',
        'e': '65537'
      }
      var duration = 1000 * 60 * 60 * 24 // 24 hours
      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
            return client.keys()
          }
        )
        .then(
          function (keys) {
            t.ok(Buffer.isBuffer(keys.kA), 'kA exists')
            t.ok(Buffer.isBuffer(keys.wrapKb), 'wrapKb exists')
            t.ok(Buffer.isBuffer(keys.kB), 'kB exists')
            t.equal(client.kB.length, 32, 'kB exists, has the right length')
          }
        )
        .then(
          function () {
            return client.sign(publicKey, duration)
          }
        )
        .then(
          function (cert) {
            t.equal(typeof(cert), 'string', 'cert exists')
            var payload = jwtool.verify(cert, pubSigKey.pem)
            t.equal(payload.principal.email.split('@')[0], client.uid, 'cert has correct uid')
          }
        )
    }
  )

  test(
    'Login flow',
    function (t) {
      var email = email1
      var password = 'allyourbasearebelongtous'
      var client = null
      var publicKey = {
        'algorithm': 'RS',
        'n': '4759385967235610503571494339196749614544606692567785790953934768202714280652973091341316862993582789079872007974809511698859885077002492642203267408776123',
        'e': '65537'
      }
      var duration = 1000 * 60 * 60 * 24 // 24 hours
      return Client.login(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
            t.ok(client.authAt, 'authAt was set')
            t.ok(client.uid, 'got a uid')
            return client.keys()
          }
        )
        .then(
          function (keys) {
            t.ok(Buffer.isBuffer(keys.kA), 'kA exists')
            t.ok(Buffer.isBuffer(keys.wrapKb), 'wrapKb exists')
            t.ok(Buffer.isBuffer(keys.kB), 'kB exists')
            t.equal(client.kB.length, 32, 'kB exists, has the right length')
          }
        )
        .then(
          function () {
            return client.sign(publicKey, duration)
          }
        )
        .then(
          function (cert) {
            t.equal(typeof(cert), 'string', 'cert exists')
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

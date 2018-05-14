/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const Client = require('../client')()
var config = require('../../config').getProperties()
var TestServer = require('../test_server')
var url = require('url')
const pbkdf2 = require('../../lib/crypto/pbkdf2')
const hkdf = require('../../lib/crypto/hkdf')
const butil = require('../../lib/crypto/butil')

var tokens = require('../../lib/tokens')({ trace: function() {}})
function getSessionTokenId(sessionTokenHex) {
  return tokens.SessionToken.fromHex(sessionTokenHex)
    .then(
      function (token) {
        return token.id
      }
    )
}

describe('remote password change - legacy', function() {
  this.timeout(15000)
  let server
  before(() => {
    config.securityHistory.ipProfiling.allowedRecency = 0
    config.signinConfirmation.skipForNewAccounts.enabled = false
    return TestServer.start(config)
      .then(s => {
        server = s
      })
  })

  it(
    'password change, with unverified session',
    () => {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var newPassword = 'foobar'
      var kB, kA, client, firstAuthPW, originalSessionToken

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
            originalSessionToken = client.sessionToken
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
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            assert.equal(status.verified, true, 'account is verified')
          }
        )
        .then(
          function () {
            // Login from different location to created unverified session
            return Client.login(config.publicUrl, email, password, {keys:true})
          }
        )
        .then(
          function (c) {
            client = c
          }
        )
        .then(
          function () {
            // Ignore confirm login email
            return server.mailbox.waitForEmail(email)
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            // Verify correct status
            assert.equal(status.verified, false, 'account is unverified')
            assert.equal(status.emailVerified, true, 'account email is verified')
            assert.equal(status.sessionVerified, false, 'account session is unverified')
          }
        )
        .then(
          function () {
            return getSessionTokenId(client.sessionToken)
          }
        )
        .then(
          function (sessionTokenId) {
            return client.changePassword(newPassword, undefined, sessionTokenId)
          }
        )
        .then(
          function (response) {
            // Verify correct change password response
            assert.notEqual(response.sessionToken, originalSessionToken, 'session token has changed')
            assert.ok(response.keyFetchToken, 'key fetch token returned')
            assert.notEqual(client.authPW.toString('hex'), firstAuthPW, 'password has changed')
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
            assert.equal(subject, 'Your Firefox Account password has been changed', 'password email subject set correctly')
            var link = emailData.headers['x-link']
            var query = url.parse(link, true).query
            assert.ok(query.email, 'email is in the link')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            // Verify correct status
            assert.equal(status.verified, false, 'account is unverified')
            assert.equal(status.emailVerified, true, 'account email is verified')
            assert.equal(status.sessionVerified, false, 'account session is unverified')
          }
        )
        .then(
          function () {
            return Client.loginAndVerify(config.publicUrl, email, newPassword, server.mailbox, {keys:true})
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
            assert.deepEqual(keys.kB, kB, 'kB is preserved')
            assert.deepEqual(keys.kA, kA, 'kA is preserved')
          }
        )
    }
  )

  it(
    'password change, with verified session',
    () => {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var newPassword = 'foobar'
      var kB, kA, client, firstAuthPW, originalSessionToken

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
            originalSessionToken = client.sessionToken
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
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            assert.equal(status.verified, true, 'account is verified')
          }
        )
        .then(
          function () {
            return getSessionTokenId(client.sessionToken)
          }
        )
        .then(
          function (sessionTokenId) {
            return client.changePassword(newPassword, undefined, sessionTokenId)
          }
        )
        .then(
          function (response) {
            assert.notEqual(response.sessionToken, originalSessionToken, 'session token has changed')
            assert.ok(response.keyFetchToken, 'key fetch token returned')
            assert.notEqual(client.authPW.toString('hex'), firstAuthPW, 'password has changed')
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
            assert.equal(subject, 'Your Firefox Account password has been changed', 'password email subject set correctly')
            var link = emailData.headers['x-link']
            var query = url.parse(link, true).query
            assert.ok(query.email, 'email is in the link')
            assert.equal(emailData.html.indexOf('IP address') > -1, true, 'contains ip location data')
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            assert.equal(status.verified, true, 'account is verified')
          }
        )
        .then(
          function () {
            return Client.loginAndVerify(config.publicUrl, email, newPassword, server.mailbox, {keys:true})
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
            assert.deepEqual(keys.kB, kB, 'kB is preserved')
            assert.deepEqual(keys.kA, kA, 'kA is preserved')
          }
        )
    }
  )

  it(
    'password change, with raw session data rather than session token id, return invalid token error',
    () => {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var newPassword = 'foobar'
      var client

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
            return client.keys()
          }
        )
        .then(
          function () {
            return client.emailStatus()
          }
        )
        .then(
          function (status) {
            assert.equal(status.verified, true, 'account is verified')
          }
        )
        .then(
          function () {
            return client.changePassword(newPassword, undefined, client.sessionToken)
          }
        )
        .then(
          function () {
            assert(false)
          },
          function (err) {
            assert.equal(err.errno, 110, 'Invalid token error')
            assert.equal(err.message, 'The authentication token could not be found')
          }
        )
    }
  )

  it(
    'password change w/o sessionToken',
    () => {
      var email = server.uniqueEmail()
      var password = 'allyourbasearebelongtous'
      var newPassword = 'foobar'
      var kB, kA, client, firstAuthPW

      return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys:true})
        .then(
          function (x) {
            client = x
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
            assert(! response.sessionToken, 'no session token returned')
            assert(! response.keyFetchToken, 'no key fetch token returned')
            assert.notEqual(client.authPW.toString('hex'), firstAuthPW, 'password has changed')
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
            assert.equal(subject, 'Your Firefox Account password has been changed', 'password email subject set correctly')
            var link = emailData.headers['x-link']
            var query = url.parse(link, true).query
            assert.ok(query.email, 'email is in the link')
          }
        )
        .then(
          function () {
            return Client.loginAndVerify(config.publicUrl, email, newPassword, server.mailbox, {keys:true})
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
            assert.deepEqual(keys.kB, kB, 'kB is preserved')
            assert.deepEqual(keys.kA, kA, 'kA is preserved')
          }
        )
    }
  )

  it(
    'wrong password on change start',
    () => {
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
            client.authPW = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex')
            return client.changePassword('foobar')
          }
        )
        .then(
          () => assert(false),
          function (err) {
            assert.equal(err.errno, 103, 'invalid password')
          }
        )
    }
  )

  after(() => {
    return TestServer.stop(server)
  })
})

describe('remote password change', function() {
  const password = 'oldpassword'
  const newPassword = 'newpassword'
  let kB, kA, client, email

  this.timeout(15000)
  let server
  before(() => {
    config.securityHistory.ipProfiling.allowedRecency = 0
    config.signinConfirmation.skipForNewAccounts.enabled = false
    return TestServer.start(config)
      .then(s => {
        server = s
      })
  })

  function getAuthCredentials(password, email, kB) {
    return pbkdf2.derive(Buffer.from(password), hkdf.KWE('quickStretch', email), 1000, 32)
      .then((stretch) => {
        return Promise.all([hkdf(stretch, 'authPW', null, 32), hkdf(stretch, 'unwrapBKey', null, 32)])
      })
      .spread((authPW, unwrapKb) => {
        const wrapKb = butil.xorBuffers(kB, unwrapKb).toString('hex')
        return {
          authPW,
          wrapKb
        }
      })
  }

  beforeEach(() => {
    email = server.uniqueEmail()
    return Client.createAndVerify(config.publicUrl, email, password, server.mailbox, {keys: true})
      .then((x) => {
        client = x
        // First step retrieve client keys
        return client.keys()
      })
      .then((keys) => {
        kB = keys.kB
        kA = keys.kA
      })
      .then(() => {
        return client.emailStatus()
      })
      .then((status) => assert.equal(status.verified, true, 'account is verified'))
  })

  it('password change, with verified session', () => {
    return getAuthCredentials(newPassword, email, kB)
      .then((creds) => {
        return client.changePasswordWithSessionToken(creds.authPW, creds.wrapKb)
      })
      .then(() => {
        return server.mailbox.waitForEmail(email)
      })
      .then((emailData) => {
        const subject = emailData.headers['subject']
        assert.equal(subject, 'Your Firefox Account password has been changed', 'password email subject set correctly')
        const link = emailData.headers['x-link']
        const query = url.parse(link, true).query
        assert.ok(query.email, 'email is in the link')
      })
      .then(() => {
        return Client.loginAndVerify(config.publicUrl, email, newPassword, server.mailbox, {keys:true})
      })
      .then((result) => {
        client = result
        return client.keys()
      })
      .then((keys) => {
        assert.deepEqual(keys.kB, kB, 'kB is preserved')
        assert.deepEqual(keys.kA, kA, 'kA is preserved')
      })
  })

  it('password change, with unverified session', () => {
    // Create a new unverified session
    return Client.login(config.publicUrl, email, password, server.mailbox)
      .then((x) => {
        client = x
        return client.emailStatus()
      })
      .then((status) => {
        assert.equal(status.verified, true, 'account is verified')
        assert.equal(status.sessionVerified, false, 'session is unverified')
        return getAuthCredentials(newPassword, email, kB)
      })
      .then((creds) => {
        return client.changePasswordWithSessionToken(creds.authPW, creds.wrapKb)
      })
      .then(() => {
        return server.mailbox.waitForEmail(email)
      })
      .then((emailData) => {
        const subject = emailData.headers['subject']
        assert.equal(subject, 'Your Firefox Account password has been changed', 'password email subject set correctly')
        const link = emailData.headers['x-link']
        const query = url.parse(link, true).query
        assert.ok(query.email, 'email is in the link')

        // Login into a new verified session (can request keys), to ensure that kB key is the same
        return Client.loginAndVerify(config.publicUrl, email, newPassword, server.mailbox, {keys:true})
      })
      .then((result) => {
        client = result
        return client.keys()
      })
      .then((keys) => {
        assert.deepEqual(keys.kB, kB, 'kB is preserved')
        assert.deepEqual(keys.kA, kA, 'kA is preserved')
      })
  })

  describe('with totp', () => {
    let authenticator
    beforeEach(() => {
      email = server.uniqueEmail()
      return Client.createAndVerifyAndTOTP(config.publicUrl, email, password, server.mailbox, {keys: true})
        .then((x) => {
          client = x
          authenticator = client.totpAuthenticator
          return client.keys()
        })
        .then((keys) => {
          kB = keys.kB
          kA = keys.kA
        })
    })

    it('password change, verified session', () => {
      return client.verifyTotpCode(authenticator.generate())
        .then(() => {
          return getAuthCredentials(newPassword, email, kB)
        })
        .then((creds) => client.changePasswordWithSessionToken(creds.authPW, creds.wrapKb))
        .then(() => server.mailbox.waitForEmail(email))
        .then((emailData) => {
          assert.equal(emailData.headers['x-template-name'], 'passwordChangedEmail')
          return Client.login(config.publicUrl, email, newPassword, {keys: true})
        })
        .then((x) => {
          // verify new client with totp code
          client = x
          return client.verifyTotpCode(authenticator.generate())
        })
        .then((res) => {
          assert.equal(res.success, true, 'verified totp session')
          // new client can retrieve keys with kb preserved
          return client.keys()
        })
        .then((keys) => {
          assert.deepEqual(keys.kB, kB, 'kB is preserved')
          assert.deepEqual(keys.kA, kA, 'kA is preserved')
        })
    })

    it('password change, unverified session', () => {
      // new unverified client
      return Client.login(config.publicUrl, email, password, {keys: true})
        .then((x) => {
          client = x
          return getAuthCredentials(newPassword, email, kB)
        })
        // Fails to change password when session has not been verified
        .then((creds) => client.changePasswordWithSessionToken(creds.authPW, creds.wrapKb))
        .then(assert.fail, (err) => assert.equal(err.errno, 138, 'unverified session'))
    })
  })

  after(() => {
    return TestServer.stop(server)
  })
})


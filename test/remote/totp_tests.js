/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const config = require('../../config').getProperties()
const TestServer = require('../test_server')
const Client = require('../client')()
const otplib = require('otplib')

describe('remote totp', function () {
  let server, client, email, totpToken
  const password = 'pssssst'

  this.timeout(10000)

  otplib.authenticator.options = {
    encoding: 'hex',
    step: config.step
  }

  const sharedSecret = otplib.authenticator.generateSecret()

  before(() => {
    config.totp.sharedSecret = sharedSecret
    otplib.authenticator.options = {
      secret: sharedSecret
    }
    return TestServer.start(config)
      .then(s => {
        server = s
      })
  })

  beforeEach(() => {
    email = server.uniqueEmail()
    return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
      .then((x) => {
        client = x
        assert.ok(client.authAt, 'authAt was set')
        return client.createTotpToken()
          .then((result) => totpToken = result)
      })
  })

  it('should create totp token', () => {
    assert.ok(totpToken)
    assert.ok(totpToken.qrCodeUrl)
  })

  it('should fail to create second totp token for same user', () => {
    return client.createTotpToken()
      .then(assert.fail, (err) => {
        assert.equal(err.code, 400, 'correct error code')
        assert.equal(err.errno, 154, 'correct error errno')
      })
  })

  it('should delete totp token', () => {
    email = server.uniqueEmail()
    return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
      .then((x) => {
        client = x
        assert.ok(client.authAt, 'authAt was set')
        return client.deleteTotpToken()
          .then(assert.fail, (err) => {
            assert.equal(err.code, 400, 'correct error code')
            assert.equal(err.errno, 155, 'correct error errno')
          })
      })
  })

  it('should fail to delete unknown totp token', () => {
    return client.deleteTotpToken()
      .then((result) => {
        assert.ok(result, 'delete totp token successfully')

        // Can create a new token
        return client.createTotpToken()
          .then((result) => {
            assert.ok(result)
          })
      })
  })

  it('should fail to verify totp code', () => {
    return client.checkTotpCode('wroonn')
      .then((result) => {
        assert.equal(result.success, false, 'failed')
      })
  })

  it('should fail to verify totp code that does not have totp token', () => {
    email = server.uniqueEmail()
    return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
      .then((x) => {
        client = x
        assert.ok(client.authAt, 'authAt was set')
        return client.checkTotpCode('wronng')
          .then(assert.fail, (err) => {
            assert.equal(err.code, 400, 'correct error code')
            assert.equal(err.errno, 155, 'correct error errno')
          })
      })
  })

  it('should verify totp code', () => {
    const code = otplib.authenticator.generate()
    return client.checkTotpCode(code)
      .then((response) => {
        assert.equal(response.success, true, 'totp codes match')
      })
  })

  after(() => {
    return TestServer.stop(server)
  })
})


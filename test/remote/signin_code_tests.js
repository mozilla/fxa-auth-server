/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const TestServer = require('../test_server')
const Client = require('../client')()
const error = require('../../lib/error')
const config = require('../../config').getProperties()
const crypto = require('crypto')

describe('remote signinCodes', () => {
  let server

  before(() => {
    return TestServer.start(config)
      .then(result => {
        server = result
      })
  })

  it('POST /signinCodes/consume invalid code', () => {
    return Client.create(config.publicUrl, server.uniqueEmail(), 'wibble')
      .then(client => {
        return client.consumeSigninCode(crypto.randomBytes(config.signinCodeSize), {
          metricsContext: {
            flowId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            flowBeginTime: Date.now()
          }
        })
          .then(result => assert.fail('/signinCodes/consume should fail'))
          .catch(err => {
            assert.ok(err)
            assert.equal(err.code, 400)
            assert.equal(err.errno, error.ERRNO.INVALID_SIGNIN_CODE)
            assert.equal(err.message, 'Invalid signin code')
          })
      })
  })

  after(() => {
    return TestServer.stop(server)
  })
})


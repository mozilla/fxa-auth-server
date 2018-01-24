/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const sinon = require('sinon')

const P = require('../../../lib/promise')
const mockLog = require('../../mocks').mockLog()
const config = {}
const Password = require('../../../lib/crypto/password')(mockLog, config)
const error = require('../../../lib/error')
const butil = require('../../../lib/crypto/butil')

const MockCustoms = {
  flag: sinon.spy(function (clientAddress, emailRecord) {
    return P.resolve({})
  })
}

const MockDB = {
  checkPassword: function (uid) {
    return uid === 'correct_password'
  }
}

const CLIENT_ADDRESS = '10.0.0.1'

const signinUtils = require('../../../lib/routes/utils/signin')(mockLog, config, MockCustoms, MockDB, {})

describe('checkPassword', () => {
  it(
    'should check with correct password',
    () => {
      const authPW = Buffer.from('aaaaaaaaaaaaaaaa')
      const emailRecord = {
        uid: 'correct_password',
        verifyHash: null,
        verifierVersion: 0,
        authSalt: Buffer.from('bbbbbbbbbbbbbbbb')
      }
      MockCustoms.flag.reset()

      const password = new Password(
          authPW, emailRecord.authSalt, emailRecord.verifierVersion)

      return password.verifyHash()
        .then(hash => {
          emailRecord.verifyHash = hash
          return signinUtils.checkPassword(emailRecord, password, CLIENT_ADDRESS)
        })
        .then(matches => {
          assert.ok(matches, 'password matches, checkPassword returns true')
          assert.equal(MockCustoms.flag.callCount, 0, 'customs.flag was not called')
        })
    }
  )

  it(
    'should return false when check with incorrect password',
    () => {
      const authPW = Buffer.from('aaaaaaaaaaaaaaaa')
      const emailRecord = {
        uid: 'uid',
        email: 'test@example.com',
        verifyHash: null,
        verifierVersion: 0,
        authSalt: Buffer.from('bbbbbbbbbbbbbbbb')
      }
      MockCustoms.flag.reset()

      const password = new Password(
              authPW, emailRecord.authSalt, emailRecord.verifierVersion)

      return password.verifyHash()
        .then(hash => {
          emailRecord.verifyHash = hash
          const incorrectAuthPW = Buffer.from('cccccccccccccccc')
          const incorrectPassword = new Password(
              incorrectAuthPW, emailRecord.authSalt, emailRecord.verifierVersion)
          return signinUtils.checkPassword(emailRecord, incorrectPassword, CLIENT_ADDRESS)
        })
        .then(match => {
          assert.equal(!! match, false, 'password does not match, checkPassword returns false')
          assert.equal(MockCustoms.flag.callCount, 1, 'customs.flag was called')
          assert.equal(MockCustoms.flag.getCall(0).args[0], CLIENT_ADDRESS, 'customs.flag was called with client ip')
          assert.deepEqual(MockCustoms.flag.getCall(0).args[1], {
            email: emailRecord.email,
            errno: error.ERRNO.INCORRECT_PASSWORD
          }, 'customs.flag was called with correct event details')
        })
    }
  )

  it(
    'should error when check with account whose password must be reset',
    () => {
      const emailRecord = {
        uid: 'must_reset',
        email: 'test@example.com',
        verifyHash: null,
        verifierVersion: 0,
        authSalt: butil.ONES
      }
      MockCustoms.flag.reset()

      const incorrectAuthPW = Buffer.from('cccccccccccccccccccccccccccccccc')
      const incorrectPassword = new Password(
          incorrectAuthPW, emailRecord.authSalt, emailRecord.verifierVersion)

      return signinUtils.checkPassword(emailRecord, incorrectPassword, CLIENT_ADDRESS)
        .then(
          (match) => { assert(false, 'password check should not have succeeded') },
          (err) => {
            assert.equal(err.errno, error.ERRNO.ACCOUNT_RESET, 'an ACCOUNT_RESET error was thrown')
            assert.equal(MockCustoms.flag.callCount, 1, 'customs.flag was called')
            assert.equal(MockCustoms.flag.getCall(0).args[0], CLIENT_ADDRESS, 'customs.flag was called with client ip')
            assert.deepEqual(MockCustoms.flag.getCall(0).args[1], {
              email: emailRecord.email,
              errno: error.ERRNO.ACCOUNT_RESET
            }, 'customs.flag was called with correct event details')
          }
        )
    }
  )
})

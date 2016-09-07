/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('tap').test
var mocks = require('../../mocks')
var getRoute = require('../../routes_helpers').getRoute
var makeRoutes = require('../../routes_helpers').makeAccountRoutes
var runTest = require('../../routes_helpers').runTest

var P = require('../../../lib/promise')
var uuid = require('uuid')
var crypto = require('crypto')
var error = require('../../../lib/error')

var TEST_EMAIL = 'foo@gmail.com'
var TEST_EMAIL_INVALID = 'example@dotless-domain'

test('/recovery_email/status', function (t) {
  t.plan(2)
  var config = {
    signinConfirmation: {}
  }
  var mockDB = mocks.mockDB()
  var pushCalled
  var mockLog = mocks.mockLog({
    increment: function (name) {
      if (name === 'recovery_email_reason.push') {
        pushCalled = true
      }
    }
  })
  var accountRoutes = makeRoutes({
    config: config,
    db: mockDB,
    log: mockLog
  })
  var route = getRoute(accountRoutes, '/recovery_email/status')

  t.test('sign-in confirmation disabled', function (t) {
    t.plan(2)
    config.signinConfirmation.enabled = false

    t.test('invalid email', function (t) {
      t.plan(2)
      var mockRequest = mocks.mockRequest({
        credentials: {
          email: TEST_EMAIL_INVALID
        }
      })

      t.test('unverified account', function (t) {
        mockRequest.auth.credentials.emailVerified = false

        return runTest(route, mockRequest, function (response) {
          t.equal(mockDB.deleteAccount.callCount, 1)
          t.equal(mockDB.deleteAccount.firstCall.args[0].email, TEST_EMAIL_INVALID)
          t.equal(response.errno, error.ERRNO.INVALID_TOKEN)
        })
        .then(function () {
          mockDB.deleteAccount.reset()
        })
      })

      t.test('verified account', function (t) {
        mockRequest.auth.credentials.uid = uuid.v4('binary').toString('hex')
        mockRequest.auth.credentials.emailVerified = true
        mockRequest.auth.credentials.tokenVerified = true

        return runTest(route, mockRequest, function (response) {
          t.equal(mockDB.deleteAccount.callCount, 0)
          t.deepEqual(response, {
            email: TEST_EMAIL_INVALID,
            verified: true,
            emailVerified: true,
            sessionVerified: true
          })
        })
      })
    })

    t.test('valid email, verified account', function (t) {
      pushCalled = false
      var mockRequest = mocks.mockRequest({
        credentials: {
          uid: uuid.v4('binary').toString('hex'),
          email: TEST_EMAIL,
          emailVerified: true,
          tokenVerified: true
        },
        query: {
          reason: 'push'
        }
      })

      return runTest(route, mockRequest, function (response) {
        t.equal(pushCalled, true)

        t.deepEqual(response, {
          email: TEST_EMAIL,
          verified: true,
          emailVerified: true,
          sessionVerified: true
        })
      })
    })
  })

  t.test('sign-in confirmation enabled', function (t) {
    t.plan(3)
    config.signinConfirmation.enabled = true
    config.signinConfirmation.sample_rate = 1
    var mockRequest = mocks.mockRequest({
      credentials: {
        uid: uuid.v4('binary').toString('hex'),
        email: TEST_EMAIL
      }
    })

    t.test('verified account, verified session', function (t) {
      mockRequest.auth.credentials.emailVerified = true
      mockRequest.auth.credentials.tokenVerified = true

      return runTest(route, mockRequest, function (response) {
        t.deepEqual(response, {
          email: TEST_EMAIL,
          verified: true,
          sessionVerified: true,
          emailVerified: true
        })
      })
    })

    t.test('verified account, unverified session, must verify session', function (t) {
      mockRequest.auth.credentials.emailVerified = true
      mockRequest.auth.credentials.tokenVerified = false
      mockRequest.auth.credentials.mustVerify = true

      return runTest(route, mockRequest, function (response) {
        t.deepEqual(response, {
          email: TEST_EMAIL,
          verified: false,
          sessionVerified: false,
          emailVerified: true
        })
      })
    })

    t.test('verified account, unverified session, neednt verify session', function (t) {
      mockRequest.auth.credentials.emailVerified = true
      mockRequest.auth.credentials.tokenVerified = false
      mockRequest.auth.credentials.mustVerify = false

      return runTest(route, mockRequest, function (response) {
        t.deepEqual(response, {
          email: TEST_EMAIL,
          verified: true,
          sessionVerified: false,
          emailVerified: true
        })
      })
    })
  })
})

test('/recovery_email/verify_code', function (t) {
  t.plan(2)
  var uid = uuid.v4('binary').toString('hex')
  var mockRequest = mocks.mockRequest({
    query: {},
    payload: {
      uid: uid,
      code: 'e3c5b0e3f5391e134596c27519979b93',
      service: 'sync'
    }
  })
  var dbData = {
    email: TEST_EMAIL,
    emailCode: Buffer(mockRequest.payload.code, 'hex'),
    emailVerified: false,
    uid: uid
  }
  var dbErrors = {
    verifyTokens: error.invalidVerificationCode({})
  }
  var mockDB = mocks.mockDB(dbData, dbErrors)
  var mockLog = mocks.spyLog()
  var mockMailer = mocks.mockMailer()
  var accountRoutes = makeRoutes({
    checkPassword: function () {
      return P.resolve(true)
    },
    config: {},
    customs: {
      check: function () {
        return P.resolve()
      }
    },
    db: mockDB,
    log: mockLog,
    mailer: mockMailer
  })
  var route = getRoute(accountRoutes, '/recovery_email/verify_code')
  t.test('verifyTokens rejects with INVALID_VERIFICATION_CODE', function (t) {
    t.plan(2)

    t.test('without a reminder payload', function (t) {
      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.verifyTokens.callCount, 1, 'calls verifyTokens')
        t.equal(mockDB.verifyEmail.callCount, 1, 'calls verifyEmail')
        t.equal(mockLog.notifyAttachedServices.callCount, 1, 'logs verified')

        t.equal(mockMailer.sendPostVerifyEmail.callCount, 1, 'sendPostVerifyEmail was called once')

        t.equal(mockLog.activityEvent.callCount, 1, 'activityEvent was called once')
        var args = mockLog.activityEvent.args[0]
        t.equal(args.length, 3, 'activityEvent was passed three arguments')
        t.equal(args[0], 'account.verified', 'first argument was event name')
        t.deepEqual(args[1], {
          auth: {
            credentials: {
              uid: Buffer(uid, 'hex'),
              id: mockRequest.payload.code,
            }
          },
          headers: mockRequest.headers,
          payload: mockRequest.payload,
          query: mockRequest.query
        }, 'second argument was synthesized request object')
        t.deepEqual(args[2], {
          uid: uid.toString('hex')
        }, 'third argument contained uid')

        t.equal(JSON.stringify(response), '{}')
      })
      .then(function () {
        mockDB.verifyTokens.reset()
        mockDB.verifyEmail.reset()
        mockLog.activityEvent.reset()
        mockLog.notifyAttachedServices.reset()
        mockMailer.sendPostVerifyEmail.reset()
      })
    })

    t.test('with a reminder payload', function (t) {
      mockRequest.payload.reminder = 'second'

      return runTest(route, mockRequest, function (response) {
        t.equal(mockLog.activityEvent.callCount, 2, 'activityEvent was called twice')
        t.equal(mockLog.activityEvent.args[0][0], 'account.verified', 'first call was account.verified')
        t.equal(mockMailer.sendPostVerifyEmail.callCount, 1, 'sendPostVerifyEmail was called once')

        var args = mockLog.activityEvent.args[1]
        t.equal(args.length, 3, 'activityEvent was passed three arguments second time')
        t.equal(args[0], 'account.reminder', 'first argument was event name')
        t.equal(args[1], mockRequest, 'second argument was request object')
        t.deepEqual(args[2], {
          uid: uid.toString('hex')
        }, 'third argument contained uid')

        t.equal(JSON.stringify(response), '{}')
      })
      .then(function () {
        mockDB.verifyTokens.reset()
        mockDB.verifyEmail.reset()
        mockLog.activityEvent.reset()
        mockLog.notifyAttachedServices.reset()
        mockMailer.sendPostVerifyEmail.reset()
      })
    })
  })

  t.test('verifyTokens resolves', function (t) {
    t.plan(2)

    dbData.emailVerified = true
    dbErrors.verifyTokens = undefined

    t.test('email verification', function (t) {
      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.verifyTokens.callCount, 1, 'call db.verifyTokens')
        t.equal(mockDB.verifyEmail.callCount, 0, 'does not call db.verifyEmail')
        t.equal(mockLog.notifyAttachedServices.callCount, 0, 'does not call log.notifyAttachedServices')
        t.equal(mockLog.activityEvent.callCount, 0, 'log.activityEvent was not called')
      })
      .then(function () {
        mockDB.verifyTokens.reset()
      })
    })

    t.test('sign-in confirmation', function (t) {
      dbData.emailCode = crypto.randomBytes(16)

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.verifyTokens.callCount, 1, 'call db.verifyTokens')
        t.equal(mockDB.verifyEmail.callCount, 0, 'does not call db.verifyEmail')
        t.equal(mockLog.notifyAttachedServices.callCount, 0, 'does not call log.notifyAttachedServices')

        t.equal(mockLog.activityEvent.callCount, 1, 'log.activityEvent was called once')
        var args = mockLog.activityEvent.args[0]
        t.equal(args.length, 3, 'log.activityEvent was passed three arguments')
        t.equal(args[0], 'account.confirmed', 'first argument was event name')
        t.deepEqual(args[1], {
          auth: {
            credentials: {
              uid: Buffer(uid, 'hex'),
              id: mockRequest.payload.code,
            }
          },
          headers: mockRequest.headers,
          payload: mockRequest.payload,
          query: mockRequest.query
        }, 'second argument was synthesized request object')
        t.deepEqual(args[2], {
          uid: uid.toString('hex')
        }, 'third argument contained uid')
      })
      .then(function () {
        mockDB.verifyTokens.reset()
        mockLog.activityEvent.reset()
      })
    })
  })
})

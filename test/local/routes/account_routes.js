/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var sinon = require('sinon')

var test = require('tap').test
var mocks = require('../../mocks')
var getRoute = require('../../routes_helpers').getRoute
var makeRoutes = require('../../routes_helpers').makeAccountRoutes

var P = require('../../../lib/promise')
var uuid = require('uuid')
var crypto = require('crypto')
var error = require('../../../lib/error')
var log = require('../../../lib/log')

var TEST_EMAIL = 'foo@gmail.com'

function runTest (route, request, assertions) {
  return new P(function (resolve) {
    route.handler(request, function (response) {
      resolve(response)
    })
  })
    .then(assertions)
}

test('/account/reset', function (t) {
  var uid = uuid.v4('binary')
  var mockRequest = mocks.mockRequest({
    credentials: {
      uid: uid.toString('hex')
    },
    payload: {
      authPW: crypto.randomBytes(32).toString('hex')
    }
  })
  var mockDB = mocks.mockDB({
    uid: uid,
    email: TEST_EMAIL
  })
  var mockCustoms = {
    reset: sinon.spy(function () {
      return P.resolve()
    })
  }
  var mockLog = mocks.spyLog()
  var mockPush = mocks.mockPush()
  var accountRoutes = makeRoutes({
    customs: mockCustoms,
    db: mockDB,
    log: mockLog,
    push: mockPush
  })
  var route = getRoute(accountRoutes, '/account/reset')

  return runTest(route, mockRequest, function () {
    t.equal(mockDB.resetAccount.callCount, 1)

    t.equal(mockPush.notifyPasswordReset.callCount, 1)
    t.equal(mockPush.notifyPasswordReset.firstCall.args[0], uid.toString('hex'))

    t.equal(mockDB.account.callCount, 1)
    t.equal(mockCustoms.reset.callCount, 1)

    t.equal(mockLog.activityEvent.callCount, 1, 'log.activityEvent was called once')
    var args = mockLog.activityEvent.args[0]
    t.equal(args.length, 3, 'log.activityEvent was passed three arguments')
    t.equal(args[0], 'account.reset', 'first argument was event name')
    t.equal(args[1], mockRequest, 'second argument was request object')
    t.deepEqual(args[2], { uid: uid.toString('hex') }, 'third argument contained uid')
  })
})

test('/account/create', function (t) {
  var mockRequest = mocks.mockRequest({
    payload: {
      email: TEST_EMAIL,
      authPW: crypto.randomBytes(32).toString('hex'),
      service: 'sync',
      metricsContext: {
        flowBeginTime: Date.now(),
        flowId: 'F1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF103',
        entrypoint: 'preferences',
        utmContent: 'some-content-string'
      }
    },
    query: {
      keys: 'true'
    }
  })
  var emailCode = crypto.randomBytes(16)
  var keyFetchTokenId = crypto.randomBytes(16)
  var sessionTokenId = crypto.randomBytes(16)
  var uid = uuid.v4('binary')
  var mockDB = mocks.mockDB({
    email: TEST_EMAIL,
    emailCode: emailCode,
    emailVerified: false,
    keyFetchTokenId: keyFetchTokenId,
    sessionTokenId: sessionTokenId,
    uid: uid,
    wrapWrapKb: 'wibble'
  }, {
    emailRecord: new error.unknownAccount()
  })
  // We want to test what's actually written to stdout by the logger.
  var mockLog = log('ERROR', 'test', {
    stdout: {
      on: sinon.spy(),
      write: sinon.spy()
    },
    stderr: {
      on: sinon.spy(),
      write: sinon.spy()
    }
  })
  var mockMetricsContext = mocks.mockMetricsContext({
    gather: sinon.spy(function (data, request) {
      return P.resolve(request.payload.metricsContext)
    })
  })
  mockLog.setMetricsContext(mockMetricsContext)
  mockLog.activityEvent = sinon.spy(function () {
    return P.resolve()
  })
  var mockMailer = mocks.mockMailer()
  var mockPush = mocks.mockPush()
  var accountRoutes = makeRoutes({
    db: mockDB,
    log: mockLog,
    mailer: mockMailer,
    metricsContext: mockMetricsContext,
    Password: function () {
      return {
        unwrap: function () {
          return P.resolve('wibble')
        },
        verifyHash: function () {
          return P.resolve('wibble')
        }
      }
    },
    push: mockPush
  })
  var route = getRoute(accountRoutes, '/account/create')

  return runTest(route, mockRequest, function () {
    t.equal(mockDB.createAccount.callCount, 1, 'createAccount was called')

    t.equal(mockLog.stdout.write.callCount, 1, 'an sqs event was logged')
    var eventData = JSON.parse(mockLog.stdout.write.getCall(0).args[0])
    t.equal(eventData.event, 'login', 'it was a login event')
    t.equal(eventData.data.service, 'sync', 'it was for sync')
    t.equal(eventData.data.email, TEST_EMAIL, 'it was for the correct email')
    t.deepEqual(eventData.data.metricsContext, mockRequest.payload.metricsContext, 'it contained the correct metrics context metadata')

    t.equal(mockLog.activityEvent.callCount, 1, 'log.activityEvent was called once')
    var args = mockLog.activityEvent.args[0]
    t.equal(args.length, 3, 'log.activityEvent was passed three arguments')
    t.equal(args[0], 'account.created', 'first argument was event name')
    t.equal(args[1], mockRequest, 'second argument was request object')
    t.deepEqual(args[2], { uid: uid.toString('hex') }, 'third argument contained uid')

    t.equal(mockMetricsContext.validate.callCount, 1, 'metricsContext.validate was called')
    args = mockMetricsContext.validate.args[0]
    t.equal(args.length, 1, 'validate was called with a single argument')
    t.deepEqual(args[0], mockRequest, 'validate was called with the request')

    t.equal(mockMetricsContext.stash.callCount, 3, 'metricsContext.stash was called three times')

    args = mockMetricsContext.stash.args[0]
    t.equal(args.length, 3, 'metricsContext.stash was passed three arguments first time')
    t.deepEqual(args[0].tokenId, sessionTokenId, 'first argument was session token')
    t.deepEqual(args[0].uid, uid, 'sessionToken.uid was correct')
    t.deepEqual(args[1], [ 'device.created', 'account.signed' ], 'second argument was event array')
    t.equal(args[2], mockRequest.payload.metricsContext, 'third argument was metrics context')

    args = mockMetricsContext.stash.args[1]
    t.equal(args.length, 3, 'metricsContext.stash was passed three arguments second time')
    t.equal(args[0].id, emailCode.toString('hex'), 'first argument was synthesized token')
    t.deepEqual(args[0].uid, uid, 'token.uid was correct')
    t.deepEqual(args[1], 'account.verified', 'second argument was event name')
    t.equal(args[2], mockRequest.payload.metricsContext, 'third argument was metrics context')

    args = mockMetricsContext.stash.args[2]
    t.equal(args.length, 3, 'metricsContext.stash was passed three arguments third time')
    t.deepEqual(args[0].tokenId, keyFetchTokenId, 'first argument was key fetch token')
    t.deepEqual(args[0].uid, uid, 'keyFetchToken.uid was correct')
    t.deepEqual(args[1], 'account.keyfetch', 'second argument was event name')
    t.equal(args[2], mockRequest.payload.metricsContext, 'third argument was metrics context')
  }).finally(function () {
    mockLog.close()
  })
})

test('/account/login', function (t) {
  t.plan(4)
  var config = {
    newLoginNotificationEnabled: true
  }
  var mockRequest = mocks.mockRequest({
    query: {
      keys: 'true'
    },
    payload: {
      authPW: crypto.randomBytes(32).toString('hex'),
      email: TEST_EMAIL,
      service: 'sync',
      reason: 'signin',
      metricsContext: {
        context: 'fx_desktop_v3',
        flowBeginTime: Date.now(),
        flowId: 'F1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF103',
        entrypoint: 'preferences',
        utmContent: 'some-content-string'
      }
    }
  })
  var mockRequestNoKeys = mocks.mockRequest({
    query: {},
    payload: {
      authPW: crypto.randomBytes(32).toString('hex'),
      email: 'test@mozilla.com',
      service: 'dcdb5ae7add825d2',
      reason: 'signin',
      metricsContext: {
        flowBeginTime: Date.now(),
        flowId: 'F1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF103',
        service: 'dcdb5ae7add825d2'
      }
    }
  })
  var keyFetchTokenId = crypto.randomBytes(16)
  var sessionTokenId = crypto.randomBytes(16)
  var uid = uuid.v4('binary')
  var mockDB = mocks.mockDB({
    email: TEST_EMAIL,
    emailVerified: true,
    keyFetchTokenId: keyFetchTokenId,
    sessionTokenId: sessionTokenId,
    uid: uid
  })
  // We want to test what's actually written to stdout by the logger.
  var mockLog = log('ERROR', 'test', {
    stdout: {
      on: sinon.spy(),
      write: sinon.spy()
    },
    stderr: {
      on: sinon.spy(),
      write: sinon.spy()
    }
  })
  var mockMetricsContext = mocks.mockMetricsContext({
    gather: sinon.spy(function (data, request) {
      return P.resolve(request.payload.metricsContext)
    })
  })
  mockLog.setMetricsContext(mockMetricsContext)
  mockLog.activityEvent = sinon.spy(function () {
    return P.resolve()
  })
  var mockMailer = mocks.mockMailer()
  var mockPush = mocks.mockPush()
  var accountRoutes = makeRoutes({
    checkPassword: function () {
      return P.resolve(true)
    },
    config: config,
    customs: {
      check: function () {
        return P.resolve()
      }
    },
    db: mockDB,
    log: mockLog,
    mailer: mockMailer,
    metricsContext: mockMetricsContext,
    push: mockPush
  })
  var route = getRoute(accountRoutes, '/account/login')

  t.test('sign-in confirmation disabled', function (t) {
    return runTest(route, mockRequest, function (response) {
      t.equal(mockDB.emailRecord.callCount, 1, 'db.emailRecord was called')
      t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
      var tokenData = mockDB.createSessionToken.getCall(0).args[0]
      t.notOk(tokenData.mustVerify, 'sessionToken was created verified')
      t.notOk(tokenData.tokenVerificationId, 'sessionToken was created verified')
      t.equal(mockDB.sessions.callCount, 1, 'db.sessions was called')

      t.equal(mockLog.stdout.write.callCount, 1, 'an sqs event was logged')
      var eventData = JSON.parse(mockLog.stdout.write.getCall(0).args[0])
      t.equal(eventData.event, 'login', 'it was a login event')
      t.equal(eventData.data.service, 'sync', 'it was for sync')
      t.equal(eventData.data.email, TEST_EMAIL, 'it was for the correct email')
      t.deepEqual(eventData.data.metricsContext, mockRequest.payload.metricsContext, 'it contained the metrics context')

      t.equal(mockLog.activityEvent.callCount, 1, 'log.activityEvent was called once')
      var args = mockLog.activityEvent.args[0]
      t.equal(args.length, 3, 'log.activityEvent was passed three arguments')
      t.equal(args[0], 'account.login', 'first argument was event name')
      t.equal(args[1], mockRequest, 'second argument was request object')
      t.deepEqual(args[2], { uid: uid.toString('hex') }, 'third argument contained uid')

      t.equal(mockMetricsContext.validate.callCount, 1, 'metricsContext.validate was called')
      args = mockMetricsContext.validate.args[0]
      t.equal(args.length, 1, 'validate was called with a single argument')
      t.deepEqual(args[0], mockRequest, 'validate was called with the request')

      t.equal(mockMetricsContext.stash.callCount, 2, 'metricsContext.stash was called twice')

      args = mockMetricsContext.stash.args[0]
      t.equal(args.length, 3, 'metricsContext.stash was passed three arguments first time')
      t.deepEqual(args[0].tokenId, sessionTokenId, 'first argument was session token')
      t.deepEqual(args[0].uid, uid, 'sessionToken.uid was correct')
      t.deepEqual(args[1], [ 'device.created', 'account.signed' ], 'second argument was event array')
      t.equal(args[2], mockRequest.payload.metricsContext, 'third argument was metrics context')

      args = mockMetricsContext.stash.args[1]
      t.equal(args.length, 3, 'metricsContext.stash was passed three arguments second time')
      t.deepEqual(args[0].tokenId, keyFetchTokenId, 'first argument was key fetch token')
      t.deepEqual(args[0].uid, uid, 'keyFetchToken.uid was correct')
      t.deepEqual(args[1], 'account.keyfetch', 'second argument was event name')
      t.equal(args[2], mockRequest.payload.metricsContext, 'third argument was metrics context')

      t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 1, 'mailer.sendNewDeviceLoginNotification was called')
      t.equal(mockMailer.sendNewDeviceLoginNotification.getCall(0).args[1].location.city, 'Mountain View')
      t.equal(mockMailer.sendNewDeviceLoginNotification.getCall(0).args[1].location.country, 'United States')
      t.equal(mockMailer.sendNewDeviceLoginNotification.getCall(0).args[1].timeZone, 'America/Los_Angeles')
      t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
      t.ok(response.verified, 'response indicates account is verified')
      t.notOk(response.verificationMethod, 'verificationMethod doesn\'t exist')
      t.notOk(response.verificationReason, 'verificationReason doesn\'t exist')
    }).then(function () {
      mockMailer.sendNewDeviceLoginNotification.reset()
      mockDB.createSessionToken.reset()
      mockMetricsContext.stash.reset()
    })
  })

  t.test('sign-in confirmation enabled', function (t) {
    t.plan(11)
    config.signinConfirmation = {
      enabled: true,
      supportedClients: [ 'fx_desktop_v3' ],
      forceEmailRegex: [ '.+@mozilla\.com$', 'fennec@fire.fox' ]
    }

    t.test('always on', function (t) {
      config.signinConfirmation.sample_rate = 1

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.ok(tokenData.mustVerify, 'sessionToken must be verified before use')
        t.ok(tokenData.tokenVerificationId, 'sessionToken was created unverified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
        t.notOk(response.verified, 'response indicates account is not verified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'login', 'verificationReason is login')

        t.equal(mockMetricsContext.stash.callCount, 3, 'metricsContext.stash was called three times')
        t.deepEqual(mockMetricsContext.stash.args[0][1], [ 'device.created', 'account.signed' ], 'first call was for device.created and account.signed')
        var args = mockMetricsContext.stash.args[1]
        t.equal(args.length, 3, 'metricsContext.stash was passed three arguments second time')
        t.ok(/^[0-9a-f]{32}$/.test(args[0].id), 'first argument was synthesized token')
        t.deepEqual(args[0].uid, uid, 'token.uid was correct')
        t.deepEqual(args[1], 'account.confirmed', 'second argument was event name')
        t.equal(args[2], mockRequest.payload.metricsContext, 'third argument was metrics context')
        t.deepEqual(mockMetricsContext.stash.args[2][1], 'account.keyfetch', 'third call was for account.keyfetch')
      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
        mockMetricsContext.stash.reset()
      })
    })

    t.test('location data is present in sign-in confirmation email', function (t) {
      return runTest(route, mockRequest, function (response) {
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
        t.equal(mockMailer.sendVerifyLoginEmail.getCall(0).args[2].location.city, 'Mountain View')
        t.equal(mockMailer.sendVerifyLoginEmail.getCall(0).args[2].location.country, 'United States')
        t.equal(mockMailer.sendVerifyLoginEmail.getCall(0).args[2].timeZone, 'America/Los_Angeles')
      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
        mockDB.createSessionToken.reset()
      })
    })

    t.test('on for sample', function (t) {
      // Force uid to '01...'
      uid.fill(0, 0, 1)
      uid.fill(1, 1, 2)
      config.signinConfirmation.sample_rate = 0.02

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.ok(tokenData.mustVerify, 'sessionToken must be verified before use')
        t.ok(tokenData.tokenVerificationId, 'sessionToken was created unverified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
        t.notOk(response.verified, 'response indicates account is not verified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'login', 'verificationReason is login')
      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
        mockDB.createSessionToken.reset()
      })
    })

    t.test('off for sample', function (t) {
      config.signinConfirmation.sample_rate = 0.01

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.notOk(tokenData.mustVerify, 'sessionToken was created verified')
        t.notOk(tokenData.tokenVerificationId, 'sessionToken was created verified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 1, 'mailer.sendNewDeviceLoginNotification was called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.ok(response.verified, 'response indicates account is verified')
        t.notOk(response.verificationMethod, 'verificationMethod doesn\'t exist')
        t.notOk(response.verificationReason, 'verificationReason doesn\'t exist')
      }).then(function () {
        mockMailer.sendNewDeviceLoginNotification.reset()
        mockDB.createSessionToken.reset()
      })
    })

    t.test('on for email regex match, keys requested', function (t) {
      mockRequest.payload.email = 'test@mozilla.com'
      mockDB.emailRecord = function () {
        return P.resolve({
          authSalt: crypto.randomBytes(32),
          data: crypto.randomBytes(32),
          email: 'test@mozilla.com',
          emailVerified: true,
          kA: crypto.randomBytes(32),
          lastAuthAt: function () {
            return Date.now()
          },
          uid: uid,
          wrapWrapKb: crypto.randomBytes(32)
        })
      }

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.ok(tokenData.mustVerify, 'sessionToken must be verified before use')
        t.ok(tokenData.tokenVerificationId, 'sessionToken was created unverified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
        t.notOk(response.verified, 'response indicates account is not verified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'login', 'verificationReason is login')
      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
        mockDB.createSessionToken.reset()
      })
    })

    t.test('off for email regex match, keys not requested', function (t) {
      mockDB.emailRecord = function () {
        return P.resolve({
          authSalt: crypto.randomBytes(32),
          data: crypto.randomBytes(32),
          email: 'test@mozilla.com',
          emailVerified: true,
          kA: crypto.randomBytes(32),
          lastAuthAt: function () {
            return Date.now()
          },
          uid: uid,
          wrapWrapKb: crypto.randomBytes(32)
        })
      }

      return runTest(route, mockRequestNoKeys, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.notOk(tokenData.mustVerify, 'sessionToken does not have to be verified')
        t.ok(tokenData.tokenVerificationId, 'sessionToken was created unverified')
        // Note that *neither* email is sent in this case,
        // since it can't have been a new device connection.
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.ok(response.verified, 'response indicates account is verified')
        t.notOk(response.verificationMethod, 'verificationMethod doesn\'t exist')
        t.notOk(response.verificationReason, 'verificationReason doesn\'t exist')
      }).then(function () {
        mockDB.createSessionToken.reset()
      })
    })

    t.test('on for specific email', function (t) {
      mockRequest.payload.email = 'fennec@fire.fox'
      mockDB.emailRecord = function () {
        return P.resolve({
          authSalt: crypto.randomBytes(32),
          data: crypto.randomBytes(32),
          email: 'fennec@fire.fox',
          emailVerified: true,
          kA: crypto.randomBytes(32),
          lastAuthAt: function () {
            return Date.now()
          },
          uid: uid,
          wrapWrapKb: crypto.randomBytes(32)
        })
      }

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.ok(tokenData.mustVerify, 'sessionToken must be verified before use')
        t.ok(tokenData.tokenVerificationId, 'sessionToken was created unverified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
        t.notOk(response.verified, 'response indicates account is not verified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'login', 'verificationReason is login')
      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
        mockDB.createSessionToken.reset()
      })
    })

    t.test('off for email regex mismatch', function (t) {
      mockRequest.payload.email = 'moz@fire.fox'
      mockDB.emailRecord = function () {
        return P.resolve({
          authSalt: crypto.randomBytes(32),
          data: crypto.randomBytes(32),
          email: 'moz@fire.fox',
          emailVerified: true,
          kA: crypto.randomBytes(32),
          lastAuthAt: function () {
            return Date.now()
          },
          uid: uid,
          wrapWrapKb: crypto.randomBytes(32)
        })
      }

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.notOk(tokenData.mustVerify, 'sessionToken was created verified')
        t.notOk(tokenData.tokenVerificationId, 'sessionToken was created verified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 1, 'mailer.sendNewDeviceLoginNotification was called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.ok(response.verified, 'response indicates account is verified')
        t.notOk(response.verificationMethod, 'verificationMethod doesn\'t exist')
        t.notOk(response.verificationReason, 'verificationReason doesn\'t exist')
      }).then(function () {
        mockMailer.sendNewDeviceLoginNotification.reset()
        mockDB.createSessionToken.reset()
      })
    })

    t.test('off for unsupported client', function (t) {
      config.signinConfirmation.supportedClients = [ 'fx_desktop_v999' ]

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.notOk(tokenData.mustVerify, 'sessionToken was created verified')
        t.notOk(tokenData.tokenVerificationId, 'sessionToken was created verified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 1, 'mailer.sendNewDeviceLoginNotification was called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.ok(response.verified, 'response indicates account is verified')
        t.notOk(response.verificationMethod, 'verificationMethod doesn\'t exist')
        t.notOk(response.verificationReason, 'verificationReason doesn\'t exist')
      }).then(function () {
        mockMailer.sendNewDeviceLoginNotification.reset()
        mockDB.createSessionToken.reset()
      })
    }, t)

    t.test('on for suspicious requests', function (t) {
      mockRequest.payload.email = 'dodgy@mcdodgeface.com'
      mockRequest.app = { isSuspiciousRequest: true }
      mockDB.emailRecord = function () {
        return P.resolve({
          authSalt: crypto.randomBytes(32),
          data: crypto.randomBytes(32),
          email: 'dodgy@mcdodgeface.com',
          emailVerified: true,
          kA: crypto.randomBytes(32),
          lastAuthAt: function () {
            return Date.now()
          },
          uid: uid,
          wrapWrapKb: crypto.randomBytes(32)
        })
      }

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.ok(tokenData.mustVerify, 'sessionToken must be verified before use')
        t.ok(tokenData.tokenVerificationId, 'sessionToken was created unverified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
        t.notOk(response.verified, 'response indicates account is not verified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'login', 'verificationReason is login')
      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
        mockDB.createSessionToken.reset()
      })
    })

    t.test('unverified account does not get any confirmation emails', function (t) {
      config.signinConfirmation.supportedClients = [ 'fx_desktop_v3' ]
      mockRequest.payload.email = 'test@mozilla.com'
      mockDB.emailRecord = function () {
        return P.resolve({
          authSalt: crypto.randomBytes(32),
          data: crypto.randomBytes(32),
          email: mockRequest.payload.email,
          emailVerified: false,
          kA: crypto.randomBytes(32),
          lastAuthAt: function () {
            return Date.now()
          },
          uid: uid,
          wrapWrapKb: crypto.randomBytes(32)
        })
      }

      return runTest(route, mockRequest, function (response) {
        t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
        var tokenData = mockDB.createSessionToken.getCall(0).args[0]
        t.ok(tokenData.mustVerify, 'sessionToken must be verified before use')
        t.ok(tokenData.tokenVerificationId, 'sessionToken was created unverified')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.notOk(response.verified, 'response indicates account is not verified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'signup', 'verificationReason is signup')
      })
    })

  })

  t.test('creating too many sessions causes an error to be logged', function (t) {
    mockDB.sessions = function () {
      return P.resolve(new Array(200))
    }
    mockLog.error = sinon.spy()
    return runTest(route, mockRequest, function () {
      t.equal(mockLog.error.callCount, 0, 'log.error was not called')
    }).then(function() {
      mockDB.sessions = function () {
        return P.resolve(new Array(201))
      }
      mockLog.error.reset()
      return runTest(route, mockRequest, function () {
        t.equal(mockLog.error.callCount, 1, 'log.error was called')
        t.equal(mockLog.error.firstCall.args[0].op, 'Account.login')
        t.equal(mockLog.error.firstCall.args[0].numSessions, 201)
      })
    }).finally(function () {
      mockLog.close()
    })
  })

  t.test('sign-in unverified account', function (t) {
    t.plan(2)
    mockDB.emailRecord = function () {
      return P.resolve({
        authSalt: crypto.randomBytes(32),
        data: crypto.randomBytes(32),
        email: 'test@mozilla.com',
        emailVerified: false,
        kA: crypto.randomBytes(32),
        lastAuthAt: function () {
          return Date.now()
        },
        uid: uid,
        wrapWrapKb: crypto.randomBytes(32)
      })
    }

    t.test('without `sendEmailIfUnverified` param', function (t) {
      return runTest(route, mockRequest, function (response) {
        t.equal(mockMailer.sendVerifyCode.callCount, 0, 'mailer.sendVerifyCode was not called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(response.verified, false, 'response indicates account is unverified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'signup', 'verificationReason is signup')
      })
    })

    t.test('with `sendEmailIfUnverified` param', function (t) {
      mockRequest.payload.sendEmailIfUnverified = true
      return runTest(route, mockRequest, function (response) {
        t.equal(mockMailer.sendVerifyCode.callCount, 1, 'mailer.sendVerifyCode was called')
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 0, 'mailer.sendNewDeviceLoginNotification was not called')
        t.equal(response.verified, false, 'response indicates account is unverified')
        t.equal(response.verificationMethod, 'email', 'verificationMethod is email')
        t.equal(response.verificationReason, 'signup', 'verificationReason is signup')
      }).then(function () {
        mockRequest.payload.sendEmailIfUnverified = undefined
      })
    })
  })
})

test('/account/keys', function (t) {
  t.plan(2)
  var keyFetchTokenId = crypto.randomBytes(16)
  var uid = uuid.v4('binary')
  var mockRequest = mocks.mockRequest({
    credentials: {
      emailVerified: true,
      id: keyFetchTokenId.toString('hex'),
      keyBundle: crypto.randomBytes(16),
      tokenId: keyFetchTokenId,
      tokenVerificationId: undefined,
      tokenVerified: true,
      uid: uid
    }
  })
  var mockDB = mocks.mockDB()
  var mockLog = mocks.spyLog()
  var accountRoutes = makeRoutes({
    db: mockDB,
    log: mockLog
  })
  var route = getRoute(accountRoutes, '/account/keys')

  t.test('verified token', function (t) {
    return runTest(route, mockRequest, function (response) {
      t.deepEqual(response, {bundle: mockRequest.auth.credentials.keyBundle.toString('hex')}, 'response was correct')

      t.equal(mockDB.deleteKeyFetchToken.callCount, 1, 'db.deleteKeyFetchToken was called once')
      var args = mockDB.deleteKeyFetchToken.args[0]
      t.equal(args.length, 1, 'db.deleteKeyFetchToken was passed one argument')
      t.equal(args[0], mockRequest.auth.credentials, 'db.deleteKeyFetchToken was passed key fetch token')

      t.equal(mockLog.activityEvent.callCount, 1, 'log.activityEvent was called once')
      args = mockLog.activityEvent.args[0]
      t.equal(args.length, 3, 'log.activityEvent was passed three arguments')
      t.equal(args[0], 'account.keyfetch', 'first argument was event name')
      t.equal(args[1], mockRequest, 'second argument was request object')
      t.deepEqual(args[2], {uid: uid.toString('hex')}, 'third argument contained uid')
    })
      .then(function () {
        mockLog.activityEvent.reset()
        mockDB.deleteKeyFetchToken.reset()
      })
  })

  t.test('unverified token', function (t) {
    mockRequest.auth.credentials.tokenVerificationId = crypto.randomBytes(16)
    mockRequest.auth.credentials.tokenVerified = false
    return runTest(route, mockRequest, function (response) {
      t.equal(response.errno, 104, 'correct errno for unverified account')
      t.equal(response.message, 'Unverified account', 'correct error message')
    })
      .then(function () {
        mockLog.activityEvent.reset()
      })
  })
})

test('/account/destroy', function (t) {
  var email = 'foo@example.com'
  var uid = uuid.v4('binary')
  var mockDB = mocks.mockDB({
    email: email,
    uid: uid
  })
  var mockLog = mocks.spyLog()
  var mockRequest = mocks.mockRequest({
    payload: {
      email: email,
      authPW: new Array(65).join('f')
    }
  })
  var accountRoutes = makeRoutes({
    checkPassword: function () {
      return P.resolve(true)
    },
    config: {
      domain: 'wibble'
    },
    db: mockDB,
    log: mockLog
  })
  var route = getRoute(accountRoutes, '/account/destroy')

  return runTest(route, mockRequest, function () {
    t.equal(mockDB.emailRecord.callCount, 1, 'db.emailRecord was called once')
    var args = mockDB.emailRecord.args[0]
    t.equal(args.length, 2, 'db.emailRecord was passed two arguments')
    t.equal(args[0], email, 'first argument was email address')
    t.equal(args[1], true, 'second argument was customs.check result')

    t.equal(mockDB.deleteAccount.callCount, 1, 'db.deleteAccount was called once')
    args = mockDB.deleteAccount.args[0]
    t.equal(args.length, 1, 'db.deleteAccount was passed one argument')
    t.equal(args[0].email, email, 'db.deleteAccount was passed email record')
    t.deepEqual(args[0].uid, uid, 'email record had correct uid')

    t.equal(mockLog.notifyAttachedServices.callCount, 1, 'log.notifyAttachedServices was called once')
    args = mockLog.notifyAttachedServices.args[0]
    t.equal(args.length, 3, 'log.notifyAttachedServices was passed three arguments')
    t.equal(args[0], 'delete', 'first argument was event name')
    t.equal(args[1], mockRequest, 'second argument was request object')
    t.equal(args[2].uid, uid.toString('hex') + '@wibble', 'third argument was event data')

    t.equal(mockLog.activityEvent.callCount, 1, 'log.activityEvent was called once')
    args = mockLog.activityEvent.args[0]
    t.equal(args.length, 3, 'log.activityEvent was passed three arguments')
    t.equal(args[0], 'account.deleted', 'first argument was event name')
    t.equal(args[1], mockRequest, 'second argument was request object')
    t.equal(args[2].uid, uid.toString('hex'), 'third argument was event data')
  })
})

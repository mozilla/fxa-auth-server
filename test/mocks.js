/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Shared helpers for mocking things out in the tests.
 */

const sinon = require('sinon')
const extend = require('util')._extend
const P = require('../lib/promise')
const crypto = require('crypto')

const CUSTOMS_METHOD_NAMES = [
  'check',
  'checkAuthenticated',
  'flag',
  'reset'
]

const DB_METHOD_NAMES = [
  'account',
  'consumeUnblockCode',
  'createAccount',
  'createDevice',
  'createKeyFetchToken',
  'createPasswordForgotToken',
  'createSessionToken',
  'createUnblockCode',
  'deleteAccount',
  'deleteDevice',
  'deleteKeyFetchToken',
  'deletePasswordChangeToken',
  'deleteVerificationReminder',
  'devices',
  'emailRecord',
  'forgotPasswordVerified',
  'resetAccount',
  'securityEvent',
  'securityEvents',
  'sessions',
  'sessionTokenWithVerificationStatus',
  'updateDevice',
  'updateLocale',
  'updateSessionToken',
  'verifyEmail',
  'verifyTokens'
]

const LOG_METHOD_NAMES = [
  'activityEvent',
  'begin',
  'error',
  'flowEvent',
  'increment',
  'info',
  'notifyAttachedServices',
  'warn',
  'timing',
  'trace'
]

const MAILER_METHOD_NAMES = [
  'sendNewDeviceLoginNotification',
  'sendPasswordChangedNotification',
  'sendPasswordResetNotification',
  'sendPostVerifyEmail',
  'sendUnblockCode',
  'sendVerifyCode',
  'sendVerifyLoginEmail'
]

const METRICS_CONTEXT_METHOD_NAMES = [
  'gather',
  'setFlowCompleteSignal',
  'stash',
  'validate'
]

const PUSH_METHOD_NAMES = [
  'notifyDeviceConnected',
  'notifyDeviceDisconnected',
  'notifyPasswordChanged',
  'notifyPasswordReset',
  'notifyUpdate',
  'pushToAllDevices',
  'pushToDevices'
]

module.exports = {
  mockCustoms: mockObject(CUSTOMS_METHOD_NAMES),
  mockDB: mockDB,
  mockDevices: mockDevices,
  mockLog: mockLog,
  spyLog: spyLog,
  mockMailer: mockObject(MAILER_METHOD_NAMES),
  mockMetricsContext: mockObject(METRICS_CONTEXT_METHOD_NAMES),
  mockPush: mockObject(PUSH_METHOD_NAMES),
  mockRequest: mockRequest
}

function mockDB (data, errors) {
  data = data || {}
  errors = errors || {}

  return mockObject(DB_METHOD_NAMES)({
    account: sinon.spy(() => {
      return P.resolve({
        email: data.email,
        emailCode: data.emailCode,
        emailVerified: data.emailVerified,
        uid: data.uid,
        verifierSetAt: Date.now(),
        wrapWrapKb: data.wrapWrapKb
      })
    }),
    createAccount: sinon.spy(() => {
      return P.resolve({
        uid: data.uid,
        email: data.email,
        emailCode: data.emailCode,
        emailVerified: data.emailVerified,
        wrapWrapKb: data.wrapWrapKb
      })
    }),
    createDevice: sinon.spy(() => {
      return P.resolve(Object.keys(data.device).reduce((result, key) => {
        result[key] = data.device[key]
        return result
      }, {
        id: data.deviceId,
        createdAt: data.deviceCreatedAt
      }))
    }),
    createKeyFetchToken: sinon.spy(() => {
      return P.resolve({
        data: crypto.randomBytes(32),
        tokenId: data.keyFetchTokenId,
        uid: data.uid
      })
    }),
    createPasswordForgotToken: sinon.spy(() => {
      return P.resolve({
        data: crypto.randomBytes(32),
        passCode: data.passCode,
        tokenId: data.passwordForgotTokenId,
        uid: data.uid
      })
    }),
    createSessionToken: sinon.spy(() => {
      return P.resolve({
        data: crypto.randomBytes(32),
        email: data.email,
        emailVerified: data.emailVerified,
        lastAuthAt: () => {
          return Date.now()
        },
        tokenId: data.sessionTokenId,
        tokenVerificationId: data.tokenVerificationId,
        tokenVerified: ! data.tokenVerificationId,
        uid: data.uid
      })
    }),
    devices: sinon.spy(() => {
      return P.resolve(data.devices || [])
    }),
    emailRecord: sinon.spy(() => {
      if (errors.emailRecord) {
        return P.reject(errors.emailRecord)
      }
      return P.resolve({
        authSalt: crypto.randomBytes(32),
        createdAt: data.createdAt || Date.now(),
        data: crypto.randomBytes(32),
        email: data.email,
        emailVerified: data.emailVerified,
        kA: crypto.randomBytes(32),
        lastAuthAt: () => {
          return Date.now()
        },
        uid: data.uid,
        wrapWrapKb: crypto.randomBytes(32)
      })
    }),
    forgotPasswordVerified: sinon.spy(() => {
      return P.resolve(data.accountResetToken)
    }),
    securityEvents: sinon.spy(() => {
      return P.resolve([])
    }),
    sessions: sinon.spy(() => {
      return P.resolve(data.sessions || [])
    }),
    updateDevice: sinon.spy((uid, sessionTokenId, device) => {
      return P.resolve(device)
    }),
    sessionTokenWithVerificationStatus: sinon.spy(() => {
      return P.resolve({
        tokenVerified: true
      })
    }),
    verifyTokens: sinon.spy(() => {
      if (errors.verifyTokens) {
        return P.reject(errors.verifyTokens)
      }
      return P.resolve()
    })
  })
}

function mockObject (methodNames) {
  return methods => {
    return methodNames.reduce((object, name) => {
      object[name] = methods && methods[name] || sinon.spy(() => P.resolve())
      return object
    }, {})
  }
}

function mockDevices (data) {
  data = data || {}

  return {
    upsert: sinon.spy(() => {
      return P.resolve({
        id: data.deviceId || crypto.randomBytes(16),
        name: data.deviceName || 'mock device name',
        type: data.deviceType || 'desktop'
      })
    }),
    synthesizeName: sinon.spy(() => {
      return data.deviceName || null
    })
  }
}

// A logging mock that doesn't capture anything.
// You can pass in an object of custom logging methods
// if you need to e.g. make assertions about logged values.
function mockLog (methods) {
  const log = extend({}, methods)
  LOG_METHOD_NAMES.forEach((name) => {
    if (!log[name]) {
      log[name] = function() {}
    }
  })
  return log
}

// A logging mock where all logging methods are sinon spys,
// and we capture a log of all their calls in order.
function spyLog (methods) {
  methods = extend({}, methods)
  methods.messages = methods.messages || []
  LOG_METHOD_NAMES.forEach(name => {
    if (!methods[name]) {
      // arrow function would alter `this` inside the method
      methods[name] = function() {
        this.messages.push({
          level: name,
          args: Array.prototype.slice.call(arguments)
        })
      }
    }
    methods[name] = sinon.spy(methods[name])
  })
  return mockLog(methods)
}

function mockRequest (data) {
  const events = require('../lib/metrics/events')(data.log || module.exports.mockLog())
  const metricsContext = data.metricsContext || module.exports.mockMetricsContext()

  return {
    app: {
      acceptLanguage: 'en-US',
      clientAddress: data.clientAddress || '63.245.221.32' // MTV
    },
    auth: {
      credentials: data.credentials
    },
    clearMetricsContext: metricsContext.clear,
    emitMetricsEvent: events.emit,
    gatherMetricsContext: metricsContext.gather,
    headers: data.headers || {
      'user-agent': 'test user-agent'
    },
    payload: data.payload,
    query: data.query,
    setMetricsFlowCompleteSignal: metricsContext.setFlowCompleteSignal,
    stashMetricsContext: metricsContext.stash,
    validateMetricsContext: metricsContext.validate
  }
}


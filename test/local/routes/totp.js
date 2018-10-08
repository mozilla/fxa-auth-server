/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const { assert } = require('chai')
const getRoute = require('../../routes_helpers').getRoute
const mocks = require('../../mocks')
const otplib = require('otplib')
const P = require('../../../lib/promise')
const sinon = require('sinon')

let log, db, customs, routes, route, request, requestOptions, mailer
const TEST_EMAIL = 'test@email.com'
const secret = 'KE3TGQTRNIYFO2KOPE4G6ULBOV2FQQTN'

describe('totp', () => {
  beforeEach(() => {
    requestOptions = {
      metricsContext: mocks.mockMetricsContext(),
      credentials: {
        uid: 'uid',
        email: TEST_EMAIL,
        id: 'session'
      },
      log: log,
      payload: {
        metricsContext: {
          flowBeginTime: Date.now(),
          flowId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        }
      }
    }
  })

  describe('/totp/create', () => {
    it('should create TOTP token', () => {
      return setup({db: {email: TEST_EMAIL}}, {}, '/totp/create', requestOptions)
        .then((response) => {
          assert.ok(response.qrCodeUrl)
          assert.ok(response.secret)
          assert.equal(db.createTotpToken.callCount, 1, 'called create TOTP token')

          // emits correct metrics
          assert.equal(request.emitMetricsEvent.callCount, 1, 'called emitMetricsEvent')
          const args = request.emitMetricsEvent.args[0]
          assert.equal(args[0], 'totpToken.created', 'called emitMetricsEvent with correct event')
          assert.equal(args[1]['uid'], 'uid', 'called emitMetricsEvent with correct event')
        })
    })

    it('should be disabled in unverified session', () => {
      requestOptions.credentials.tokenVerificationId = 'notverified'
      return setup({db: {email: TEST_EMAIL}}, {}, '/totp/create', requestOptions)
        .then(assert.fail, (err) => {
          assert.deepEqual(err.errno, 138, 'unverified session error')
        })
    })
  })

  describe('/totp/destroy', () => {
    it('should delete TOTP token', () => {
      return setup({db: {email: TEST_EMAIL}}, {}, '/totp/destroy', requestOptions)
        .then((response) => {
          assert.ok(response)
          assert.equal(db.deleteTotpToken.callCount, 1, 'called delete TOTP token')

          assert.equal(log.notifyAttachedServices.callCount, 1, 'called notifyAttachedServices')
          const args = log.notifyAttachedServices.args[0]
          assert.equal(args.length, 3, 'log.notifyAttachedServices was passed three arguments')
          assert.equal(args[0], 'profileDataChanged', 'first argument was event name')
          assert.equal(args[1], request, 'second argument was request object')
          assert.equal(args[2].uid, 'uid', 'third argument was event data with a uid')
        })
    })

    it('should not delete TOTP token in non-totp verified session', () => {
      requestOptions.credentials.authenticatorAssuranceLevel = 1
      return setup({db: {email: TEST_EMAIL}}, {}, '/totp/destroy', requestOptions)
        .then(assert.fail, (err) => {
          assert.deepEqual(err.errno, 138, 'unverified session error')
          assert.equal(log.notifyAttachedServices.callCount, 0, 'did not call notifyAttachedServices')
        })
    })

    it('should be disabled in unverified session', () => {
      requestOptions.credentials.tokenVerificationId = 'notverified'
      return setup({db: {email: TEST_EMAIL}}, {}, '/totp/destroy', requestOptions)
        .then(assert.fail, (err) => {
          assert.deepEqual(err.errno, 138, 'unverified session error')
          assert.equal(log.notifyAttachedServices.callCount, 0, 'did not call notifyAttachedServices')
        })
    })
  })

  describe('/totp/exists', () => {
    it('should check for TOTP token', () => {
      return setup({db: {email: TEST_EMAIL}}, {}, '/totp/exists', requestOptions)
        .then((response) => {
          assert.ok(response)
          assert.equal(db.totpToken.callCount, 1, 'called get TOTP token')
        })
    })

    it('should be disabled in unverified session', () => {
      requestOptions.credentials.tokenVerificationId = 'notverified'
      return setup({db: {email: TEST_EMAIL}}, {}, '/totp/exists', requestOptions)
        .then(assert.fail, (err) => {
          assert.deepEqual(err.errno, 138, 'unverified session error')
        })
    })
  })

  describe('/session/verify/totp', () => {
    it('should return true for valid TOTP code', () => {
      const authenticator = new otplib.authenticator.Authenticator()
      authenticator.options = Object.assign({}, otplib.authenticator.options, {secret})
      requestOptions.payload = {
        code: authenticator.generate(secret)
      }
      return setup({db: {email: TEST_EMAIL}}, {}, '/session/verify/totp', requestOptions)
        .then((response) => {
          assert.equal(response.success, true, 'should be valid code')
          assert.equal(db.totpToken.callCount, 1, 'called get TOTP token')
          assert.equal(db.updateTotpToken.callCount, 0, 'did not update TOTP token')

          assert.equal(log.notifyAttachedServices.callCount, 0, 'did not call notifyAttachedServices')

          // emits correct metrics
          assert.equal(request.emitMetricsEvent.callCount, 1, 'called emitMetricsEvent')
          const args = request.emitMetricsEvent.args[0]
          assert.equal(args[0], 'totpToken.verified', 'called emitMetricsEvent with correct event')
          assert.equal(args[1]['uid'], 'uid', 'called emitMetricsEvent with correct event')
        })
    })

    it('should enable TOTP token if not already enabled', () => {
      const authenticator = new otplib.authenticator.Authenticator()
      authenticator.options = Object.assign({}, otplib.authenticator.options, {secret})
      requestOptions.payload = {
        code: authenticator.generate(secret)
      }
      return setup({db: {email: TEST_EMAIL}, totpTokenVerified: false}, {}, '/session/verify/totp', requestOptions)
        .then((response) => {
          assert.equal(response.success, true, 'should be valid code')
          assert.equal(db.totpToken.callCount, 1, 'called get TOTP token')
          assert.equal(db.updateTotpToken.callCount, 1, 'called update TOTP token')

          assert.equal(log.notifyAttachedServices.callCount, 1, 'called notifyAttachedServices')
          let args = log.notifyAttachedServices.args[0]
          assert.equal(args.length, 3, 'log.notifyAttachedServices was passed three arguments')
          assert.equal(args[0], 'profileDataChanged', 'first argument was event name')
          assert.equal(args[1], request, 'second argument was request object')
          assert.equal(args[2].uid, 'uid', 'third argument was event data with a uid')

          // emits correct metrics
          assert.equal(request.emitMetricsEvent.callCount, 1, 'called emitMetricsEvent')
          args = request.emitMetricsEvent.args[0]
          assert.equal(args[0], 'totpToken.verified', 'called emitMetricsEvent with correct event')
          assert.equal(args[1]['uid'], 'uid', 'called emitMetricsEvent with correct event')
        })
    })

    it('should remove previous sessions when TOTP enabled', () => {
      const authenticator = new otplib.authenticator.Authenticator()
      authenticator.options = Object.assign({}, otplib.authenticator.options, {secret})
      requestOptions.payload = {
        code: authenticator.generate(secret)
      }
      const anotherSession = {
        id: 'anotherSession'
      }
      const sessions = [{id: 'session'}, anotherSession]
      return setup({
        db: {email: TEST_EMAIL, sessions},
        totpTokenVerified: false
      }, {}, '/session/verify/totp', requestOptions)
        .then((response) => {
          assert.equal(response.success, true, 'should be valid code')
          assert.equal(db.sessions.callCount, 1, 'called get sessions')
          let args = db.sessions.args[0]
          assert.equal(args[0], 'uid', 'called with uid')

          assert.equal(db.deleteSessionToken.callCount, 1, 'called delete session')
          args = db.deleteSessionToken.args[0]
          assert.deepEqual(args[0], anotherSession, 'called delete with correct session object')
        })
    })
  })
})

function setup(results, errors, routePath, requestOptions) {
  results = results || {}
  errors = errors || {}
  log = mocks.mockLog()
  customs = mocks.mockCustoms(errors.customs)
  mailer = mocks.mockMailer()
  db = mocks.mockDB(results.db, errors.db)
  db.createTotpToken = sinon.spy(() => {
    return P.resolve({
      qrCodeUrl: 'some base64 encoded png',
      sharedSecret: secret
    })
  })
  db.totpToken = sinon.spy(() => {
    return P.resolve({
      verified: typeof results.totpTokenVerified === 'undefined' ? true : results.totpTokenVerified,
      enabled: typeof results.totpTokenEnabled === 'undefined' ? true : results.totpTokeneEnabled,
      sharedSecret: secret
    })
  })
  routes = makeRoutes({log, db, customs, mailer})
  route = getRoute(routes, routePath)
  request = mocks.mockRequest(requestOptions)
  request.emitMetricsEvent = sinon.spy(() => P.resolve({}))
  return runTest(route, request)
}

function makeRoutes(options = {}) {
  const config = {step: 30}
  const { log, db, customs, mailer } = options
  return require('../../../lib/routes/totp')(log, db, mailer, customs, config)
}

function runTest(route, request) {
  return route.handler(request)
}

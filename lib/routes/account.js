/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

var validators = require('./validators')
var HEX_STRING = validators.HEX_STRING
var BASE64_JWT = validators.BASE64_JWT
var DISPLAY_SAFE_UNICODE = validators.DISPLAY_SAFE_UNICODE
var URLSAFEBASE64 = validators.URLSAFEBASE64
var BASE_36 = validators.BASE_36
var PUSH_PAYLOADS_SCHEMA_PATH = '../../docs/pushpayloads.schema.json'

// An arbitrary, but very generous, limit on the number of active sessions.
// Currently only for metrics purposes, not enforced.
var MAX_ACTIVE_SESSIONS = 200

var MS_ONE_DAY = 1000 * 60 * 60 * 24
var MS_ONE_WEEK = MS_ONE_DAY * 7
var MS_ONE_MONTH = MS_ONE_DAY * 30

var path = require('path')
var ajv = require('ajv')()
var fs = require('fs')
var butil = require('../crypto/butil')
var userAgent = require('../userAgent')
var requestHelper = require('../routes/utils/request_helper')

const METRICS_CONTEXT_SCHEMA = require('../metrics/context').schema

module.exports = function (
  log,
  crypto,
  P,
  uuid,
  isA,
  error,
  db,
  mailer,
  Password,
  config,
  customs,
  isPreVerified,
  checkPassword,
  push,
  devices
  ) {

  // Loads and compiles a json validator for the payloads received
  // in /account/devices/notify
  var schemaPath = path.resolve(__dirname, PUSH_PAYLOADS_SCHEMA_PATH)
  var schema = fs.readFileSync(schemaPath)
  var validatePushPayload = ajv.compile(schema)
  var verificationReminder = require('../verification-reminders')(log, db)
  var getGeoData = require('../geodb')(log)
  var localizeTimestamp = require('fxa-shared').l10n.localizeTimestamp({
    supportedLanguages: config.i18n.supportedLanguages,
    defaultLanguage: config.i18n.defaultLanguage
  })
  const features = require('../features')(config)

  const securityHistoryEnabled = config.securityHistory && config.securityHistory.enabled
  const unblockCodeLifetime = config.signinUnblock && config.signinUnblock.codeLifetime || 0
  const unblockCodeLen = config.signinUnblock && config.signinUnblock.codeLength || 0

  var routes = [
    {
      method: 'POST',
      path: '/account/create',
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required(),
            preVerified: isA.boolean(),
            service: isA.string().max(16).alphanum().optional(),
            redirectTo: validators.redirectTo(config.smtp.redirectDomain).optional(),
            resume: isA.string().max(2048).optional(),
            preVerifyToken: isA.string().max(2048).regex(BASE64_JWT).optional(),
            metricsContext: METRICS_CONTEXT_SCHEMA
          }
        },
        response: {
          schema: {
            uid: isA.string().regex(HEX_STRING).required(),
            sessionToken: isA.string().regex(HEX_STRING).required(),
            keyFetchToken: isA.string().regex(HEX_STRING).optional(),
            authAt: isA.number().integer()
          }
        }
      },
      handler: function accountCreate(request, reply) {
        log.begin('Account.create', request)

        var emailCode = crypto.randomBytes(16)
        var form = request.payload
        var query = request.query
        var email = form.email
        var authSalt = crypto.randomBytes(32)
        var authPW = Buffer(form.authPW, 'hex')
        var locale = request.app.acceptLanguage
        var userAgentString = request.headers['user-agent']
        var service = form.service || query.service
        var tokenVerificationId = emailCode
        var preVerified, password, verifyHash, account, sessionToken, keyFetchToken

        request.validateMetricsContext()

        customs.check(request, email, 'accountCreate')
          .then(db.emailRecord.bind(db, email))
          .then(deleteAccount, ignoreUnknownAccountError)
          .then(checkPreVerified)
          .then(createPassword)
          .then(createAccount)
          .then(createSessionToken)
          .then(sendVerifyCode)
          .then(createKeyFetchToken)
          .then(recordSecurityEvent)
          .then(createResponse)
          .done(reply, reply)

        function deleteAccount (emailRecord) {
          if (emailRecord.emailVerified) {
            throw error.accountExists(email)
          }

          request.app.accountRecreated = true
          return db.deleteAccount(emailRecord)
        }

        function ignoreUnknownAccountError (err) {
          if (err.errno !== error.ERRNO.ACCOUNT_UNKNOWN) {
            throw err
          }
        }

        function checkPreVerified () {
          return isPreVerified(form.email, form.preVerifyToken)
            .then(
              function (result) {
                preVerified = result

                let flowCompleteSignal
                if (service === 'sync') {
                  flowCompleteSignal = 'account.signed'
                } else if (preVerified) {
                  flowCompleteSignal = 'account.created'
                } else {
                  flowCompleteSignal = 'account.verified'
                }
                request.setMetricsFlowCompleteSignal(flowCompleteSignal)
              }
            )
        }

        function createPassword () {
          password = new Password(authPW, authSalt, config.verifierVersion)
          return password.verifyHash()
            .then(
              function (result) {
                verifyHash = result
              }
            )
        }

        function createAccount () {
          if (!locale) {
            // We're seeing a surprising number of accounts created
            // without a proper locale. Log details to help debug this.
            log.info({
              op: 'account.create.emptyLocale',
              email: email,
              locale: locale,
              agent: userAgentString
            })
          }

          return db.createAccount({
            uid: uuid.v4('binary'),
            createdAt: Date.now(),
            email: email,
            emailCode: emailCode,
            emailVerified: form.preVerified || preVerified,
            kA: crypto.randomBytes(32),
            wrapWrapKb: crypto.randomBytes(32),
            accountResetToken: null,
            passwordForgotToken: null,
            authSalt: authSalt,
            verifierVersion: password.version,
            verifyHash: verifyHash,
            verifierSetAt: Date.now(),
            locale: locale
          })
          .then(
            function (result) {
              account = result

              return request.emitMetricsEvent('account.created', {
                uid: account.uid.toString('hex')
              })
            }
          )
          .then(
            function () {
              if (account.emailVerified) {
                return log.notifyAttachedServices('verified', request, {
                  email: account.email,
                  uid: account.uid,
                  locale: account.locale
                })
              }
            }
          )
          .then(
            function () {
              if (service === 'sync') {
                return log.notifyAttachedServices('login', request, {
                  service: 'sync',
                  uid: account.uid,
                  email: account.email,
                  deviceCount: 1,
                  userAgent: request.headers['user-agent']
                })
              }
            }
          )
        }

        function createSessionToken () {
          const enableTokenVerification =
            features.isSigninConfirmationEnabledForUser(account.uid, account.email, request)

          // Verified sessions should only be created for preverified tokens
          // and when sign-in confirmation is disabled or not needed.
          if (preVerified || ! enableTokenVerification) {
            tokenVerificationId = undefined
          }

          return db.createSessionToken({
            uid: account.uid,
            email: account.email,
            emailCode: account.emailCode,
            emailVerified: account.emailVerified,
            verifierSetAt: account.verifierSetAt,
            createdAt: parseInt(query._createdAt),
            mustVerify: enableTokenVerification && requestHelper.wantsKeys(request),
            tokenVerificationId: tokenVerificationId
          }, userAgentString)
            .then(
              function (result) {
                sessionToken = result
                return request.stashMetricsContext(sessionToken)
              }
            )
            .then(
              function () {
                // There is no session token when we emit account.verified
                // so stash the data against a synthesized "token" instead.
                return request.stashMetricsContext({
                  uid: account.uid,
                  id: account.emailCode.toString('hex')
                })
              }
            )
        }

        function sendVerifyCode () {
          if (! account.emailVerified) {
            mailer.sendVerifyCode(account, account.emailCode, {
              service: form.service || query.service,
              redirectTo: form.redirectTo,
              resume: form.resume,
              acceptLanguage: request.app.acceptLanguage
            })
            .then(function () {
              // only create reminder if sendVerifyCode succeeds
              verificationReminder.create({
                uid: account.uid.toString('hex')
              }).catch(function (err) {
                log.error({ op: 'Account.verificationReminder.create', err: err })
              })

              if (tokenVerificationId) {
                // Log server-side metrics for confirming verification rates
                log.info({
                  op: 'account.create.confirm.start',
                  uid: account.uid.toString('hex'),
                  tokenVerificationId: tokenVerificationId
                })
              }
            })
            .catch(function (err) {
              log.error({ op: 'mailer.sendVerifyCode.1', err: err })

              if (tokenVerificationId) {
                // Log possible email bounce, used for confirming verification rates
                log.error({
                  op: 'account.create.confirm.error',
                  uid: account.uid.toString('hex'),
                  err: err,
                  tokenVerificationId: tokenVerificationId
                })
              }
            })
          }
        }

        function createKeyFetchToken () {
          if (requestHelper.wantsKeys(request)) {
            return password.unwrap(account.wrapWrapKb)
              .then(
                function (wrapKb) {
                  return db.createKeyFetchToken({
                    uid: account.uid,
                    kA: account.kA,
                    wrapKb: wrapKb,
                    emailVerified: account.emailVerified,
                    tokenVerificationId: tokenVerificationId
                  })
                }
              )
              .then(
                function (result) {
                  keyFetchToken = result
                  return request.stashMetricsContext(keyFetchToken)
                }
              )
          }
        }

        function recordSecurityEvent() {
          if (securityHistoryEnabled) {
            // don't block response recording db event
            db.securityEvent({
              name: 'account.create',
              uid: account.uid,
              ipAddr: request.app.clientAddress,
              tokenId: sessionToken.tokenId
            })
          }
        }

        function createResponse () {
          var response = {
            uid: account.uid.toString('hex'),
            sessionToken: sessionToken.data.toString('hex'),
            authAt: sessionToken.lastAuthAt()
          }

          if (keyFetchToken) {
            response.keyFetchToken = keyFetchToken.data.toString('hex')
          }

          return P.resolve(response)
        }
      }
    },
    {
      method: 'POST',
      path: '/account/login',
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required(),
            // Obsolete contentToken param, here for backwards compat.
            contentToken: isA.string().optional(),
            service: isA.string().max(16).alphanum().optional(),
            redirectTo: isA.string().uri().optional(),
            resume: isA.string().optional(),
            reason: isA.string().max(16).optional(),
            unblockCode: isA.string().regex(BASE_36).length(unblockCodeLen).optional(),
            metricsContext: METRICS_CONTEXT_SCHEMA
          }
        },
        response: {
          schema: {
            uid: isA.string().regex(HEX_STRING).required(),
            sessionToken: isA.string().regex(HEX_STRING).required(),
            keyFetchToken: isA.string().regex(HEX_STRING).optional(),
            verificationMethod: isA.string().optional(),
            verificationReason: isA.string().optional(),
            verified: isA.boolean().required(),
            authAt: isA.number().integer(),
            emailSent: isA.boolean().optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.login', request)

        var form = request.payload
        var email = form.email
        var authPW = Buffer(form.authPW, 'hex')
        var service = request.payload.service || request.query.service
        var redirectTo = request.payload.redirectTo
        var resume = request.payload.resume
        var tokenVerificationId = crypto.randomBytes(16)
        var emailRecord, sessions, sessionToken, keyFetchToken, mustVerifySession, doSigninConfirmation, emailSent, unblockCode, customsErr, allowSigninUnblock, didSigninUnblock
        var ip = request.app.clientAddress

        request.validateMetricsContext()

        // Monitor for any clients still sending obsolete 'contentToken' param.
        if (request.payload.contentToken) {
          log.info({
            op: 'Account.login.contentToken',
            agent: request.headers['user-agent']
          })
        }

        checkIsBlockForced()
          .then(() => customs.check(request, email, 'accountLogin'))
          .catch(checkUnblockCode)
          .then(readEmailRecord)
          .then(checkEmailAndPassword)
          .then(checkSecurityHistory)
          .then(checkNumberOfActiveSessions)
          .then(createSessionToken)
          .then(createKeyFetchToken)
          .then(emitSyncLoginEvent)
          .then(sendVerifyAccountEmail)
          .then(sendNewDeviceLoginNotification)
          .then(sendVerifyLoginEmail)
          .then(recordSecurityEvent)
          .then(createResponse)
          .catch(gateSigninUnblock)
          .done(reply, reply)

        function checkIsBlockForced () {
          let forced = config.signinUnblock && config.signinUnblock.enabled && config.signinUnblock.forcedEmailAddresses

          if (forced && forced.test(email)) {
            return P.reject(error.requestBlocked(true))
          }

          return P.resolve()
        }

        function checkUnblockCode (e) {
          var method = e.output.payload.verificationMethod
          if (method === 'email-captcha') {
            // only set `unblockCode` if it is required from customs
            unblockCode = request.payload.unblockCode
            if (unblockCode) {
              unblockCode = unblockCode.toUpperCase()
            }
            customsErr = e
            return
          }
          throw e
        }

        function readEmailRecord () {
          return db.emailRecord(email)
            .then(
              function (result) {
                emailRecord = result

                allowSigninUnblock = features.isSigninUnblockEnabledForUser(emailRecord.uid, email, request)
                if (allowSigninUnblock && unblockCode) {
                  return db.consumeUnblockCode(emailRecord.uid, unblockCode)
                    .then(
                      (code) => {
                        if (Date.now() - code.createdAt > unblockCodeLifetime) {
                          log.info({
                            op: 'Account.login.unblockCode.expired',
                            uid: emailRecord.uid.toString('hex')
                          })
                          throw error.invalidUnblockCode()
                        }
                        didSigninUnblock = true
                        return request.emitMetricsEvent('account.login.confirmedUnblockCode')
                      }
                    )
                    .catch(
                      (err) => {
                        if (err.errno === error.ERRNO.UNBLOCK_CODE_INVALID) {
                          customs.flag(request.app.clientAddress, {
                            email: email,
                            errno: err.errno
                          })
                        }
                        throw err
                      }
                    )
                }
                if (!didSigninUnblock && customsErr) {
                  throw customsErr
                }
              },
              function (err) {
                if (err.errno === error.ERRNO.ACCOUNT_UNKNOWN) {
                  customs.flag(request.app.clientAddress, {
                    email: email,
                    errno: err.errno
                  })
                }
                throw err
              }
            )
        }

        function checkSecurityHistory () {
          if (!securityHistoryEnabled) {
            return
          }
          return db.securityEvents({
            uid: emailRecord.uid,
            ipAddr: request.app.clientAddress
          })
            .then(
              function (events) {
                // if we've seen this address for this user before, we
                // can skip signin confirmation
                //
                // for now, just log that we *could* have done so
                if (events.length > 0) {
                  var latest = 0
                  var verified = false

                  events.forEach(function(ev) {
                    if (ev.verified) {
                      verified = true
                      if (ev.createdAt > latest) {
                        latest = ev.createdAt
                      }
                    }
                  })
                  if (verified) {
                    var since = Date.now() - latest
                    var recency
                    if (since < MS_ONE_DAY) {
                      recency = 'day'
                    } else if (since < MS_ONE_WEEK) {
                      recency = 'week'
                    } else if (since < MS_ONE_MONTH) {
                      recency = 'month'
                    } else {
                      recency = 'old'
                    }

                    log.info({
                      op: 'Account.history.verified',
                      uid: emailRecord.uid.toString('hex'),
                      events: events.length,
                      recency: recency
                    })
                  } else {
                    log.info({
                      op: 'Account.history.unverified',
                      uid: emailRecord.uid.toString('hex'),
                      events: events.length
                    })
                  }
                }
              },
              function (err) {
                // for now, security events are purely for metrics
                // so errors shouldn't stop the login attempt
                log.error({
                  op: 'Account.history.error',
                  err: err,
                  uid: emailRecord.uid.toString('hex')
                })
              }
            )
        }

        function checkEmailAndPassword () {
          // Session token verification is only enabled for certain users during phased rollout.
          //
          // If the user went through the sigin-unblock flow, they have already verified their email.
          // No need to also require confirmation afterwards.
          //
          // Even when it is enabled, we only do the email challenge if:
          //  * the request wants keys, since unverified sessions are fine to use for e.g. oauth login.
          //  * the email is verified, since content-server triggers a resend of the verification
          //    email on unverified accounts, which doubles as sign-in confirmation.
          if (didSigninUnblock || !features.isSigninConfirmationEnabledForUser(emailRecord.uid, emailRecord.email, request)) {
            tokenVerificationId = undefined
            mustVerifySession = false
            doSigninConfirmation = false
          } else {
            // The user doesn't *have* to verify their session if they're not requesting keys,
            // but we still create it with a non-null tokenVerificationId, so it will still
            // be considered unverified.  This prevents the session from being used for sync
            // unless the user explicitly requests us to resend the confirmation email, and completes it.
            mustVerifySession = requestHelper.wantsKeys(request)
            doSigninConfirmation = mustVerifySession && emailRecord.emailVerified
          }

          let flowCompleteSignal
          if (service === 'sync') {
            flowCompleteSignal = 'account.signed'
          } else if (doSigninConfirmation) {
            flowCompleteSignal = 'account.confirmed'
          } else {
            flowCompleteSignal = 'account.login'
          }
          request.setMetricsFlowCompleteSignal(flowCompleteSignal)

          if(email !== emailRecord.email) {
            customs.flag(request.app.clientAddress, {
              email: email,
              errno: error.ERRNO.INCORRECT_PASSWORD
            })
            throw error.incorrectPassword(emailRecord.email, email)
          }

          return checkPassword(emailRecord, authPW, request.app.clientAddress)
            .then(
              function (match) {
                if (! match) {
                  throw error.incorrectPassword(emailRecord.email, email)
                }

                return request.emitMetricsEvent('account.login', {
                  uid: emailRecord.uid.toString('hex')
                })
              }
            )
        }

        function checkNumberOfActiveSessions () {
          return db.sessions(emailRecord.uid)
            .then(
              function (s) {
                sessions = s
                if (sessions.length > MAX_ACTIVE_SESSIONS) {
                  // There's no spec-compliant way to error out
                  // as a result of having too many active sessions.
                  // For now, just log metrics about it.
                  log.error({
                    op: 'Account.login',
                    uid: emailRecord.uid,
                    userAgent: request.headers['user-agent'],
                    numSessions: sessions.length
                  })
                }
              }
            )
        }

        function createSessionToken () {
          var sessionTokenOptions = {
            uid: emailRecord.uid,
            email: emailRecord.email,
            emailCode: emailRecord.emailCode,
            emailVerified: emailRecord.emailVerified,
            verifierSetAt: emailRecord.verifierSetAt,
            mustVerify: mustVerifySession,
            tokenVerificationId: tokenVerificationId
          }

          return db.createSessionToken(sessionTokenOptions, request.headers['user-agent'])
            .then(
              function (result) {
                sessionToken = result
                return request.stashMetricsContext(sessionToken)
              }
            )
            .then(
              function () {
                if (doSigninConfirmation) {
                  // There is no session token when we emit account.confirmed
                  // so stash the data against a synthesized "token" instead.
                  return request.stashMetricsContext({
                    uid: emailRecord.uid,
                    id: tokenVerificationId.toString('hex')
                  })
                }
              }
            )
        }

        function createKeyFetchToken() {
          if (requestHelper.wantsKeys(request)) {
            var password = new Password(
              authPW,
              emailRecord.authSalt,
              emailRecord.verifierVersion
            )

            return password.unwrap(emailRecord.wrapWrapKb)
              .then(
                function (wrapKb) {
                  return db.createKeyFetchToken({
                    uid: emailRecord.uid,
                    kA: emailRecord.kA,
                    wrapKb: wrapKb,
                    emailVerified: emailRecord.emailVerified,
                    tokenVerificationId: tokenVerificationId
                  })
                  .then(
                    function (result) {
                      keyFetchToken = result
                      return request.stashMetricsContext(keyFetchToken)
                    }
                  )
                }
              )
          }
        }

        function emitSyncLoginEvent () {
          if (service === 'sync' && request.payload.reason === 'signin') {
            return log.notifyAttachedServices('login', request, {
              service: 'sync',
              uid: emailRecord.uid,
              email: emailRecord.email,
              deviceCount: sessions.length,
              userAgent: request.headers['user-agent']
            })
          }
        }

        function sendVerifyAccountEmail() {
          // Delegate sending emails for unverified users to auth-server.
          emailSent = false

          if (!emailRecord.emailVerified) {
            // Only use tokenVerificationId if it is set, otherwise use the corresponding email code
            // This covers the cases where sign-in confirmation is disabled or not needed.
            var emailCode = tokenVerificationId ? tokenVerificationId : emailRecord.emailCode
            emailSent = true

            return mailer.sendVerifyCode(emailRecord, emailCode, {
              service: service,
              redirectTo: redirectTo,
              resume: resume,
              acceptLanguage: request.app.acceptLanguage
            })
          }
        }

        function sendNewDeviceLoginNotification() {
          // New device notification emails should only be sent when requesting keys.
          // They're not sent if performing a sign-in confirmation
          // (in which case you get the sign-in confirmation email)
          // or if the account is unverified (in which case
          // content-server triggers a resend of the account verification email)
          var shouldSendNewDeviceLoginEmail = config.newLoginNotificationEnabled
            && requestHelper.wantsKeys(request)
            && ! doSigninConfirmation
            && emailRecord.emailVerified
          if (shouldSendNewDeviceLoginEmail) {
            return getGeoData(ip)
              .then(
                function (geoData) {
                  mailer.sendNewDeviceLoginNotification(
                    emailRecord.email,
                    userAgent.call({
                      acceptLanguage: request.app.acceptLanguage,
                      ip: ip,
                      location: geoData.location,
                      timeZone: geoData.timeZone
                    }, request.headers['user-agent'], log)
                  )
                }
              )
          }
        }

        function sendVerifyLoginEmail() {
          if (doSigninConfirmation) {
            log.info({
              op: 'account.signin.confirm.start',
              uid: emailRecord.uid.toString('hex'),
              tokenVerificationId: tokenVerificationId
            })

            return getGeoData(ip)
              .then(
                function (geoData) {
                  mailer.sendVerifyLoginEmail(
                    emailRecord,
                    tokenVerificationId,
                    userAgent.call({
                      acceptLanguage: request.app.acceptLanguage,
                      ip: ip,
                      location: geoData.location,
                      redirectTo: redirectTo,
                      resume: resume,
                      service: service,
                      timeZone: geoData.timeZone
                    }, request.headers['user-agent'], log)
                  )
                }
              )
          }
        }

        function recordSecurityEvent() {
          if (securityHistoryEnabled) {
            // don't block response recording db event
            db.securityEvent({
              name: 'account.login',
              uid: emailRecord.uid,
              ipAddr: request.app.clientAddress,
              tokenId: sessionToken && sessionToken.tokenId
            })
          }
        }

        function createResponse () {
          var response = {
            uid: sessionToken.uid.toString('hex'),
            sessionToken: sessionToken.data.toString('hex'),
            verified: sessionToken.emailVerified,
            authAt: sessionToken.lastAuthAt()
          }

          response.emailSent = emailSent

          if (! requestHelper.wantsKeys(request)) {
            return P.resolve(response)
          }

          response.keyFetchToken = keyFetchToken.data.toString('hex')

          if(! emailRecord.emailVerified) {
            response.verified = false
            response.verificationMethod = 'email'
            response.verificationReason = 'signup'
          } else if (doSigninConfirmation) {
            response.verified = false
            response.verificationMethod = 'email'
            response.verificationReason = 'login'
          }
          return P.resolve(response)
        }

        function gateSigninUnblock (err) {
          // customs.check will always add these properties if the
          // customs server has not rate-limited unblock. Nonetheless,
          // we shouldn't signal to the content-server that it is
          // possible to unblock the user if the feature is not allowed.
          if (!allowSigninUnblock && err.output && err.output.payload) {
            delete err.output.payload.verificationMethod
            delete err.output.payload.verificationReason
          }
          throw err
        }
      }
    },
    {
      method: 'GET',
      path: '/account/status',
      config: {
        auth: {
          mode: 'optional',
          strategy: 'sessionToken'
        },
        validate: {
          query: {
            uid: isA.string().min(32).max(32).regex(HEX_STRING)
          }
        }
      },
      handler: function (request, reply) {
        var sessionToken = request.auth.credentials
        if (sessionToken) {
          reply({ exists: true, locale: sessionToken.locale })
        }
        else if (request.query.uid) {
          var uid = Buffer(request.query.uid, 'hex')
          db.account(uid)
            .done(
              function (account) {
                reply({ exists: true })
              },
              function (err) {
                if (err.errno === error.ERRNO.ACCOUNT_UNKNOWN) {
                  return reply({ exists: false })
                }
                reply(err)
              }
            )
        }
        else {
          reply(error.missingRequestParameter('uid'))
        }
      }
    },
    {
      method: 'POST',
      path: '/account/status',
      config: {
        validate: {
          payload: {
            email: validators.email().required()
          }
        },
        response: {
          schema: {
            exists: isA.boolean().required()
          }
        }
      },
      handler: function (request, reply) {
        var email = request.payload.email

        customs.check(
          request,
          email,
          'accountStatusCheck')
          .then(
            db.accountExists.bind(db, email)
          )
          .done(
            function (exist) {
              reply({
                exists: exist
              })
            },
            function (err) {
              if (err.errno === error.ERRNO.ACCOUNT_UNKNOWN) {
                return reply({ exists: false })
              }
              reply(err)
            }
          )
      }
    },
    {
      method: 'GET',
      path: '/account/profile',
      config: {
        auth: {
          mode: 'optional',
          strategies: [
            'sessionToken',
            'oauthToken'
          ]
        }
      },
      handler: function (request, reply) {
        var auth = request.auth
        var uid
        if (auth.strategy === 'sessionToken') {
          uid = auth.credentials.uid
        } else {
          uid = Buffer(auth.credentials.user, 'hex')
        }
        function hasProfileItemScope(item) {
          if (auth.strategy === 'sessionToken') {
            return true
          }
          var scopes = auth.credentials.scope
          for (var i = 0; i < scopes.length; i++) {
            if (scopes[i] === 'profile') {
              return true
            }
            if (scopes[i] === 'profile:write') {
              return true
            }
            if (scopes[i] === 'profile:' + item) {
              return true
            }
            if (scopes[i] === 'profile:' + item + ':write') {
              return true
            }
          }
          return false
        }
        db.account(uid)
          .done(
            function (account) {
              reply({
                email: hasProfileItemScope('email') ? account.email : undefined,
                locale: hasProfileItemScope('locale') ? account.locale : undefined
              })
            },
            function (err) {
              reply(err)
            }
          )
      }
    },
    {
      method: 'GET',
      path: '/account/keys',
      config: {
        auth: {
          strategy: 'keyFetchTokenWithVerificationStatus'
        },
        response: {
          schema: {
            bundle: isA.string().regex(HEX_STRING)
          }
        }
      },
      handler: function accountKeys(request, reply) {
        log.begin('Account.keys', request)
        var keyFetchToken = request.auth.credentials

        var verified = keyFetchToken.tokenVerified && keyFetchToken.emailVerified
        if (!verified) {
          // don't delete the token on use until the account is verified
          return reply(error.unverifiedAccount())
        }
        db.deleteKeyFetchToken(keyFetchToken)
          .then(
            function () {
              return request.emitMetricsEvent('account.keyfetch', {
                uid: keyFetchToken.uid.toString('hex')
              })
            }
          )
          .then(
            function () {
              return {
                bundle: keyFetchToken.keyBundle.toString('hex')
              }
            }
          )
          .done(reply, reply)
      }
    },
    {
      method: 'POST',
      path: '/account/device',
      config: {
        auth: {
          strategy: 'sessionTokenWithDevice'
        },
        validate: {
          payload: isA.alternatives().try(
            isA.object({
              id: isA.string().length(32).regex(HEX_STRING).required(),
              name: isA.string().max(255).regex(DISPLAY_SAFE_UNICODE).optional(),
              type: isA.string().max(16).optional(),
              pushCallback: isA.string().uri({ scheme: 'https' }).max(255).optional().allow(''),
              pushPublicKey: isA.string().max(88).regex(URLSAFEBASE64).optional().allow(''),
              pushAuthKey: isA.string().max(24).regex(URLSAFEBASE64).optional().allow('')
            }).or('name', 'type', 'pushCallback', 'pushPublicKey', 'pushAuthKey').and('pushPublicKey', 'pushAuthKey'),
            isA.object({
              name: isA.string().max(255).regex(DISPLAY_SAFE_UNICODE).required(),
              type: isA.string().max(16).required(),
              pushCallback: isA.string().uri({ scheme: 'https' }).max(255).optional().allow(''),
              pushPublicKey: isA.string().max(88).regex(URLSAFEBASE64).optional().allow(''),
              pushAuthKey: isA.string().max(24).regex(URLSAFEBASE64).optional().allow('')
            }).and('pushPublicKey', 'pushAuthKey')
          )
        },
        response: {
          schema: isA.object({
            id: isA.string().length(32).regex(HEX_STRING).required(),
            createdAt: isA.number().positive().optional(),
            // We previously allowed devices to register with arbitrary unicode names,
            // so we can't assert DISPLAY_SAFE_UNICODE in the response schema.
            name: isA.string().max(255).optional(),
            type: isA.string().max(16).optional(),
            pushCallback: isA.string().uri({ scheme: 'https' }).max(255).optional().allow(''),
            pushPublicKey: isA.string().max(88).regex(URLSAFEBASE64).optional().allow(''),
            pushAuthKey: isA.string().max(24).regex(URLSAFEBASE64).optional().allow('')
          }).and('pushPublicKey', 'pushAuthKey')
        }
      },
      handler: function (request, reply) {
        log.begin('Account.device', request)
        var payload = request.payload
        var sessionToken = request.auth.credentials

        if (payload.id) {
          // Don't write out the update if nothing has actually changed.
          if (isSpuriousUpdate(payload, sessionToken)) {
            log.increment('device.update.spurious')
            return reply(payload)
          }
          // We also reserve the right to disable updates until
          // we're confident clients are behaving correctly.
          if (config.deviceUpdatesEnabled === false) {
            throw error.featureNotEnabled()
          }
        } else if (sessionToken.deviceId) {
          // Keep the old id, which is probably from a synthesized device record
          payload.id = sessionToken.deviceId.toString('hex')
        }

        if (payload.pushCallback && (!payload.pushPublicKey || !payload.pushAuthKey)) {
          payload.pushPublicKey = ''
          payload.pushAuthKey = ''
        }

        devices.upsert(request, sessionToken, payload).then(
          function (device) {
            reply(butil.unbuffer(device))
          },
          reply
        )

        // Clients have been known to send spurious device updates,
        // which generates lots of unnecessary database load.
        // Check if anything has actually changed, and log lots metrics on what.
        function isSpuriousUpdate(payload, token) {
          var spurious = true
          if(! token.deviceId || payload.id !== token.deviceId.toString('hex')) {
            spurious = false
            log.increment('device.update.sessionToken')
          }
          if (payload.name && payload.name !== token.deviceName) {
            spurious = false
            log.increment('device.update.name')
          }
          if (payload.type && payload.type !== token.deviceType) {
            spurious = false
            log.increment('device.update.type')
          }
          if (payload.pushCallback && payload.pushCallback !== token.deviceCallbackURL) {
            spurious = false
            log.increment('device.update.pushCallback')
          }
          if (payload.pushPublicKey && payload.pushPublicKey !== token.deviceCallbackPublicKey) {
            spurious = false
            log.increment('device.update.pushPublicKey')
          }
          return spurious
        }
      }
    },
    {
      method: 'POST',
      path: '/account/devices/notify',
      config: {
        auth: {
          strategy: 'sessionTokenWithDevice'
        },
        validate: {
          payload: isA.alternatives().try(
            isA.object({
              to: isA.string().valid('all').required(),
              excluded: isA.array().items(isA.string().length(32).regex(HEX_STRING)).optional(),
              payload: isA.object().required(),
              TTL: isA.number().integer().min(0).optional()
            }),
            isA.object({
              to: isA.array().items(isA.string().length(32).regex(HEX_STRING)).required(),
              payload: isA.object().required(),
              TTL: isA.number().integer().min(0).optional()
            })
          )
        },
        response: {
          schema: {}
        }
      },
      handler: function (request, reply) {
        log.begin('Account.devicesNotify', request)

        // We reserve the right to disable notifications until
        // we're confident clients are behaving correctly.
        if (config.deviceNotificationsEnabled === false) {
          throw error.featureNotEnabled()
        }

        var body = request.payload
        var sessionToken = request.auth.credentials
        var uid = sessionToken.uid
        var ip = request.app.clientAddress
        var payload = body.payload

        if (!validatePushPayload(payload)) {
          throw error.invalidRequestParameter('invalid payload')
        }
        var pushOptions = {
          data: new Buffer(JSON.stringify(payload))
        }
        if (body.excluded) {
          pushOptions.excludedDeviceIds = body.excluded
        }
        if (body.TTL) {
          pushOptions.TTL = body.TTL
        }

        var endpointAction = 'devicesNotify'
        var stringUid = uid.toString('hex')
        return customs.checkAuthenticated(endpointAction, ip, stringUid)
          .then(function () {
            if (body.to === 'all') {
              return push.pushToAllDevices(uid, endpointAction, pushOptions)
            } else {
              return push.pushToDevices(uid, body.to, endpointAction, pushOptions)
            }
          })
          .done(
            function () {
              reply({})
            },
            reply
          )
      }
    },
    {
      method: 'GET',
      path: '/account/devices',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: isA.array().items(isA.object({
            id: isA.string().length(32).regex(HEX_STRING).required(),
            isCurrentDevice: isA.boolean().required(),
            lastAccessTime: isA.number().min(0).required().allow(null),
            lastAccessTimeFormatted: isA.string().optional().allow(''),
            // We previously allowed devices to register with arbitrary unicode names,
            // so we can't assert DISPLAY_SAFE_UNICODE in the response schema.
            name: isA.string().max(255).required().allow(''),
            type: isA.string().max(16).required(),
            pushCallback: isA.string().uri({ scheme: 'https' }).max(255).optional().allow('').allow(null),
            pushPublicKey: isA.string().max(88).regex(URLSAFEBASE64).optional().allow('').allow(null),
            pushAuthKey: isA.string().max(24).regex(URLSAFEBASE64).optional().allow('').allow(null)
          }).and('pushPublicKey', 'pushAuthKey'))
        }
      },
      handler: function (request, reply) {
        log.begin('Account.devices', request)
        var sessionToken = request.auth.credentials
        var uid = sessionToken.uid
        db.devices(uid).then(
          function (deviceArray) {
            reply(deviceArray.map(function (device) {
              if (! device.name) {
                device.name = devices.synthesizeName(device)
              }

              if (! device.type) {
                device.type = device.uaDeviceType || 'desktop'
              }

              device.isCurrentDevice =
                device.sessionToken.toString('hex') === sessionToken.tokenId.toString('hex')

              device.lastAccessTimeFormatted = localizeTimestamp.format(device.lastAccessTime,
                request.headers['accept-language'])

              delete device.sessionToken
              delete device.uaBrowser
              delete device.uaBrowserVersion
              delete device.uaOS
              delete device.uaOSVersion
              delete device.uaDeviceType

              return butil.unbuffer(device)
            }))
          },
          reply
        )
      }
    },
    {
      method: 'POST',
      path: '/account/device/destroy',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            id: isA.string().length(32).regex(HEX_STRING).required()
          }
        },
        response: {
          schema: {}
        }
      },
      handler: function (request, reply) {
        log.begin('Account.deviceDestroy', request)
        var sessionToken = request.auth.credentials
        var uid = sessionToken.uid
        var id = request.payload.id
        var result

        return push.notifyDeviceDisconnected(uid, id)
          .catch(function () {})
          .then(
            function () {
              return db.deleteDevice(uid, id)
            }
          )
          .then(
            function (res) {
              result = res
              return request.emitMetricsEvent('device.deleted', {
                uid: uid.toString('hex'),
                device_id: id
              })
            }
          )
          .then(
            function () {
              return log.notifyAttachedServices('device:delete', request, {
                uid: uid,
                id: id,
                timestamp: Date.now()
              })
            }
          )
          .then(function () {
            return result
          })
          .then(reply, reply)
      }
    },
    {
      method: 'GET',
      path: '/recovery_email/status',
      config: {
        auth: {
          strategy: 'sessionTokenWithVerificationStatus'
        },
        validate: {
          query: {
            reason: isA.string().max(16).optional()
          }
        },
        response: {
          schema: {
            // There's code in the handler that checks for a valid email,
            // no point adding overhead by doing it again here.
            email: isA.string().required(),
            verified: isA.boolean().required(),
            sessionVerified: isA.boolean().optional(),
            emailVerified: isA.boolean().optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.RecoveryEmailStatus', request)
        var sessionToken = request.auth.credentials
        if (request.query && request.query.reason === 'push') {
          // only log recovery_email requests with 'push' to avoid sending too many requests.
          log.increment('recovery_email_reason.push')
          // log to the push namespace that account was verified via push
          log.info({
            op: 'push.pushToDevices',
            name: 'recovery_email_reason.push'
          })
        }

        cleanUpIfAccountInvalid()
          .then(createResponse)
          .done(reply, reply)

        function cleanUpIfAccountInvalid() {
          // Some historical bugs mean we've allowed creation
          // of accounts with invalid email addresses. These
          // can never be verified, so the best we can do is
          // to delete them so the browser will stop polling.
          if (!sessionToken.emailVerified) {
            if (!validators.isValidEmailAddress(sessionToken.email)) {
              return db.deleteAccount(sessionToken)
                .then(
                  function () {
                    // Act as though we deleted the account asynchronously
                    // and caused the sessionToken to become invalid.
                    throw error.invalidToken()
                  }
                )
            }
          }
          return P.resolve()
        }

        function createResponse() {

          var sessionVerified = sessionToken.tokenVerified
          var emailVerified = !!sessionToken.emailVerified

          // For backwards-compatibility reasons, the reported verification status
          // depends on whether the sessionToken was created with keys=true and
          // whether it has subsequently been verified.  If it was created with
          // keys=true then we musn't say verified=true until the session itself
          // has been verified.  Otherwise, desktop clients will attempt to use
          // an unverified session to connect to sync, and produce a very confusing
          // user experience.
          var isVerified = emailVerified
          if (sessionToken.mustVerify) {
            isVerified = isVerified && sessionVerified
          }

          return {
            email: sessionToken.email,
            verified: isVerified,
            sessionVerified: sessionVerified,
            emailVerified: emailVerified
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/recovery_email/resend_code',
      config: {
        auth: {
          strategy: 'sessionTokenWithVerificationStatus'
        },
        validate: {
          payload: {
            service: isA.string().max(16).alphanum().optional(),
            redirectTo: validators.redirectTo(config.smtp.redirectDomain).optional(),
            resume: isA.string().max(2048).optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.RecoveryEmailResend', request)
        var sessionToken = request.auth.credentials
        var service = request.payload.service || request.query.service

        // Choose which type of email and code to resend
        var code, func
        if (sessionToken.emailVerified && sessionToken.tokenVerified) {
          return reply({})
        }

        if (sessionToken.tokenVerificationId) {
          code = sessionToken.tokenVerificationId
        } else {
          code = sessionToken.emailCode
        }

        if (!sessionToken.emailVerified) {
          func = mailer.sendVerifyCode
        } else {
          func = mailer.sendVerifyLoginEmail
        }

        return customs.check(
          request,
          sessionToken.email,
          'recoveryEmailResendCode')
          .then(func.bind(
            mailer,
            sessionToken,
            code,
            userAgent.call({
              service: service,
              timestamp: Date.now(),
              redirectTo: request.payload.redirectTo,
              resume: request.payload.resume,
              acceptLanguage: request.app.acceptLanguage
            }, request.headers['user-agent'], log)
          ))
          .done(
            function () {
              reply({})
            },
            reply
          )
      }
    },
    {
      method: 'POST',
      path: '/recovery_email/verify_code',
      config: {
        validate: {
          payload: {
            uid: isA.string().max(32).regex(HEX_STRING).required(),
            code: isA.string().min(32).max(32).regex(HEX_STRING).required(),
            service: isA.string().max(16).alphanum().optional(),
            reminder: isA.string().max(32).alphanum().optional()
          }
        }
      },
      handler: function (request, reply) {
        var uidHex = request.payload.uid
        var uid = Buffer(uidHex, 'hex')
        var code = Buffer(request.payload.code, 'hex')
        var service = request.payload.service || request.query.service
        var reminder = request.payload.reminder || request.query.reminder

        log.begin('Account.RecoveryEmailVerify', request)
        db.account(uid)
          .then(
            function (account) {
              // This endpoint is not authenticated, so we need to look up
              // the target email address before we can check it with customs.
              return customs.check(request, account.email, 'recoveryEmailVerifyCode')
                .then(
                  function () {
                    return account
                  }
                )
            }
          )
          .then(
            function (account) {
              var isAccountVerification = butil.buffersAreEqual(code, account.emailCode)

              /**
               * Logic for account and token verification
               *
               * 1) Attempt to use code as tokenVerificationId to verify session.
               *
               * 2) An error is thrown if tokenVerificationId does not exist (check to see if email
               *    verification code) or the tokenVerificationId does not correlate to the
               *    account uid (damaged linked/spoofed account)
               *
               * 3) Verify account email if not already verified.
               */
              return db.verifyTokens(code, account)
                .then(function () {
                  if (! isAccountVerification) {
                    // Don't log sign-in confirmation success for the account verification case
                    log.info({
                      op: 'account.signin.confirm.success',
                      uid: uidHex,
                      code: request.payload.code
                    })
                    request.emitMetricsEvent('account.confirmed', {
                      uid: uidHex
                    })
                    push.notifyUpdate(uid, 'accountConfirm')
                  }
                })
                .catch(function (err) {
                  if (err.errno === error.ERRNO.INVALID_VERIFICATION_CODE && isAccountVerification) {
                    // The code is just for the account, not for any sessions
                    return true
                  }
                  log.error({
                    op: 'account.signin.confirm.invalid',
                    uid: uidHex,
                    code: request.payload.code,
                    error: err
                  })
                  throw err
                })
                .then(function () {

                  // If the account is already verified, the link may have been
                  // for sign-in confirmation or they may have been clicking a
                  // stale link. Silently succeed.
                  if (account.emailVerified) {
                    if (butil.buffersAreEqual(code, account.emailCode)) {
                      log.increment('account.already_verified')
                    }
                    return true
                  }

                  // Any matching code verifies the account
                  return db.verifyEmail(account)
                    .then(function () {
                      log.timing('account.verified', Date.now() - account.createdAt)
                      log.increment('account.verified')
                      return log.notifyAttachedServices('verified', request, {
                        email: account.email,
                        uid: account.uid,
                        locale: account.locale
                      })
                    })
                    .then(function () {
                      return request.emitMetricsEvent('account.verified', {
                        uid: uidHex
                      })
                    })
                    .then(function () {
                      if (reminder === 'first' || reminder === 'second') {
                        // if verified using a known reminder
                        var reminderOp = 'account.verified_reminder.' + reminder

                        log.increment(reminderOp)
                        // log to the mailer namespace that account was verified via a reminder
                        log.info({
                          op: 'mailer.send',
                          name: reminderOp
                        })
                        return request.emitMetricsEvent('account.reminder', {
                          uid: uidHex
                        })
                      }
                    })
                    .then(function () {
                      // send a push notification to all devices that the account changed
                      push.notifyUpdate(uid, 'accountVerify')
                      // remove verification reminders
                      verificationReminder.delete({
                        uid: uidHex
                      }).catch(function (err) {
                        log.error({ op: 'Account.RecoveryEmailVerify', err: err })
                      })
                    })
                    .then(function () {
                      // Our post-verification email is very specific to sync,
                      // so only send it if we're sure this is for sync.
                      if (service === 'sync') {
                        return mailer.sendPostVerifyEmail(
                          account.email,
                          {
                            acceptLanguage: request.app.acceptLanguage
                          }
                        )
                      }
                    })
                })
            }
          )
          .done(
            function () {
              reply({})
            },
            reply
          )
      }
    },
    {
      method: 'POST',
      path: '/account/unlock/resend_code',
      handler: function (request, reply) {
        log.error({ op: 'Account.UnlockCodeResend', request: request })
        reply(error.gone())
      }
    },
    {
      method: 'POST',
      path: '/account/unlock/verify_code',
      handler: function (request, reply) {
        log.error({ op: 'Account.UnlockCodeVerify', request: request })
        reply(error.gone())
      }
    },
    {
      method: 'POST',
      path: '/account/login/send_unblock_code',
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            metricsContext: METRICS_CONTEXT_SCHEMA
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.SendUnblockCode', request)

        var email = request.payload.email
        var ip = request.app.clientAddress
        var emailRecord

        return customs.check(request, email, 'sendUnblockCode')
          .then(lookupAccount)
          .then(createUnblockCode)
          .then(mailUnblockCode)
          .then(() => request.emitMetricsEvent('account.login.sentUnblockCode'))
          .done(() => {
            reply({})
          }, reply)

        function lookupAccount() {
          return db.emailRecord(email)
            .then((record) => {
              emailRecord = record
              return record.uid
            })
        }

        function createUnblockCode(uid) {

          if (features.isSigninUnblockEnabledForUser(uid, email, request)) {
            return db.createUnblockCode(uid)
          } else {
            throw error.featureNotEnabled()
          }
        }

        function mailUnblockCode(code) {
          return getGeoData(ip)
            .then((geoData) => {
              return mailer.sendUnblockCode(emailRecord, code, userAgent.call({
                acceptLanguage: request.app.acceptLanguage,
                ip: ip,
                location: geoData.location,
                timeZone: geoData.timeZone
              }, request.headers['user-agent'], log))
            })
        }
      }
    },
    {
      method: 'POST',
      path: '/account/login/reject_unblock_code',
      config: {
        validate: {
          payload: {
            uid: isA.string().max(32).regex(HEX_STRING).required(),
            unblockCode: isA.string().regex(BASE_36).length(unblockCodeLen).required()
          }
        }
      },
      handler: function (request, reply) {
        var uid = Buffer(request.payload.uid, 'hex')
        var code = request.payload.unblockCode.toUpperCase()

        log.begin('Account.RejectUnblockCode', request)
        db.consumeUnblockCode(uid, code)
          .then(
            () => {
              log.info({
                op: 'account.login.rejectedUnblockCode',
                uid: request.payload.uid,
                unblockCode: code
              })
              return {}
            }
          ).done(reply, reply)
      }
    },
    {
      method: 'POST',
      path: '/account/reset',
      config: {
        auth: {
          strategy: 'accountResetToken',
          payload: 'required'
        },
        validate: {
          payload: {
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required(),
            sessionToken: isA.boolean().optional()
          }
        }
      },
      handler: function accountReset(request, reply) {
        log.begin('Account.reset', request)
        var accountResetToken = request.auth.credentials
        var authPW = Buffer(request.payload.authPW, 'hex')
        var authSalt = crypto.randomBytes(32)
        var password = new Password(authPW, authSalt, config.verifierVersion)
        var account, sessionToken, keyFetchToken, verifyHash, wrapKb, devicesToNotify
        var hasSessionToken = request.payload.sessionToken

        return fetchDevicesToNotify()
          .then(resetAccountData)
          .then(createSessionToken)
          .then(createKeyFetchToken)
          .then(recordSecurityEvent)
          .then(createResponse)
          .done(reply, reply)

        function fetchDevicesToNotify() {
          // We fetch the devices to notify before resetAccountData() because
          // db.resetAccount() deletes all the devices saved in the account.
          return db.devices(accountResetToken.uid)
            .then(
              function(devices) {
                devicesToNotify = devices
              }
            )
        }

        function resetAccountData () {
          return password.verifyHash()
            .then(
              function (verifyHashData) {
                verifyHash = verifyHashData

                return db.resetAccount(
                  accountResetToken,
                  {
                    authSalt: authSalt,
                    verifyHash: verifyHash,
                    wrapWrapKb: crypto.randomBytes(32),
                    verifierVersion: password.version
                  }
                )
              }
            )
            .then(
              function () {
                // Notify the devices that the account has changed.
                push.notifyPasswordReset(accountResetToken.uid, devicesToNotify)

                return db.account(accountResetToken.uid)
              }
            )
            .then(
              function (accountData) {
                account = accountData
                return request.emitMetricsEvent('account.reset', {
                  uid: account.uid.toString('hex')
                })
              }
            )
            .then(
              function () {
                return log.notifyAttachedServices('reset', request, {
                  uid: account.uid.toString('hex') + '@' + config.domain,
                  generation: account.verifierSetAt
                })
              }
            )
            .then(
              function () {
                return customs.reset(account.email)
              }
            )
            .then(
              function () {
                return password.unwrap(account.wrapWrapKb)
              }
            )
            .then(
              function (wrapKbData) {
                wrapKb = wrapKbData
              }
            )
        }

        function createSessionToken () {
          if (hasSessionToken) {
            // Since the only way to reach this point is clicking a
            // link from the user's email, we create a verified sessionToken
            var sessionTokenOptions = {
              uid: account.uid,
              email: account.email,
              emailCode: account.emailCode,
              emailVerified: account.emailVerified,
              verifierSetAt: account.verifierSetAt
            }

            return db.createSessionToken(sessionTokenOptions, request.headers['user-agent'])
              .then(
                function (result) {
                  sessionToken = result
                }
              )
          }
        }

        function createKeyFetchToken () {
          if (requestHelper.wantsKeys(request)) {
            if (!hasSessionToken) {
              // Sanity-check: any client requesting keys,
              // should also be requesting a sessionToken.
              throw error.missingRequestParameter('sessionToken')
            }
            return db.createKeyFetchToken({
              uid: account.uid,
              kA: account.kA,
              wrapKb: wrapKb,
              emailVerified: account.emailVerified
            })
            .then(
              function (result) {
                keyFetchToken = result
              }
            )
          }
        }

        function recordSecurityEvent() {
          if (securityHistoryEnabled) {
             // don't block response recording db event
            db.securityEvent({
              name: 'account.reset',
              uid: account.uid,
              ipAddr: request.app.clientAddress,
              tokenId: sessionToken && sessionToken.tokenId
            })
          }
        }

        function createResponse () {
          // If no sessionToken, this could be a legacy client
          // attempting to reset an account password, return legacy response.
          if (!hasSessionToken) {
            return {}
          }


          var response = {
            uid: sessionToken.uid.toString('hex'),
            sessionToken: sessionToken.data.toString('hex'),
            verified: sessionToken.emailVerified,
            authAt: sessionToken.lastAuthAt()
          }

          if (requestHelper.wantsKeys(request)) {
            response.keyFetchToken = keyFetchToken.data.toString('hex')
          }

          return response
        }
      }
    },
    {
      method: 'POST',
      path: '/account/destroy',
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required()
          }
        }
      },
      handler: function accountDestroy(request, reply) {
        log.begin('Account.destroy', request)
        var form = request.payload
        var authPW = Buffer(form.authPW, 'hex')
        var uid
        customs.check(
          request,
          form.email,
          'accountDestroy')
          .then(db.emailRecord.bind(db, form.email))
          .then(
            function (emailRecord) {
              uid = emailRecord.uid.toString('hex')

              return checkPassword(emailRecord, authPW, request.app.clientAddress)
                .then(
                  function (match) {
                    if (!match) {
                      throw error.incorrectPassword(emailRecord.email, form.email)
                    }
                    return db.deleteAccount(emailRecord)
                  }
                )
                .then(
                  function () {
                    return log.notifyAttachedServices('delete', request, {
                      uid: uid + '@' + config.domain
                    })
                  }
                )
                .then(
                  function () {
                    return request.emitMetricsEvent('account.deleted', {
                      uid: uid
                    })
                  }
                )
                .then(
                  function () {
                    return {}
                  }
                )
            },
            function (err) {
              if (err.errno === error.ERRNO.ACCOUNT_UNKNOWN) {
                customs.flag(request.app.clientAddress, {
                  email: form.email,
                  errno: err.errno
                })
              }
              throw err
            }
          )
          .done(reply, reply)
      }
    }
  ]

  if (config.isProduction) {
    delete routes[0].config.validate.payload.preVerified
  } else {
    // programmatic account lockout was only available in
    // non-production mode.
    routes.push({
      method: 'POST',
      path: '/account/lock',
      handler: function (request, reply) {
        log.error({ op: 'Account.lock', request: request })
        reply(error.gone())
      }
    })
  }

  return routes
}

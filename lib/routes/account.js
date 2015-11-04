/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var validators = require('./validators')
var HEX_STRING = validators.HEX_STRING
var BASE64_JWT = validators.BASE64_JWT

var butil = require('../crypto/butil')
var openid = require('openid')
var url = require('url')

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
  checkPassword
  ) {

  var OPENID_EXTENSIONS = [
    new openid.AttributeExchange(
      {
        'http://axschema.org/contact/email': 'optional'
      }
    )
  ]

  function isOpenIdProviderAllowed(id) {
    if (typeof(id) !== 'string') { return false }
    var hostname = url.parse(id).hostname
    return config.openIdProviders.some(
      function (allowed) {
        return hostname === url.parse(allowed).hostname
      }
    )
  }

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
            preVerifyToken: isA.string().max(2048).regex(BASE64_JWT).optional()
          }
        }
      },
      handler: function accountCreate(request, reply) {
        log.begin('Account.create', request)
        var form = request.payload
        var email = form.email
        var authSalt = crypto.randomBytes(32)
        var authPW = Buffer(form.authPW, 'hex')
        var locale = request.app.acceptLanguage
        var userAgentString = request.headers['user-agent']
        var service = form.service || request.query.service
        var preverified, password, account
        customs.check(
          request.app.clientAddress,
          email,
          'accountCreate'
          )
          .then(db.emailRecord.bind(db, email))
          .then(
            function (emailRecord) {
              // account exists
              if (emailRecord.emailVerified) { throw error.accountExists(email) }
              request.app.accountRecreated = true
              return db.deleteAccount(emailRecord)
            },
            function (err) {
              // unknown account
              if (err.errno !== 102) { throw err }
            }
          )
          .then(isPreVerified.bind(null, form.email, form.preVerifyToken))
          .then(
            function (result) {
              preverified = result
              password = new Password(authPW, authSalt, config.verifierVersion)
              return password.verifyHash()
            }
          )
          .then(
            function (verifyHash) {
              // We're seeing a surprising number of accounts created
              // without a proper locale.  Log details to help debug this.
              if (!locale) {
                log.info({
                  op: 'account.create.emptyLocale',
                  email: email,
                  locale: locale,
                  agent: userAgentString
                })
              }
              return db.createAccount(
                {
                  uid: uuid.v4('binary'),
                  createdAt: Date.now(),
                  email: email,
                  emailCode: crypto.randomBytes(16),
                  emailVerified: form.preVerified || preverified,
                  kA: crypto.randomBytes(32),
                  wrapWrapKb: crypto.randomBytes(32),
                  accountResetToken: null,
                  passwordForgotToken: null,
                  authSalt: authSalt,
                  verifierVersion: password.version,
                  verifyHash: verifyHash,
                  verifierSetAt: Date.now(),
                  locale: locale
                }
              )
            }
          )
          .then(
            function (result) {
              account = result
              log.activityEvent('account.created', request, {
                uid: account.uid.toString('hex')
              })
              if (account.emailVerified) {
                log.event('verified', { email: account.email, uid: account.uid, locale: account.locale })
              }
              if (service === 'sync') {
                log.event('login', {
                  service: 'sync',
                  uid: account.uid,
                  email: account.email,
                  deviceCount: 1,
                  userAgent: request.headers['user-agent']
                })
              }
              return db.createSessionToken(
                {
                  uid: account.uid,
                  email: account.email,
                  emailCode: account.emailCode,
                  emailVerified: account.emailVerified,
                  verifierSetAt: account.verifierSetAt
                },
                userAgentString
              )
            }
          )
          .then(
            function (sessionToken) {
              if (request.query.keys !== 'true') {
                return P.resolve({
                  account: account,
                  sessionToken: sessionToken
                })
              }
              return password.unwrap(account.wrapWrapKb)
                .then(
                  function (wrapKb) {
                    return db.createKeyFetchToken(
                      {
                        uid: account.uid,
                        kA: account.kA,
                        wrapKb: wrapKb,
                        emailVerified: account.emailVerified
                      }
                    )
                  }
                )
                .then(
                  function (keyFetchToken) {
                    return {
                      account: account,
                      sessionToken: sessionToken,
                      keyFetchToken: keyFetchToken
                    }
                  }
                )
            }
          )
          .then(
            function (response) {
              if (!response.account.emailVerified) {
                mailer.sendVerifyCode(response.account, response.account.emailCode, {
                  service: form.service || request.query.service,
                  redirectTo: form.redirectTo,
                  resume: form.resume,
                  acceptLanguage: request.app.acceptLanguage
                })
                .catch(
                  function (err) {
                    log.error({ op: 'mailer.sendVerifyCode.1', err: err })
                  }
                )
              }
              return response
            }
          )
          .done(
            function (response) {
              var account = response.account
              reply(
                {
                  uid: account.uid.toString('hex'),
                  sessionToken: response.sessionToken.data.toString('hex'),
                  keyFetchToken: response.keyFetchToken ?
                    response.keyFetchToken.data.toString('hex')
                    : undefined,
                  authAt: response.sessionToken.lastAuthAt()
                }
              )
            },
            reply
          )
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
            service: isA.string().max(16).alphanum().optional(),
            reason: isA.string().max(16).optional()
          }
        },
        response: {
          schema: {
            uid: isA.string().regex(HEX_STRING).required(),
            sessionToken: isA.string().regex(HEX_STRING).required(),
            keyFetchToken: isA.string().regex(HEX_STRING).optional(),
            verified: isA.boolean().required(),
            authAt: isA.number().integer()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.login', request)
        var form = request.payload
        var email = form.email
        var authPW = Buffer(form.authPW, 'hex')
        var service = request.payload.service || request.query.service
        var emailRecord
        customs.check(
          request.app.clientAddress,
          email,
          'accountLogin')
          .then(db.emailRecord.bind(db, email))
          .then(
            function (result) {
              emailRecord = result
              if(email !== emailRecord.email) {
                throw error.incorrectPassword(emailRecord.email, email)
              }
              if (emailRecord.lockedAt) {
                throw error.lockedAccount()
              }
              return checkPassword(emailRecord, authPW, request.app.clientAddress)
            }
          )
          .then(
            function (match) {
              if (!match) {
                throw error.incorrectPassword(emailRecord.email, email)
              }
              var uid = emailRecord.uid.toString('hex')
              log.activityEvent('account.login', request, {
                uid: uid
              })
              return db.createSessionToken(
                {
                  uid: emailRecord.uid,
                  email: emailRecord.email,
                  emailCode: emailRecord.emailCode,
                  emailVerified: emailRecord.emailVerified,
                  verifierSetAt: emailRecord.verifierSetAt
                },
                request.headers['user-agent']
              )
            }
          )
          .then(
            function (sessionToken) {
              if (request.query.keys !== 'true') {
                return P.resolve({
                  sessionToken: sessionToken
                })
              }
              var password = new Password(
                authPW,
                emailRecord.authSalt,
                emailRecord.verifierVersion
              )
              return password.unwrap(emailRecord.wrapWrapKb)
                .then(
                  function (wrapKb) {
                    return db.createKeyFetchToken(
                      {
                        uid: emailRecord.uid,
                        kA: emailRecord.kA,
                        wrapKb: wrapKb,
                        emailVerified: emailRecord.emailVerified
                      }
                    )
                  }
                )
                .then(
                  function (keyFetchToken) {
                    return {
                      sessionToken: sessionToken,
                      keyFetchToken: keyFetchToken
                    }
                  }
                )
            }
          )
          .then(
            function (tokens) {
              if (service === 'sync' && request.payload.reason === 'signin') {
                db.sessions(emailRecord.uid)
                  .then(function (sessions) {
                    log.event('login', {
                      service: 'sync',
                      uid: emailRecord.uid,
                      email: emailRecord.email,
                      deviceCount: sessions.length,
                      userAgent: request.headers['user-agent']
                    })
                  })
              }

              return tokens
            }
          )
          .done(
            function (tokens) {
              reply(
                {
                  uid: tokens.sessionToken.uid.toString('hex'),
                  sessionToken: tokens.sessionToken.data.toString('hex'),
                  keyFetchToken: tokens.keyFetchToken ?
                    tokens.keyFetchToken.data.toString('hex')
                    : undefined,
                  verified: tokens.sessionToken.emailVerified,
                  authAt: tokens.sessionToken.lastAuthAt()
                }
              )
            },
            reply
          )
      }
    },
    {
      method: 'GET',
      path: '/account/openid/login',
      handler: function (request, reply) {

        var unverifiedId = request.url.query && request.url.query['openid.claimed_id']
        if (!isOpenIdProviderAllowed(unverifiedId)) {
          log.warn({op: 'Account.openid', id: unverifiedId })
          return reply({ err: 'This OpenID Provider is not allowed' }).code(400)
        }

        openid.verifyAssertion(
          url.format(request.url),
          function (err, assertion) {
            if (err || !assertion || !assertion.authenticated) {
              log.warn({ op: 'Account.openid', err: err, assertion: assertion })
              return reply({ err: err.message || 'Unknown Account' }).code(400)
            }
            var id = assertion.claimedIdentifier
            var locale = request.app.acceptLanguage

            db.openIdRecord(id)
              .then(
                function (record) {
                  return record
                },
                function (err) {
                  if (err.errno !== 102) {
                    throw err
                  }
                  var uid = uuid.v4('binary')
                  var email = assertion.email || uid.toString('hex') + '@uid.' + config.domain
                  var authSalt = crypto.randomBytes(32)
                  var kA = crypto.randomBytes(32)
                  return db.createAccount(
                    {
                      uid: uid,
                      createdAt: Date.now(),
                      email: email,
                      emailCode: crypto.randomBytes(16),
                      emailVerified: true,
                      kA: kA,
                      wrapWrapKb: crypto.randomBytes(32),
                      accountResetToken: null,
                      passwordForgotToken: null,
                      authSalt: authSalt,
                      verifierVersion: 0,
                      verifyHash: crypto.randomBytes(32),
                      openId: id,
                      verifierSetAt: Date.now(),
                      locale: locale
                    }
                  )
                }
              )
              .then(
                function (account) {
                  return db.createSessionToken(
                    {
                      uid: account.uid,
                      email: account.email,
                      emailCode: account.emailCode,
                      emailVerified: true,
                      verifierSetAt: account.verifierSetAt
                    }
                  )
                  .then(
                    function (sessionToken) {
                      if (request.query.keys !== 'true') {
                        return P.resolve({
                          sessionToken: sessionToken
                        })
                      }
                      return db.createKeyFetchToken(
                        {
                          uid: account.uid,
                          kA: account.kA,
                          // wrapKb is undefined without a password.
                          // wrapWrapKb has the properties we need for this
                          // value; Its stable, random, and will change on
                          // account reset.
                          wrapKb: account.wrapWrapKb,
                          emailVerified: true
                        }
                      )
                      .then(
                        function (keyFetchToken) {
                          return {
                            sessionToken: sessionToken,
                            keyFetchToken: keyFetchToken,
                            unwrapBKey: butil.xorBuffers(
                              account.kA,
                              account.wrapWrapKb
                            )
                            // The browser using these values for unwrapBKey
                            // and wrapKb (from above) will yield kA
                            // as the Sync key instead of kB
                          }
                        }
                      )
                    }
                  )
                  .then(
                    function (tokens) {
                      reply(
                        {
                          uid: tokens.sessionToken.uid.toString('hex'),
                          email: account.email,
                          session: tokens.sessionToken.data.toString('hex'),
                          key: tokens.keyFetchToken ?
                            tokens.keyFetchToken.data.toString('hex')
                            : undefined,
                          unwrap: tokens.unwrapBKey ?
                            tokens.unwrapBKey.toString('hex')
                            : undefined
                        }
                      )
                    }
                  )
                }
              )
              .catch(
                function (err) {
                  log.error({ op: 'Account.openid', err: err })
                  reply({
                    err: err.message
                  }).code(500)
                }
              )
          },
          true, // stateless
          OPENID_EXTENSIONS,
          false // strict
        )
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
                if (err.errno === 102) {
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
          var scopes = auth.credentials.scopes
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
          strategy: 'keyFetchToken'
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
        if (!keyFetchToken.emailVerified) {
          // don't delete the token on use until the account is verified
          return reply(error.unverifiedAccount())
        }
        db.deleteKeyFetchToken(keyFetchToken)
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
      method: 'GET',
      path: '/recovery_email/status',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: {
            email: validators.email().required(),
            verified: isA.boolean().required()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.RecoveryEmailStatus', request)
        var sessionToken = request.auth.credentials
        reply(
          {
            email: sessionToken.email,
            verified: sessionToken.emailVerified
          }
        )
      }
    },
    {
      method: 'POST',
      path: '/recovery_email/resend_code',
      config: {
        auth: {
          strategy: 'sessionToken'
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
        if (sessionToken.emailVerified ||
            Date.now() - sessionToken.verifierSetAt < config.smtp.resendBlackoutPeriod) {
          return reply({})
        }
        customs.check(
          request.app.clientAddress,
          sessionToken.email,
          'recoveryEmailResendCode')
          .then(
            mailer.sendVerifyCode.bind(
              mailer,
              sessionToken,
              sessionToken.emailCode,
              {
                service: service,
                redirectTo: request.payload.redirectTo,
                resume: request.payload.resume,
                acceptLanguage: request.app.acceptLanguage
              }
            )
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
      path: '/recovery_email/verify_code',
      config: {
        validate: {
          payload: {
            uid: isA.string().max(32).regex(HEX_STRING).required(),
            code: isA.string().min(32).max(32).regex(HEX_STRING).required()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.RecoveryEmailVerify', request)
        var uid = request.payload.uid
        var code = Buffer(request.payload.code, 'hex')
        db.account(Buffer(uid, 'hex'))
          .then(
            function (account) {
              // If the account is already verified, they may be e.g.
              // clicking a stale link.  Silently succeed.
              if (account.emailVerified) {
                log.increment('account.already_verified')
                return true
              }
              if (!butil.buffersAreEqual(code, account.emailCode)) {
                throw error.invalidVerificationCode()
              }
              log.timing('account.verified', Date.now() - account.createdAt)
              log.event('verified', { email: account.email, uid: account.uid, locale: account.locale })
              log.increment('account.verified')
              return db.verifyEmail(account)
                .then(mailer.sendPostVerifyEmail.bind(
                    mailer,
                    account.email,
                    {
                      acceptLanguage: request.app.acceptLanguage
                    }
                  )
                )
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
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            service: isA.string().max(16).alphanum().optional(),
            redirectTo: validators.redirectTo(config.smtp.redirectDomain).optional(),
            resume: isA.string().max(2048).optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.UnlockCodeResend', request)
        var email = request.payload.email
        var emailRecord
        var service = request.payload.service || request.query.service

        customs.check(
          request.app.clientAddress,
          email,
          'accountUnlockResendCode')
          .then(
            db.emailRecord.bind(db, email)
          )
          .then(
            function (_emailRecord) {
              if (! _emailRecord.lockedAt) {
                throw error.accountNotLocked(email)
              }

              emailRecord = _emailRecord
              return db.unlockCode(emailRecord)
            }
          )
          .then(
            function (unlockCode) {
              return mailer.sendUnlockCode(
                emailRecord,
                unlockCode,
                {
                  service: service,
                  redirectTo: request.payload.redirectTo,
                  resume: request.payload.resume,
                  acceptLanguage: request.app.acceptLanguage
                }
              )
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
      path: '/account/unlock/verify_code',
      config: {
        validate: {
          payload: {
            uid: isA.string().max(32).regex(HEX_STRING).required(),
            code: isA.string().min(32).max(32).regex(HEX_STRING).required()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.UnlockCodeVerify', request)
        var uid = request.payload.uid
        var code = Buffer(request.payload.code, 'hex')
        db.account(Buffer(uid, 'hex'))
          .then(
            function (account) {
              // If the account isn't actually locked, they may be
              // e.g. clicking a stale link.  Silently succeed.
              if (! account.lockedAt) {
                return
              }
              return db.unlockCode(account)
                .then(
                  function (expectedCode) {
                    if (!butil.buffersAreEqual(code, expectedCode)) {
                      throw error.invalidVerificationCode()
                    }
                    log.info({
                      op: 'account.unlock',
                      email: account.email,
                      uid: account.uid
                    })
                    return db.unlockAccount(account)
                  }
                )
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
      path: '/account/reset',
      config: {
        auth: {
          strategy: 'accountResetToken',
          payload: 'required'
        },
        validate: {
          payload: {
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required()
          }
        }
      },
      handler: function accountReset(request, reply) {
        log.begin('Account.reset', request)
        var accountResetToken = request.auth.credentials
        var authPW = Buffer(request.payload.authPW, 'hex')
        var authSalt = crypto.randomBytes(32)
        var password = new Password(authPW, authSalt, config.verifierVersion)
        return password.verifyHash()
          .then(
            function (verifyHash) {
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
              return db.account(accountResetToken.uid)
            }
          )
          .then(
            function (accountRecord) {
              return customs.reset(accountRecord.email)
            }
          )
          .then(
            function () {
              return {}
            }
          )
          .done(reply, reply)
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
        db.emailRecord(form.email)
          .then(
            function (emailRecord) {
              if (emailRecord.lockedAt) {
                throw error.lockedAccount()
              }

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
                    log.event('delete', { uid: emailRecord.uid.toString('hex') + '@' + config.domain })
                    return {}
                  }
                )
            }
          )
          .done(reply, reply)
      }
    }
  ]

  if (config.isProduction) {
    delete routes[0].config.validate.payload.preVerified
  } else {
    // programmatic account lockout is only available in non-production mode.
    routes.push({
      method: 'POST',
      path: '/account/lock',
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.lock', request)
        var form = request.payload
        var email = form.email
        var authPW = Buffer(form.authPW, 'hex')

        customs.check(
          request.app.clientAddress,
          email,
          'accountLock')
          .then(db.emailRecord.bind(db, email))
          .then(
            function (emailRecord) {
              // The account is already locked, silently succeed.
              if (emailRecord.lockedAt) {
                return true
              }
              return checkPassword(emailRecord, authPW, request.app.clientAddress)
              .then(
                function (match) {
                  // a bit of a strange one, only lock the account if the
                  // password matches, otherwise let customs handle any account
                  // lock.
                  if (! match) {
                    throw error.incorrectPassword(emailRecord.email, email)
                  }
                  log.info({
                    op: 'account.lock',
                    email: emailRecord.email,
                    uid: emailRecord.uid.toString('hex')
                  })
                  return db.lockAccount(emailRecord)
                }
              )
            }
          )
          .done(
            function () {
              reply({})
            },
            reply
          )
      }
    })
  }

  return routes
}

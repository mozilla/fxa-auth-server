/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var validators = require('./validators')
var HEX_STRING = validators.HEX_STRING
var BASE64_JWT = validators.BASE64_JWT

var butil = require('../crypto/butil')

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
  redirectDomain,
  verifierVersion,
  isProduction,
  domain,
  resendBlackoutPeriod,
  customs,
  isPreVerified,
  checkPassword
  ) {

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
            redirectTo: validators.redirectTo(redirectDomain).optional(),
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
            function (preverified) {
              var password = new Password(authPW, authSalt, verifierVersion)
              return password.verifyHash()
              .then(
                function (verifyHash) {
                  // We're seeing a surprising number of accounts created
                  // without a proper locale.  Log details to help debug this.
                  if (!locale) {
                    log.info({
                      op: 'account.create.emptyLocale',
                      email: email,
                      locale: locale,
                      agent: request.headers['user-agent']
                    });
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
                      devices: {},
                      accountResetToken: null,
                      passwordForgotToken: null,
                      authSalt: authSalt,
                      verifierVersion: password.version,
                      verifyHash: verifyHash,
                      verifierSetAt: Date.now(),
                      locale: locale
                    }
                  )
                  .then(
                    function (account) {
                      if (account.emailVerified) {
                        log.event('verified', { email: account.email, uid: account.uid, locale: account.locale })
                      }
                      return db.createSessionToken(
                        {
                          uid: account.uid,
                          email: account.email,
                          emailCode: account.emailCode,
                          emailVerified: account.emailVerified,
                          verifierSetAt: account.verifierSetAt
                        }
                      )
                      .then(
                        function (sessionToken) {
                          if (request.query.keys !== 'true') {
                            return P({
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
                    }
                  )
                }
              )
            }
          )
          .then(
            function (response) {
              if (!response.account.emailVerified) {
                mailer.sendVerifyCode(response.account, response.account.emailCode, {
                  service: form.service,
                  redirectTo: form.redirectTo,
                  resume: form.resume,
                  acceptLanguage: request.app.acceptLanguage
                })
                .fail(
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
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required()
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
        customs.check(
          request.app.clientAddress,
          email,
          'accountLogin')
          .then(db.emailRecord.bind(db, email))
          .then(
            function (emailRecord) {
              if (emailRecord.lockedAt) {
                throw error.lockedAccount()
              }
              return checkPassword(emailRecord, authPW, request.app.clientAddress)
                .then(
                  function (match) {
                    if (!match) {
                      throw error.incorrectPassword(emailRecord.email, email)
                    }
                    return db.createSessionToken(
                      {
                        uid: emailRecord.uid,
                        email: emailRecord.email,
                        emailCode: emailRecord.emailCode,
                        emailVerified: emailRecord.emailVerified,
                        verifierSetAt: emailRecord.verifierSetAt
                      }
                    )
                  }
                )
                .then(
                  function (sessionToken) {
                    if (request.query.keys !== 'true') {
                      return P({
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
      path: '/account/devices',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: {
            devices: isA.array()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.devices', request)
        var sessionToken = request.auth.credentials
        db.accountDevices(sessionToken.uid)
          .done(
            function (devices) {
              reply(
                {
                  devices: Object.keys(devices)
                }
              )
            },
            reply
          )
      }
    },
    {
      method: 'GET',
      path: '/account/status',
      config: {
        auth: {
          mode: 'optional',
          strategies: [
            'sessionToken',
            'oauthToken'
          ]
        },
        validate: {
          query: {
            uid: isA.string().min(32).max(32).regex(HEX_STRING)
          }
        }
      },
      handler: function (request, reply) {
        var auth = request.auth
        // Authenticated users can view their own data.
        if (auth.isAuthenticated && auth.strategy === 'sessionToken') {
          var sessionToken = auth.credentials
          reply({
            exists: true,
            email: sessionToken.email,
            locale: sessionToken.locale
          })
        }
        else if (request.query.uid) {
          var uid = Buffer(request.query.uid, 'hex')
          db.account(uid)
            .done(
              function (account) {
                var resp = { exists: true }
                // Bearers of oauth tokens can view account profile data.
                if (auth.isAuthenticated && auth.strategy === 'oauthToken') {
                  var oauthToken = auth.credentials
                  if (oauthToken.user !== request.query.uid) {
                    return reply(error.invalidToken())
                  }
                  if (oauthToken.scopes.indexOf('profile') === -1) {
                    return reply(error.invalidToken())
                  }
                  resp.email = account.email
                  resp.locale = account.locale
                }
                reply(resp)
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
            redirectTo: validators.redirectTo(redirectDomain).optional(),
            resume: isA.string().max(2048).optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.RecoveryEmailResend', request)
        var sessionToken = request.auth.credentials
        if (sessionToken.emailVerified ||
            Date.now() - sessionToken.verifierSetAt < resendBlackoutPeriod) {
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
                service: request.payload.service,
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
                return true
              }
              if (!butil.buffersAreEqual(code, account.emailCode)) {
                throw error.invalidVerificationCode()
              }
              log.event('verified', { email: account.email, uid: account.uid, locale: account.locale })
              return db.verifyEmail(account)
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
            redirectTo: validators.redirectTo(redirectDomain).optional(),
            resume: isA.string().max(2048).optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Account.UnlockCodeResend', request)
        var email = request.payload.email
        var emailRecord

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
                  service: request.payload.service,
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
        var password = new Password(authPW, authSalt, verifierVersion)
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
                    log.event('delete', { uid: emailRecord.uid.toString('hex') + '@' + domain })
                    return {}
                  }
                )
            }
          )
          .done(reply, reply)
      }
    }
  ]

  if (isProduction) {
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
    });
  }

  return routes
}

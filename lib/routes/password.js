/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var validators = require('./validators')
var HEX_STRING = validators.HEX_STRING

var crypto = require('crypto')
var butil = require('../crypto/butil')
var P = require('../promise')
var requestHelper = require('../routes/utils/request_helper')

module.exports = function (
  log,
  isA,
  error,
  db,
  Password,
  redirectDomain,
  mailer,
  verifierVersion,
  customs,
  checkPassword,
  push
  ) {

  var Tokens = require('../tokens/index')(log)

  function failVerifyAttempt(passwordForgotToken) {
    return (passwordForgotToken.failAttempt()) ?
      db.deletePasswordForgotToken(passwordForgotToken) :
      db.updatePasswordForgotToken(passwordForgotToken)
  }

  var routes = [
    {
      method: 'POST',
      path: '/password/change/start',
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            oldAuthPW: isA.string().min(64).max(64).regex(HEX_STRING).required()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Password.changeStart', request)
        var form = request.payload
        var oldAuthPW = Buffer(form.oldAuthPW, 'hex')

        customs.check(
          request,
          form.email,
          'passwordChange')
          .then(db.emailRecord.bind(db, form.email))
          .then(
            function (emailRecord) {
              return checkPassword(emailRecord, oldAuthPW, request.app.clientAddress)
              .then(
                function (match) {
                  if (!match) {
                    throw error.incorrectPassword(emailRecord.email, form.email)
                  }
                  var password = new Password(
                    oldAuthPW,
                    emailRecord.authSalt,
                    emailRecord.verifierVersion
                  )
                  return password.unwrap(emailRecord.wrapWrapKb)
                }
              )
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
                  .then(
                    function (keyFetchToken) {
                      return db.createPasswordChangeToken({
                          uid: emailRecord.uid
                        }
                      )
                      .then(
                        function (passwordChangeToken) {
                          return {
                            keyFetchToken: keyFetchToken,
                            passwordChangeToken: passwordChangeToken
                          }
                        }
                      )
                    }
                  )
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
          .done(
            function (tokens) {
              reply(
                {
                  keyFetchToken: tokens.keyFetchToken.data.toString('hex'),
                  passwordChangeToken: tokens.passwordChangeToken.data.toString('hex'),
                  verified: tokens.keyFetchToken.emailVerified
                }
              )
            },
            reply
          )
      }
    },
    {
      method: 'POST',
      path: '/password/change/finish',
      config: {
        auth: {
          strategy: 'passwordChangeToken'
        },
        validate: {
          payload: {
            authPW: isA.string().min(64).max(64).regex(HEX_STRING).required(),
            wrapKb: isA.string().min(64).max(64).regex(HEX_STRING).required(),
            sessionToken: isA.string().min(64).max(64).regex(HEX_STRING).optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Password.changeFinish', request)
        var passwordChangeToken = request.auth.credentials
        var authPW = Buffer(request.payload.authPW, 'hex')
        var wrapKb = Buffer(request.payload.wrapKb, 'hex')
        var authSalt = crypto.randomBytes(32)
        var sessionTokenId = request.payload.sessionToken
        var password = new Password(authPW, authSalt, verifierVersion)
        var wantsKeys = requestHelper.wantsKeys(request)
        var account, verifyHash, sessionToken, keyFetchToken, verifiedStatus,
            devicesToNotify

        getSessionVerificationStatus()
          .then(fetchDevicesToNotify)
          .then(changePassword)
          .then(notifyAccount)
          .then(createSessionToken)
          .then(createKeyFetchToken)
          .then(createResponse)
          .done(reply, reply)

        function getSessionVerificationStatus() {
          if (sessionTokenId) {
            var tokenId = Buffer(sessionTokenId, 'hex')
            return db.sessionTokenWithVerificationStatus(tokenId)
              .catch(
                function (err) {
                  // Older versions of content-server passed the raw token data
                  // rather than the id; handle both for b/w compatibility.
                  if (err.errno !== error.ERRNO.INVALID_TOKEN) {
                    throw err
                  }
                  return Tokens.SessionToken.fromHex(sessionTokenId)
                    .then(
                      function (tokenData) {
                        tokenId = tokenData.tokenId
                        return db.sessionTokenWithVerificationStatus(tokenId)
                      }
                    )
                }
              )
              .then(
                function (tokenData) {
                  verifiedStatus = tokenData.tokenVerified
                }
              )
              .catch(
                function () {
                  verifiedStatus = false
                }
              )
          } else {
            // To keep backwards compatibility, default to creating a verified
            // session if no sessionToken is passed
            verifiedStatus = true
            return P.resolve()
          }
        }

        function fetchDevicesToNotify() {
          // We fetch the devices to notify before changePassword() because
          // db.resetAccount() deletes all the devices saved in the account.
          return db.devices(passwordChangeToken.uid)
            .then(
              function(devices) {
                devicesToNotify = devices
              }
            )
        }

        function changePassword() {
          return db.deletePasswordChangeToken(passwordChangeToken)
            .then(
              function () {
                return password.verifyHash()
              }
            )
            .then(
              function (hash) {
                verifyHash = hash
                return password.wrap(wrapKb)
              }
            )
            .then(
              function (wrapWrapKb) {
                // Reset account, delete all sessions and tokens
                return db.resetAccount(
                  passwordChangeToken,
                  {
                    verifyHash: verifyHash,
                    authSalt: authSalt,
                    wrapWrapKb: wrapWrapKb,
                    verifierVersion: password.version
                  }
                )
              }
            )
        }

        function notifyAccount() {
          if (devicesToNotify) {
            // Notify the devices that the account has changed.
            push.notifyPasswordChanged(passwordChangeToken.uid, devicesToNotify)
          }

          return db.account(passwordChangeToken.uid)
            .then(
              function (accountData) {
                account = accountData
                return mailer.sendPasswordChangedNotification(
                  account.email,
                  {
                    acceptLanguage: request.app.acceptLanguage
                  }
                )
              }
            )
        }

        function createSessionToken() {
          // Create a sessionToken with the verification status of the current session
          var sessionTokenOptions = {
            uid: account.uid,
            email: account.email,
            emailCode: account.emailCode,
            emailVerified: account.emailVerified,
            verifierSetAt: account.verifierSetAt,
            tokenVerificationId: verifiedStatus ? null : crypto.randomBytes(16)
          }

          return db.createSessionToken(sessionTokenOptions, request.headers['user-agent'])
            .then(
              function (result) {
                sessionToken = result
              }
            )
        }

        function createKeyFetchToken() {
          if (wantsKeys) {
            // Create a verified keyFetchToken. This is deliberately verified because we don't
            // want to perform an email confirmation loop.
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

        function createResponse () {
          // If no sessionToken, this could be a legacy client
          // attempting to change password, return legacy response.
          if (!sessionTokenId) {
            return {}
          }

          var response = {
            uid: sessionToken.uid.toString('hex'),
            sessionToken: sessionToken.data.toString('hex'),
            verified: sessionToken.emailVerified && sessionToken.tokenVerified,
            authAt: sessionToken.lastAuthAt()
          }

          if (wantsKeys) {
            response.keyFetchToken = keyFetchToken.data.toString('hex')
          }

          return response
        }
      }
    },
    {
      method: 'POST',
      path: '/password/forgot/send_code',
      config: {
        validate: {
          payload: {
            email: validators.email().required(),
            service: isA.string().max(16).alphanum().optional(),
            redirectTo: validators.redirectTo(redirectDomain).optional(),
            resume: isA.string().max(2048).optional()
          }
        },
        response: {
          schema: {
            passwordForgotToken: isA.string(),
            ttl: isA.number(),
            codeLength: isA.number(),
            tries: isA.number()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Password.forgotSend', request)
        var email = request.payload.email
        var service = request.payload.service || request.query.service
        customs.check(
          request,
          email,
          'passwordForgotSendCode')
          .then(db.emailRecord.bind(db, email))
          .then(
            function (emailRecord) {
              // The token constructor sets createdAt from its argument.
              // Clobber the timestamp to prevent prematurely expired tokens.
              emailRecord.createdAt = undefined
              return db.createPasswordForgotToken(emailRecord)
            }
          )
          .then(
            function (passwordForgotToken) {
              return mailer.sendRecoveryCode(
                passwordForgotToken,
                passwordForgotToken.passCode,
                {
                  service: service,
                  redirectTo: request.payload.redirectTo,
                  resume: request.payload.resume,
                  acceptLanguage: request.app.acceptLanguage
                }
              )
              .then(
                function() {
                  return passwordForgotToken
                }
              )
            }
          )
          .done(
            function (passwordForgotToken) {
              reply(
                {
                  passwordForgotToken: passwordForgotToken.data.toString('hex'),
                  ttl: passwordForgotToken.ttl(),
                  codeLength: passwordForgotToken.passCode.length,
                  tries: passwordForgotToken.tries
                }
              )
            },
            reply
          )
      }
    },
    {
      method: 'POST',
      path: '/password/forgot/resend_code',
      config: {
        auth: {
          strategy: 'passwordForgotToken'
        },
        validate: {
          payload: {
            email: validators.email().required(),
            service: isA.string().max(16).alphanum().optional(),
            redirectTo: validators.redirectTo(redirectDomain).optional(),
            resume: isA.string().max(2048).optional()
          }
        },
        response: {
          schema: {
            passwordForgotToken: isA.string(),
            ttl: isA.number(),
            codeLength: isA.number(),
            tries: isA.number()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Password.forgotResend', request)
        var passwordForgotToken = request.auth.credentials
        var service = request.payload.service || request.query.service
        customs.check(
          request,
          passwordForgotToken.email,
          'passwordForgotResendCode')
          .then(
            mailer.sendRecoveryCode.bind(
              mailer,
              passwordForgotToken,
              passwordForgotToken.passCode,
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
              reply(
                {
                  passwordForgotToken: passwordForgotToken.data.toString('hex'),
                  ttl: passwordForgotToken.ttl(),
                  codeLength: passwordForgotToken.passCode.length,
                  tries: passwordForgotToken.tries
                }
              )
            },
            reply
          )
      }
    },
    {
      method: 'POST',
      path: '/password/forgot/verify_code',
      config: {
        auth: {
          strategy: 'passwordForgotToken'
        },
        validate: {
          payload: {
            code: isA.string().min(32).max(32).regex(HEX_STRING).required()
          }
        },
        response: {
          schema: {
            accountResetToken: isA.string()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Password.forgotVerify', request)
        var passwordForgotToken = request.auth.credentials
        var code = Buffer(request.payload.code, 'hex')
        if (butil.buffersAreEqual(passwordForgotToken.passCode, code) &&
            passwordForgotToken.ttl() > 0) {
          db.forgotPasswordVerified(passwordForgotToken)
            .then(
              function (accountResetToken) {
                return mailer.sendPasswordResetNotification(
                  passwordForgotToken.email,
                  {
                    acceptLanguage: request.app.acceptLanguage
                  }
                )
                .then(
                  function () {
                    return accountResetToken
                  }
                )
              }
            )
            .done(
              function (accountResetToken) {
                reply(
                  {
                    accountResetToken: accountResetToken.data.toString('hex')
                  }
                )
              },
              reply
            )
        }
        else {
          failVerifyAttempt(passwordForgotToken)
            .done(
              function () {
                reply(
                  error.invalidVerificationCode({
                    tries: passwordForgotToken.tries,
                    ttl: passwordForgotToken.ttl()
                  })
                )
              },
              reply
            )
        }
      }
    },
    {
      method: 'GET',
      path: '/password/forgot/status',
      config: {
        auth: {
          strategy: 'passwordForgotToken'
        },
        response: {
          schema: {
            tries: isA.number(),
            ttl: isA.number()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Password.forgotStatus', request)
        var passwordForgotToken = request.auth.credentials
        reply(
          {
            tries: passwordForgotToken.tries,
            ttl: passwordForgotToken.ttl()
          }
        )
      }
    }
  ]

  return routes
}

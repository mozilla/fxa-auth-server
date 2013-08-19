/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var crypto = require('crypto')
var P = require('p-promise')
var srp = require('srp')

var ClientApi = require('./api')
var models = require('../models')({},{},{})
var tokens = models.tokens
var AuthBundle = models.AuthBundle

function Client(origin) {
  this.uid = null
  this.api = new ClientApi(origin)
  this.passwordSalt = null
  this.srp = null
  this.email = null
  this.authToken = null
  this.sessionToken = null
  this.accountResetToken = null
  this.keyFetchToken = null
  this.forgotPasswordToken = null
  this.kA = null
  this.wrapKb = null
  this._devices = null
}

Client.Api = ClientApi

function getAMK(srpSession, email, password) {
  var a = crypto.randomBytes(32)
  var g = srp.params[2048].g
  var N = srp.params[2048].N
  var A = srp.getA(g, a, N)
  var B = Buffer(srpSession.srp.B, 'hex')
  var S = srp.client_getS(
    Buffer(srpSession.srp.salt, 'hex'),
    Buffer(email),
    Buffer(password),
    N,
    g,
    a,
    B,
    srpSession.srp.alg
  )

  var M = srp.getM(A, B, S, N)
  var K = srp.getK(S, N, srpSession.srp.alg)

  return {
    srpToken: srpSession.srpToken,
    A: A.toString('hex'),
    M: M.toString('hex'),
    K: K
  }
}

function verifier(salt, email, password, algorithm) {
  return srp.getv(
    Buffer(salt, 'hex'),
    Buffer(email),
    Buffer(password),
    srp.params['2048'].N,
    srp.params['2048'].g,
    algorithm
  ).toString('hex')
}

function setupCredentials (c, email, password) {
  // TODO: password stretching
  c.email = Buffer(email).toString('hex')
  c.password = password
  c.srp = {}
  c.srp.type = 'SRP-6a/SHA256/2048/v1'
  c.srp.salt = crypto.randomBytes(32).toString('hex')
  c.srp.algorithm = 'sha256'
  c.srp.verifier = verifier(c.srp.salt, c.email, c.password, c.srp.algorithm)
  c.passwordSalt = crypto.randomBytes(32).toString('hex')

  return c;
}

Client.create = function (origin, email, password, callback) {
  var c = new Client(origin)
  setupCredentials(c, email, password)
  var p = c.create()
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.login = function (origin, email, password, callback) {
  var c = new Client(origin)
  setupCredentials(c, email, password)
  var p = c.login()
    .then(
      function () {
        return c
      }
    )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.parse = function (string) {
  var object = JSON.parse(string)
  var client = new Client(object.api.origin)
  client.uid = object.uid
  client.email = object.email
  client.password = object.password
  client.srp = object.srp
  c.passwordSalt = object.passwordSalt
  client.passwordStretching = object.passwordStretching
  client.sessionToken = object.sessionToken
  client.accountResetToken = object.accountResetToken
  client.keyFetchToken = object.keyFetchToken
  client.forgotPasswordToken = object.forgotPasswordToken
  client.kA = object.kA
  client.wrapKb = object.wrapKb

  return client
}

Client.prototype.create = function (callback) {
  var p = this.api.accountCreate(
    this.email,
    this.srp.verifier,
    this.srp.salt,
    {
      type: 'PBKDF2/scrypt/PBKDF2/v1',
      PBKDF2_rounds_1: 20000,
      scrypt_N: 65536,
      scrypt_r: 8,
      scrypt_p: 1,
      PBKDF2_rounds_2: 20000,
      salt: this.passwordSalt
    }
  )
  .then(
    function (a) {
      this.uid = a.uid
      return this
    }.bind(this)
  )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype._clear = function () {
  this.authToken = null
  this.sessionToken = null
  this.accountResetToken = null
  this.keyFetchToken = null
  this.forgotPasswordToken = null
  this.kA = null
  this.wrapKb = null
  this._devices = null
}

Client.prototype.stringify = function () {
 return JSON.stringify(this)
}

Client.prototype.auth = function (callback) {
  var K = null
  var p = this.api.authStart(this.email)
    .then(
      function (srpSession) {
        var x = getAMK(srpSession, this.email, this.password)
        K = x.K
        return this.api.authFinish(x.srpToken, x.A, x.M)
      }.bind(this)
    )
    .then(
      function (json) {
        return AuthBundle.create(K, 'auth/finish')
          .then(
            function (b) {
              return b.unbundle(json.bundle)
            }
          )
      }.bind(this)
    )
    .then(
      function (authToken) {
        this.authToken = authToken
        return authToken
      }.bind(this)
    )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.login = function (callback) {
  var p = this.auth()
    .then(
      function (authToken) {
        return this.api.sessionCreate(this.authToken)
      }.bind(this)
    )
    .then (
      function (json) {
        return tokens.AuthToken.fromHex(this.authToken)
          .then(
            function (t) {
              return t.unbundleSession(json.bundle)
            }
          )
      }.bind(this)
    )
    .then(
      function (tokens) {
        this.keyFetchToken = tokens.keyFetchToken
        this.sessionToken = tokens.sessionToken
        return tokens
      }.bind(this)
    )

  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.destroySession = function (callback) {
  var p = P(null)
  if (this.sessionToken) {
    p = this.api.sessionDestroy(this.sessionToken)
      .then(
        function () {
          this.sessionToken = null
          return {}
        }.bind(this)
      )
  }
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.verifyEmail = function (code, callback) {
  var p = this.api.recoveryEmailVerifyCode(this.uid, code)
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.emailStatus = function (callback) {
  var o = this.sessionToken ? P(null) : this.login()
  var p = o.then(
    function () {
      return this.api.recoveryEmailStatus(this.sessionToken)
    }.bind(this)
  )
  .then(
    function (status) {
      // decode email
      status.email = Buffer(status.email, 'hex').toString()
      return status
    }
  )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.requestVerifyEmail = function (callback) {
  var o = this.sessionToken ? P(null) : this.login()
  var p = o.then(
    function () {
      return this.api.recoveryEmailResendCode(this.sessionToken, this.email)
    }.bind(this)
  )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.sign = function (publicKey, duration, callback) {
  var o = this.sessionToken ? P(null) : this.login()
  var p = o.then(
    function () {
      return this.api.certificateSign(this.sessionToken, publicKey, duration)
    }.bind(this)
  )
  .then(
    function (x) {
      return x.cert
    }
  )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.changePassword = function (newPassword, callback) {
  var p = this.auth()
    .then(
      function () {
        return this.api.passwordChangeStart(this.authToken)
      }.bind(this)
    )
    .then (
      function (json) {
        return tokens.AuthToken.fromHex(this.authToken)
          .then(
            function (t) {
              return t.unbundleAccountReset(json.bundle)
            }
          )
      }.bind(this)
    )
    .then(
      function (tokens) {
        this.keyFetchToken = tokens.keyFetchToken
        this.accountResetToken = tokens.accountResetToken
      }.bind(this)
    )
    .then(this.keys.bind(this))
    .then(
      function () {
        return tokens.AccountResetToken.fromHex(this.accountResetToken)
      }.bind(this)
    )
    .then(
      function (token) {
        this.srp.salt = crypto.randomBytes(32).toString('hex')
        this.password = newPassword
        this.srp.verifier = verifier(this.srp.salt, this.email, newPassword, this.srp.algorithm)
        var bundle = token.bundle(this.wrapKb, this.srp.verifier)
        return this.api.accountReset(
          this.accountResetToken,
          bundle,
          {
            type: this.srp.type,
            salt: this.srp.salt
          },
          this.passwordStretching
        )
      }.bind(this)
    )
    .then(this._clear.bind(this))
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.keys = function (callback) {
  var o = this.keyFetchToken ? P(null) : this.login()
  var p = o.then(
    function () {
      return this.api.accountKeys(this.keyFetchToken)
    }.bind(this)
  )
  .then(
    function (data) {
      return tokens.KeyFetchToken.fromHex(this.keyFetchToken)
        .then(
          function (token) {
            return token.unbundle(data.bundle)
          }
        )
    }.bind(this)
  )
  .then(
    function (keys) {
      this.keyFetchToken = null
      this.kA = keys.kA
      this.wrapKb = keys.wrapKb
      return keys
    }.bind(this),
    function (err) {
      this.keyFetchToken = null
      throw err
    }.bind(this)
  )

  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.devices = function (callback) {
  var o = this.sessionToken ? P(null) : this.login()
  var p = o.then(
    function () {
      return this.api.accountDevices(this.sessionToken)
    }.bind(this)
  )
  .then(
    function (json) {
      this._devices = json.devices
      return this._devices
    }.bind(this)
  )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.destroyAccount = function (callback) {
  var p = this.auth()
    .then(
      function () {
        return this.api.accountDestroy(this.authToken)
      }.bind(this)
    )
    .then(this._clear.bind(this))
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.forgotPassword = function (callback) {
  this._clear()
  var p = this.api.passwordForgotSendCode(this.email)
    .then(
      function (x) {
        this.forgotPasswordToken = x.forgotPasswordToken
      }.bind(this)
    )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.reforgotPassword = function (callback) {
  var p = this.api.passwordForgotResendCode(this.forgotPasswordToken, this.email)
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

Client.prototype.resetPassword = function (code, password, callback) {
  // this will generate a new wrapKb on the server
  var wrapKb = '0000000000000000000000000000000000000000000000000000000000000000'
  setupCredentials(this, Buffer(this.email, 'hex').toString(), password)
  var p = this.api.passwordForgotVerifyCode(this.forgotPasswordToken, code)
    .then(
      function (json) {
        return tokens.AccountResetToken.fromHex(json.accountResetToken)
      }
    )
    .then(
      function (accountResetToken) {
        var bundle = accountResetToken.bundle(wrapKb, this.srp.verifier)
        return this.api.accountReset(
          accountResetToken.data,
          bundle,
          {
            type: this.srp.type,
            salt: this.srp.salt
          },
          this.passwordStretching
        )
      }.bind(this)
    )
  if (callback) {
    p.done(callback.bind(null, null), callback)
  }
  else {
    return p
  }
}

//TODO recovery methods, session status/destroy

module.exports = Client

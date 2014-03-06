/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

require('ass')
var crypto = require('crypto')
var test = require('../ptaptest')
var uuid = require('uuid')
var log = { trace: console.log }
var P = require('../../promise.js')

var config = require('../../config').root()
var Token = require('../../tokens')(log)
var AccountResetToken = Token.AccountResetToken

var DB = require('../../db')(
  config.db.backend,
  log,
  Token.error,
  Token.SessionToken,
  Token.KeyFetchToken,
  Token.AccountResetToken,
  Token.PasswordForgotToken,
  Token.PasswordChangeToken
)

// This is only testable with a persistent database
if (config.db.backend === 'memory') { return }

var zeroBuffer16 = Buffer('00000000000000000000000000000000', 'hex')
var zeroBuffer32 = Buffer('0000000000000000000000000000000000000000000000000000000000000000', 'hex')

var email = crypto.randomBytes(10).toString('hex') + '@restmail.net' 
var ACCOUNT = {
  uid: uuid.v4('binary'),
  email: email,
  emailCode: zeroBuffer16,
  emailVerified: false,
  verifierVersion: 1,
  verifyHash: zeroBuffer32,
  authSalt: zeroBuffer32,
  kA: zeroBuffer32,
  wrapWrapKb: zeroBuffer32
}

DB.connect(config)
  .then(
    function (db) {

      test(
        'ping',
        function (t) {
          t.plan(1);
          return db.ping()
          .then(function(account) {
            t.pass('Got the ping ok')
          }, function(err) {
            t.fail('Should not have arrived here')
          })
        }
      )

      test(
        'create account, make passwordForgotToken, expire it, prune it',
        function (t) {
          var emailRecord
          var accountResetToken
          var passwordForgotToken

          // Do the following three:
          // 1) accountResetToken
          // 2) passwordForgotToken
          // 3) passwordChangeToken (?)

          return db.createAccount(ACCOUNT)
          .then(function(emailRecord) {
            return db.createAccountResetToken(emailRecord)
          })
          .then(function(newAccountResetToken) {
              console.log('newAccountResetToken:', newAccountResetToken)
            accountResetToken = newAccountResetToken  
            return db.createAccountResetToken(accountResetToken)
          })
          .then(function() {
            // now set it to be a day ago
            return db.getConnection('MASTER')
              .then(function(con) {
                var d = P.defer()
                var oneDay = 24 * 60 * 60 * 1000
                con.query(
                  "UPDATE accountResetTokens SET createdAt = createdAt - ? WHERE uid = ?",
                  [ oneDay, ACCOUNT.uid ],
                  function (err) {
                    con.release()
                    if (err) {
                      t.fail(err)
                      return d.reject(err)
                    }
                    t.pass('Updating accountResetTokens to age it ran fine')
                    d.resolve()
                  }
                )
                return d.promise
              })
          })
          .then(function() {
            return AccountResetToken.create(ACCOUNT)
          })
          .then(function(newEmailRecord) {
            emailRecord = newEmailRecord
            return db.createPasswordForgotToken(emailRecord)
          })
          .then(function(newPasswordForgotToken) {
            // now set it to be a day ago
            passwordForgotToken = newPasswordForgotToken

            return db.getConnection('MASTER')
              .then(function(con) {
                var d = P.defer()
                var oneDay = 24 * 60 * 60 * 1000
                con.query(
                  "UPDATE passwordForgotTokens SET createdAt = createdAt - ? WHERE uid = ?",
                  [ oneDay, ACCOUNT.uid ],
                  function (err) {
                    con.release()
                    if (err) {
                      t.fail(err)
                      return d.reject(err)
                    }
                    t.pass('Updating passwordForgotTokens to age it ran fine')
                    d.resolve()
                  }
                )
                return d.promise
              })
          })
          .then(function() {
            // set pruneLastRun to be zero, so we know it will run
            return db.getConnection('MASTER')
              .then(function(con) {
                var d = P.defer()
                con.query(
                  "UPDATE dbMetadata SET value = '0' WHERE name = 'pruneLastRan'",
                  function (err) {
                    con.release()
                    if (err) {
                      t.fail(err)
                      return d.reject(err)
                    }
                    t.pass('Updating dbMetadata for last run was ok')
                    d.resolve()
                  }
                )
                return d.promise
              })
          })
          .then(function() {
            // prune older tokens
            return db.getConnection('MASTER')
              .then(function(con) {
                var now = Date.now()
                var halfDayAgo = now - ( 12 * 60 * 60 * 1000 )
                var d = P.defer()
                con.query("CALL prune(?, ?)", [ halfDayAgo, now ], function(err, res) {
                  con.release()
                  if (err) {
                    t.fail(err)
                    return d.reject(err)
                  }
                  t.pass('Calling prune() was ok')
                  d.resolve()
                })
                return d.promise
              })
          })
          // now check that all tokens for this uid have been deleted
          .then(function() {
            var d = P.defer()
            var todo = 2;

            function check() {
              if ( todo === 0 ) {
                d.resolve()
              }
            }

            db.accountResetToken(accountResetToken.tokenId)
              .then(function(accountResetToken) {
                t.fail('The above accountResetToken() call should fail, since the accountResetToken has been deleted')
              }, function(err) {
                t.equal(err.errno, 110, 'accountResetToken() fails with the correct error code')
                var msg = 'Error: Invalid authentication token in request signature'
                t.equal(msg, '' + err, 'accountResetToken() fails with the correct message')
              })
              .done(function() {
                todo--
                check()
              })

            db.passwordForgotToken(passwordForgotToken.tokenId)
              .then(function(passwordForgotToken) {
                console.log(passwordForgotToken)
                t.fail('The above passwordForgotToken() call should fail, since the passwordForgotToken has been pruned')
              }, function(err) {
                t.equal(err.errno, 110, 'passwordForgotToken() fails with the correct error code')
                var msg = 'Error: Invalid authentication token in request signature'
                t.equal(msg, '' + err, 'passwordForgotToken() fails with the correct message')
              })
              .done(function() {
                todo--
                check()
              })

            return d.promise
          })
        }
      )

      test(
        'teardown',
        function (t) {
          return db.close()
        }
      )

    }
  )

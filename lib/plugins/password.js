/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Check if the password a user entered matches the one on
 * file for the account. If it does not, flag the account with
 * customs. Higher levels will take care of
 * returning an error to the user.
 */

'use strict'

const butil = require('../crypto/butil')
const error = require('../error')

module.exports = (Password, customs, db) => {
  return (emailRecord, authPW, clientAddress) => {
    if (butil.buffersAreEqual(emailRecord.authSalt, butil.ONES)) {
      return customs.flag(clientAddress, {
        email: emailRecord.email,
        errno: error.ERRNO.ACCOUNT_RESET
      })
      .then(
        function () {
          throw error.mustResetAccount(emailRecord.email)
        }
      )
    }
    const password = new Password(
      authPW,
      emailRecord.authSalt,
      emailRecord.verifierVersion
    )
    return password.verifyHash()
      .then(
        function (verifyHash) {
          return db.checkPassword(emailRecord.uid, verifyHash)
        }
      )
      .then(
        function (match) {
          if (match) {
            return match
          }

          return customs.flag(clientAddress, {
            email: emailRecord.email,
            errno: error.ERRNO.INCORRECT_PASSWORD
          })
          .then(
            function () {
              return match
            }
          )
        }
      )
  }
}

module.exports.register = (server, options, next) => {
  const password = Object.freeze({
    check: module.exports(options.Password, server.plugins.customs, options.db)
  })

  server.ext('onRequest', (request, reply) => {
    request.plugins.password = password
    return reply.continue()
  })

  return next()
}

module.exports.register.attributes = {
  name: 'password',
  dependencies: ['customs']
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

module.exports = function (srp, isA, error, Account) {

  const HEX_STRING = /^(?:[a-fA-F0-9]{2})+$/

  var routes = [
    {
      method: 'POST',
      path: '/session/auth/start',
      config: {
        description:
          "Begins an SRP login for the supplied email address, " +
          "returning the temporary sessionId and parameters for " +
          "key stretching and the SRP protocol for the client.",
        tags: ["srp", "account"],
        handler: function (request) {
          Account
            .getByEmail(request.payload.email)
            .done(
              function (account) {
                return srp.start('login', account, request)
              }
            )
        },
        validate: {
          payload: {
            email: isA.String().email().required()
          },
          response: {
            schema: {
              srpToken: isA.String().required(),
              stretch: isA.Object({
                salt: isA.String()
              }),
              srp: isA.Object({
                N_bits: isA.Number().valid(2048),  // number of bits for prime
                alg: isA.String().valid('sha256'), // hash algorithm (sha256)
                s: isA.String().regex(HEX_STRING), // salt
                B: isA.String().regex(HEX_STRING)  // server's public key value
              })
            }
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/session/auth/finish',
      handler: srp.finish,
      config: {
        description:
          "Finishes the SRP dance, with the client providing " +
          "proof-of-knownledge of the password and receiving " +
          "the bundle encrypted with the shared key.",
        tags: ["srp", "session"],
        validate: {
          payload: {
            srpToken: isA.String().required(),
            A: isA.String().regex(HEX_STRING).required(),
            M: isA.String().regex(HEX_STRING).required()
          },
          response: {
            schema: {
              bundle: isA.String().regex(HEX_STRING).required()
            }
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/session/status',
      config: {
        description: "Check whether a session is still valid.",
        tags: ["session"],
        auth: {
          strategy: 'sessionToken'
        },
        handler: function (request) {
          // hapi will take care of the case where the token isn't valid
          request.reply({})
        }
      }
    },
    {
      method: 'POST',
      path: '/session/destroy',
      config: {
        description: "Destroys this session.",
        tags: ["session"],
        auth: {
          strategy: 'sessionToken'
        },
        handler: function (request) {
          var sessionToken = request.auth.credentials
          sessionToken
            .del()
            .then(
              function () {
                return Account.get(sessionToken.uid)
              }
            )
            .then(
              function (account) {
                return account.deleteSessionToken(sessionToken.id)
              }
            )
            .done(
              function () {
                request.reply({})
              },
              function (err) {
                request.reply(err)
              }
            )
        }
      }
    }
  ]

  return routes
}

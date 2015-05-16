/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

module.exports = function (log, isA, error, db) {

  function destroySession(sessionRevokeToken) {
    return sessionRevokeToken.sessionToken()
      .then(
        function(sessionToken) {
          if (!sessionToken) {
            return null
          }
          return db.deleteSessionToken(sessionToken)
            .then(
              null,
              function (err) {
                if (err.statusCode === 404) {
                  return null
                }
                throw err
              }
            )
        }
      )
  }

  function destroyKeyFetch(sessionRevokeToken) {
    return sessionRevokeToken.keyFetchToken()
      .then(
        function (keyFetchToken) {
          if (!keyFetchToken) {
            return null
          }
          return db.deleteKeyFetchToken(keyFetchToken)
            .then(
              null,
              function (err) {
                if (err.statusCode === 404) {
                  return null
                }
                throw err
              }
            )
        }
      )
  }

  var routes = [
    {
      method: 'POST',
      path: '/session/revoke',
      config: {
        auth: {
          strategy: 'sessionRevokeToken'
        }
      },
      handler: function (request, reply) {
        log.begin('Session.revoke', request)
        var sessionRevokeToken = request.auth.credentials
        destroySession(sessionRevokeToken)
          .then(
            function () {
              return destroyKeyFetch(sessionRevokeToken)
            }
          )
          .then(
            function() {
              return db.deleteSessionRevokeToken(sessionRevokeToken)
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
      path: '/session/destroy',
      config: {
        auth: {
          strategy: 'sessionToken'
        }
      },
      handler: function (request, reply) {
        log.begin('Session.destroy', request)
        var sessionToken = request.auth.credentials
        db.deleteSessionToken(sessionToken)
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
      path: '/session/status',
      config: {
        auth: {
          strategy: 'sessionToken'
        }
      },
      handler: function (request, reply) {
        log.begin('Session.status', request)
        var sessionToken = request.auth.credentials
        reply({ uid: sessionToken.uid.toString('hex') })
      }
    }
  ]

  return routes
}

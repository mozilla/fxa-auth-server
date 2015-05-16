/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

module.exports = function (log, inherits, Token, P, SessionToken, KeyFetchToken) {

  function SessionRevokeToken(keys, details) {
    Token.call(this, keys, details)
    this.sessionData = details.sessionData
    this.keyFetchId = details.keyFetchId
  }
  inherits(SessionRevokeToken, Token)

  SessionRevokeToken.tokenTypeID = 'sessionRevokeToken'

  SessionRevokeToken.prototype.sessionToken = function () {
    return SessionToken.fromHex(this.sessionData, { uid: this.uid })
  }

  SessionRevokeToken.prototype.keyFetchToken = function () {
    if (!this.keyFetchId) {
      return P(null)
    }
    return KeyFetchToken.fromId(this.keyFetchId, { uid: this.uid })
  }

  SessionRevokeToken.create = function (details) {
    log.trace({ op: 'SessionRevokeToken.create', uid: details && details.uid })
    return Token.createNewToken(SessionRevokeToken, details || {})
  }

  SessionRevokeToken.fromHex = function (string, details) {
    log.trace({ op: 'SessionRevokeToken.fromHex' })
    return Token.createTokenFromHexData(SessionRevokeToken, string, details || {})
  }

  return SessionRevokeToken
}

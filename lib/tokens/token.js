/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*  Base class for handling various types of token.
 *
 *  This module provides the basic functionality for handling authentication
 *  tokens.  There are different types of token for use in different contexts
 *  but they all operate in essentially the same way:
 *
 *    - Each token is created from an initial data seed of 32 random bytes.
 *
 *    - From the seed data we HKDF-derive three 32-byte values: a tokenId,
 *      an authKey and a bundleKey.
 *
 *    - The tokenId/authKey pair can be used as part of a request-signing
 *      authentication scheme.
 *
 *    - The bundleKey can be used to encrypt data as part of the request.
 *
 *    - The token may have additional metadata details such as uid or email,
 *      which are specific to the type of token.
 *
 */

var config = require('../../config').getProperties()

module.exports = function (log, random, P, hkdf, Bundle, error) {

  // Token constructor.
  //
  // This directly populates the token from its keys and metadata details.
  // You probably want to call a helper rather than use this directly.
  //
  function Token(keys, details) {
    this.data = keys.data
    this.tokenId = keys.tokenId
    this.authKey = keys.authKey
    this.bundleKey = keys.bundleKey
    this.algorithm = 'sha256'
    this.uid = details.uid || null
    this.lifetime = details.lifetime || Infinity
    this.createdAt = optionallyOverrideCreatedAt(details.createdAt)
  }

  function optionallyOverrideCreatedAt (timestamp) {
    var now = Date.now()

    if (! config.isProduction && timestamp >= 0 && timestamp < now) {
      // In the wild, all tokens should have a fresh createdAt timestamp.
      // For testing purposes only, allow createdAt to be overridden.
      return timestamp
    }

    return now
  }

  // Create a new token of the given type.
  // This uses randomly-generated seed data to derive the keys.
  //
  Token.createNewToken = function(TokenType, details) {
    return random(32)
      .then(bytes => Token.deriveTokenKeys(TokenType, bytes))
      .then(keys => new TokenType(keys, details || {}))
  }


  // Re-create an existing token of the given type.
  // This uses known seed data to derive the keys.
  //
  Token.createTokenFromHexData = function(TokenType, hexData, details) {
    var d = P.defer()
    var data = Buffer(hexData, 'hex')
    Token.deriveTokenKeys(TokenType, data)
      .then(
        function (keys) {
          d.resolve(new TokenType(keys, details || {}))
        }
      )
      .catch(
        function (err) {
          d.reject(err)
        }
      )
    return d.promise
  }


  // Derive tokenId, authKey and bundleKey from token seed data.
  //
  Token.deriveTokenKeys = function (TokenType, data) {
    return hkdf(data, TokenType.tokenTypeID, null, 3 * 32)
      .then(
        function (keyMaterial) {
          return {
            data: data,
            tokenId: keyMaterial.slice(0, 32),
            authKey: keyMaterial.slice(32, 64),
            bundleKey: keyMaterial.slice(64, 96)
          }
        }
      )
  }


  // Convenience method to bundle a payload using token bundleKey.
  //
  Token.prototype.bundle = function(keyInfo, payload) {
    log.trace({ op: 'Token.bundle' })
    return Bundle.bundle(this.bundleKey, keyInfo, payload)
  }


  // Convenience method to unbundle a payload using token bundleKey.
  //
  Token.prototype.unbundle = function(keyInfo, payload) {
    log.trace({ op: 'Token.unbundle' })
    return Bundle.unbundle(this.bundleKey, keyInfo, payload)
  }

  Token.prototype.ttl = function (asOf) {
    asOf = asOf || Date.now()
    var ttl = (this.lifetime - (asOf - this.createdAt)) / 1000
    return Math.max(Math.ceil(ttl), 0)
  }

  Token.prototype.expired = function (asOf) {
    return this.ttl(asOf) === 0
  }

  // Properties defined for HAWK
  Object.defineProperties(
    Token.prototype,
    {
      id: {
        get: function () { return this.tokenId.toString('hex') }
      },
      key: {
        get: function () { return this.authKey }
      },
      algorithm: {
        get: function () { return 'sha256' }
      }
    }
  )

  return Token
}

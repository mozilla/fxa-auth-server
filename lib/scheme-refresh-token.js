/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const AppError = require('./error')
const joi = require('joi')
const validators = require('./routes/validators')
const { BEARER_AUTH_REGEX } = require('./routes/validators')

module.exports = function schemeRefreshTokenScheme(db, oauthdb) {
  return function schemeRefreshToken(server, options) {
    return {
      async authenticate (request, h) {
        const bearerMatch = BEARER_AUTH_REGEX.exec(request.headers.authorization)
        const bearerMatchErr = new AppError.invalidRequestParameter('authorization')
        const refreshTokenIdUnhashed = bearerMatch && bearerMatch[1]
        if (refreshTokenIdUnhashed) {
          joi.attempt(bearerMatch[1], validators.refreshToken, bearerMatchErr)
        } else {
          throw bearerMatchErr
        }

        const refreshToken = await oauthdb.checkRefreshToken(refreshTokenIdUnhashed)
        if (! refreshToken || ! refreshToken.active) {
          return h.unauthenticated()
        }

        const credentials = {
          uid: refreshToken.sub,
          tokenVerified: true,
          refreshTokenId: refreshToken.jti
        }

        credentials.client = await oauthdb.getClientInfo(refreshToken.client_id)
        const devices = await db.devices(refreshToken.sub)

        // use the hashed refreshToken id to find devices
        const device = devices.filter(device => device.refreshTokenId === refreshToken.jti)[0]
        if (device) {
          credentials.deviceId = device.id
          credentials.deviceName = device.name
          credentials.deviceType = device.type
          credentials.deviceCreatedAt = device.createdAt
          credentials.deviceCallbackURL = device.callbackURL
          credentials.deviceCallbackPublicKey = device.callbackPublicKey
          credentials.deviceCallbackAuthKey = device.callbackAuthKey
          credentials.deviceCallbackIsExpired = device.callbackIsExpired
          credentials.deviceAvailableCommands = device.availableCommands
        }

        return h.authenticated({
          credentials: credentials
        })
      }
    }
  }
}

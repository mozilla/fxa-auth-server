/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const isA = require('joi')
const validators = require('./routes/validators')
const {
  DISPLAY_SAFE_UNICODE_WITH_NON_BMP,
  HEX_STRING,
  URL_SAFE_BASE_64
} = validators
const PUSH_SERVER_REGEX = require('../config').get('push.allowedServerRegex')

const SCHEMA = {
  id: isA.string().length(32).regex(HEX_STRING),
  location: isA.object({
    city: isA.string().optional().allow(null),
    country: isA.string().optional().allow(null),
    state: isA.string().optional().allow(null),
    stateCode: isA.string().optional().allow(null)
  }),
  name: isA.string().max(255).regex(DISPLAY_SAFE_UNICODE_WITH_NON_BMP),
  // We previously allowed devices to register with arbitrary unicode names,
  // so we can't assert DISPLAY_SAFE_UNICODE_WITH_NON_BMP in the response schema.
  nameResponse: isA.string().max(255),
  type: isA.string().max(16),
  pushCallback: validators.url({ scheme: 'https' }).regex(PUSH_SERVER_REGEX).max(255).allow(''),
  pushPublicKey: isA.string().max(88).regex(URL_SAFE_BASE_64).allow(''),
  pushAuthKey: isA.string().max(24).regex(URL_SAFE_BASE_64).allow(''),
  pushEndpointExpired: isA.boolean().strict(),
  // An object mapping command names to metadata bundles.
  availableCommands: isA.object().pattern(validators.DEVICE_COMMAND_NAME, isA.string().max(2048))
}

module.exports = (log, db, push) => {
  return { upsert, synthesizeName }

  function upsert (request, sessionToken, deviceInfo) {
    let operation, event, result
    if (deviceInfo.id) {
      operation = 'updateDevice'
      event = 'device.updated'
    } else {
      operation = 'createDevice'
      event = 'device.created'
    }
    const isPlaceholderDevice = ! deviceInfo.id && ! deviceInfo.name && ! deviceInfo.type

    return db[operation](sessionToken.uid, sessionToken.id, deviceInfo)
      .then(device => {
        result = device
        return request.emitMetricsEvent(event, {
          uid: sessionToken.uid,
          device_id: result.id,
          is_placeholder: isPlaceholderDevice
        })
      })
      .then(() => {
        if (operation === 'createDevice') {
          // Clients expect this notification to always include a name,
          // so try to synthesize one if necessary.
          let deviceName = result.name
          if (! deviceName) {
            deviceName = synthesizeName(deviceInfo)
          }
          if (sessionToken.tokenVerified) {
            request.app.devices.then(devices => {
              const otherDevices = devices.filter(device => device.id !== result.id)
              return push.notifyDeviceConnected(sessionToken.uid, otherDevices, deviceName)
            })
          }
          if (isPlaceholderDevice) {
            log.info({
              op: 'device:createPlaceholder',
              uid: sessionToken.uid,
              id: result.id
            })
          }
          return log.notifyAttachedServices('device:create', request, {
            uid: sessionToken.uid,
            id: result.id,
            type: result.type,
            timestamp: result.createdAt,
            isPlaceholder: isPlaceholderDevice
          })
        }
      })
      .then(function () {
        return result
      })
  }

  function synthesizeName (device) {
    const uaBrowser = device.uaBrowser
    const uaBrowserVersion = device.uaBrowserVersion
    const uaOS = device.uaOS
    const uaOSVersion = device.uaOSVersion
    const uaFormFactor = device.uaFormFactor
    let result = ''

    if (uaBrowser) {
      if (uaBrowserVersion) {
        const splitIndex = uaBrowserVersion.indexOf('.')
        result = `${uaBrowser} ${splitIndex === -1 ? uaBrowserVersion : uaBrowserVersion.substr(0, splitIndex)}`
      } else {
        result = uaBrowser
      }

      if (uaOS || uaFormFactor) {
        result += ', '
      }
    }

    if (uaFormFactor) {
      return `${result}${uaFormFactor}`
    }

    if (uaOS) {
      result += uaOS

      if (uaOSVersion) {
        result += ` ${uaOSVersion}`
      }
    }

    return result
  }
}

module.exports.schema = SCHEMA


/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

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

    return db[operation](sessionToken.uid, sessionToken.tokenId, deviceInfo)
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
            push.notifyDeviceConnected(sessionToken.uid, deviceName, result.id)
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
    const browserPart = part('uaBrowser')
    const osPart = part('uaOS')
    const formFactor = device.uaFormFactor
    let result = ''

    if (browserPart) {
      result = browserPart

      if (osPart || formFactor) {
        result += ', '
      }
    }

    if (osPart) {
      result += osPart

      if (formFactor) {
        result += ' '
      }
    }

    if (formFactor) {
      result += formFactor
    }

    return result

    function part (key) {
      if (device[key]) {
        const versionKey = `${key}Version`

        if (device[versionKey]) {
          return `${device[key]} ${device[versionKey]}`
        }

        return device[key]
      }
    }
  }
}


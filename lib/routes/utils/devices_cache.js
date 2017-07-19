/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const config = require('../../../config').getProperties()
const features = require('../../features')(config)

const localizeTimestamp = require('fxa-shared').l10n.localizeTimestamp({
  supportedLanguages: config.i18n.supportedLanguages,
  defaultLanguage: config.i18n.defaultLanguage
})

module.exports = function devicesCache(request, db, devices, next) {
  const sessionToken = request.auth.credentials
  const uid = sessionToken.uid
  return db.devices(uid)
    .then(deviceArray => {
      const result = deviceArray.map(device => {
        if (! device.name) {
          device.name = devices.synthesizeName(device)
        }

        if (! device.type) {
          device.type = device.uaDeviceType || 'desktop'
        }

        device.isCurrentDevice = device.sessionToken === sessionToken.tokenId

        device.lastAccessTimeFormatted = localizeTimestamp.format(
          device.lastAccessTime,
          request.headers['accept-language']
        )

        delete device.sessionToken
        delete device.uaBrowser
        delete device.uaBrowserVersion
        delete device.uaOS
        delete device.uaOSVersion
        delete device.uaDeviceType

        return device
      })
      const shouldCache = features.isDevicesCacheEnabledForUser(uid)
      const ttl = shouldCache ? null : 0
      return next(null, result, ttl)
    })
}

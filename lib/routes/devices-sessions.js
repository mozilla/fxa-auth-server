/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const Ajv = require('ajv')
const ajv = new Ajv()
const error = require('../error')
const fs = require('fs')
const isA = require('joi')
const P = require('../promise')
const path = require('path')
const validators = require('./validators')

const HEX_STRING = validators.HEX_STRING
const DEVICES_SCHEMA = require('../devices').schema
const PUSH_PAYLOADS_SCHEMA_PATH = path.resolve(__dirname, '../../docs/pushpayloads.schema.json')

module.exports = (log, db, config, customs, push, devices) => {
  // Loads and compiles a json validator for the payloads received
  // in /account/devices/notify
  const validatePushSchema = JSON.parse(fs.readFileSync(PUSH_PAYLOADS_SCHEMA_PATH))
  const validatePushPayload = ajv.compile(validatePushSchema)
  const localizeTimestamp = require('fxa-shared').l10n.localizeTimestamp({
    supportedLanguages: config.i18n.supportedLanguages,
    defaultLanguage: config.i18n.defaultLanguage
  })

  return [
    {
      method: 'POST',
      path: '/account/device',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: isA.alternatives().try(
            isA.object({
              id: DEVICES_SCHEMA.id.required(),
              name: DEVICES_SCHEMA.name.optional(),
              type: DEVICES_SCHEMA.type.optional(),
              pushCallback: DEVICES_SCHEMA.pushCallback.optional(),
              pushPublicKey: DEVICES_SCHEMA.pushPublicKey.optional(),
              pushAuthKey: DEVICES_SCHEMA.pushAuthKey.optional()
            }).or('name', 'type', 'pushCallback', 'pushPublicKey', 'pushAuthKey').and('pushPublicKey', 'pushAuthKey'),
            isA.object({
              name: DEVICES_SCHEMA.name.required(),
              type: DEVICES_SCHEMA.type.required(),
              pushCallback: DEVICES_SCHEMA.pushCallback.optional(),
              pushPublicKey: DEVICES_SCHEMA.pushPublicKey.optional(),
              pushAuthKey: DEVICES_SCHEMA.pushAuthKey.optional()
            }).and('pushPublicKey', 'pushAuthKey')
          )
        },
        response: {
          schema: isA.object({
            id: DEVICES_SCHEMA.id.required(),
            createdAt: isA.number().positive().optional(),
            name: DEVICES_SCHEMA.nameResponse.optional(),
            type: DEVICES_SCHEMA.type.optional(),
            pushCallback: DEVICES_SCHEMA.pushCallback.optional(),
            pushPublicKey: DEVICES_SCHEMA.pushPublicKey.optional(),
            pushAuthKey: DEVICES_SCHEMA.pushAuthKey.optional(),
            pushEndpointExpired: DEVICES_SCHEMA.pushEndpointExpired.optional()
          }).and('pushPublicKey', 'pushAuthKey')
        }
      },
      handler (request, reply) {
        log.begin('Account.device', request)

        const payload = request.payload
        const sessionToken = request.auth.credentials

        // Some additional, slightly tricky validation to detect bad public keys.
        if (payload.pushPublicKey && ! push.isValidPublicKey(payload.pushPublicKey)) {
          throw error.invalidRequestParameter('invalid pushPublicKey')
        }

        if (payload.id) {
          // Don't write out the update if nothing has actually changed.
          if (isSpuriousUpdate(payload, sessionToken)) {
            return reply(payload)
          }

          // We also reserve the right to disable updates until
          // we're confident clients are behaving correctly.
          if (config.deviceUpdatesEnabled === false) {
            throw error.featureNotEnabled()
          }
        } else if (sessionToken.deviceId) {
          // Keep the old id, which is probably from a synthesized device record
          payload.id = sessionToken.deviceId
        }

        const pushEndpointOk = ! payload.id || // New device.
                               (payload.id && payload.pushCallback &&
                                payload.pushCallback !== sessionToken.deviceCallbackURL) // Updating the pushCallback
        if (pushEndpointOk) {
          payload.pushEndpointExpired = false
        }
        if (payload.pushCallback) {
          if (! payload.pushPublicKey || ! payload.pushAuthKey) {
            payload.pushPublicKey = ''
            payload.pushAuthKey = ''
          }
        }

        devices.upsert(request, sessionToken, payload)
          .then(reply, reply)

        // Clients have been known to send spurious device updates,
        // which generates lots of unnecessary database load.
        // Check if anything has actually changed, and log lots metrics on what.
        function isSpuriousUpdate (payload, token) {
          let spurious = true

          if (! token.deviceId || payload.id !== token.deviceId) {
            spurious = false
          }

          if (payload.name && payload.name !== token.deviceName) {
            spurious = false
          }

          if (payload.type && payload.type !== token.deviceType) {
            spurious = false
          }

          if (payload.pushCallback && payload.pushCallback !== token.deviceCallbackURL) {
            spurious = false
          }

          if (payload.pushPublicKey && payload.pushPublicKey !== token.deviceCallbackPublicKey) {
            spurious = false
          }

          return spurious
        }
      }
    },
    {
      method: 'POST',
      path: '/account/devices/notify',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: isA.alternatives().try(
            isA.object({
              to: isA.string().valid('all').required(),
              excluded: isA.array().items(isA.string().length(32).regex(HEX_STRING)).optional(),
              payload: isA.object().required(),
              TTL: isA.number().integer().min(0).optional()
            }),
            isA.object({
              to: isA.array().items(isA.string().length(32).regex(HEX_STRING)).required(),
              payload: isA.object().required(),
              TTL: isA.number().integer().min(0).optional()
            })
          )
        },
        response: {
          schema: {}
        }
      },
      handler (request, reply) {
        log.begin('Account.devicesNotify', request)

        // We reserve the right to disable notifications until
        // we're confident clients are behaving correctly.
        if (config.deviceNotificationsEnabled === false) {
          throw error.featureNotEnabled()
        }

        const body = request.payload
        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid
        const ip = request.app.clientAddress
        const payload = body.payload

        if (! validatePushPayload(payload)) {
          throw error.invalidRequestParameter('invalid payload')
        }

        const pushOptions = {
          data: Buffer.from(JSON.stringify(payload))
        }

        if (body.excluded) {
          pushOptions.excludedDeviceIds = body.excluded
        }

        if (body.TTL) {
          pushOptions.TTL = body.TTL
        }

        const endpointAction = 'devicesNotify'

        return customs.checkAuthenticated(endpointAction, ip, uid)
          .then(() => {
            if (body.to === 'all') {
              push.pushToAllDevices(uid, endpointAction, pushOptions)
                .catch(catchPushError)
            } else {
              push.pushToDevices(uid, body.to, endpointAction, pushOptions)
                .catch(catchPushError)
            }
          })
          .then(() => {
            // Emit a metrics event for when a user sends tabs between devices.
            // In the future we will aim to get this event directly from sync telemetry,
            // but we're doing it here for now as a quick way to get metrics on the feature.
            if (
              payload.command === 'sync:collection_changed' &&
              // Note that payload schema validation ensures that these properties exist.
              payload.data.collections.length === 1 &&
              payload.data.collections[0] === 'clients'
            ) {
              let deviceId = undefined

              if (sessionToken.deviceId) {
                deviceId = sessionToken.deviceId
              }

              return request.emitMetricsEvent('sync.sentTabToDevice', {
                device_id: deviceId,
                service: 'sync',
                uid: uid
              })
            }
          })
          .then(
            () => reply({}),
            reply
          )

        function catchPushError (err) {
          // push may fail due to not found devices or a bad push action
          // log the error but still respond with a 200.
          log.error({
            op: 'Account.devicesNotify',
            uid: uid,
            error: err
          })
        }
      }
    },
    {
      method: 'GET',
      path: '/account/devices',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: isA.array().items(isA.object({
            id: DEVICES_SCHEMA.id.required(),
            isCurrentDevice: isA.boolean().required(),
            lastAccessTime: isA.number().min(0).required().allow(null),
            lastAccessTimeFormatted: isA.string().optional().allow(''),
            name: DEVICES_SCHEMA.nameResponse.allow('').required(),
            type: DEVICES_SCHEMA.type.required(),
            pushCallback: DEVICES_SCHEMA.pushCallback.allow(null).optional(),
            pushPublicKey: DEVICES_SCHEMA.pushPublicKey.allow(null).optional(),
            pushAuthKey: DEVICES_SCHEMA.pushAuthKey.allow(null).optional(),
            pushEndpointExpired: DEVICES_SCHEMA.pushEndpointExpired.optional()
          }).and('pushPublicKey', 'pushAuthKey'))
        }
      },
      handler (request, reply) {
        log.begin('Account.devices', request)

        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid

        db.devices(uid)
          .then(deviceArray => {
            reply(deviceArray.map(device => {
              return {
                id: device.id,
                isCurrentDevice: device.sessionToken === sessionToken.tokenId,
                lastAccessTime: device.lastAccessTime,
                lastAccessTimeFormatted: localizeTimestamp.format(
                  device.lastAccessTime,
                  request.headers['accept-language']
                ),
                name: device.name || devices.synthesizeName(device),
                type: device.type || device.uaDeviceType || 'desktop',
                pushCallback: device.pushCallback,
                pushPublicKey: device.pushPublicKey,
                pushAuthKey: device.pushAuthKey,
                pushEndpointExpired: device.pushEndpointExpired
              }
            }))
          },
          reply
        )
      }
    },
    {
      method: 'GET',
      path: '/account/sessions',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: isA.array().items(isA.object({
            id: isA.string().regex(HEX_STRING).required(),
            lastAccessTime: isA.number().min(0).required().allow(null),
            lastAccessTimeFormatted: isA.string().optional().allow(''),
            createdTime: isA.number().min(0).required().allow(null),
            createdTimeFormatted: isA.string().optional().allow(''),
            location: isA.object({
              state: isA.string().allow(null),
              country: isA.string().allow(null)
            }),
            userAgent: isA.string().max(255).required().allow(''),
            os: isA.string().max(255).allow('').allow(null),
            deviceId: DEVICES_SCHEMA.id.allow(null).required(),
            deviceName: DEVICES_SCHEMA.nameResponse.allow('').allow(null).required(),
            deviceType: DEVICES_SCHEMA.type.allow(null).required(),
            deviceCallbackURL: DEVICES_SCHEMA.pushCallback.allow(null).required(),
            deviceCallbackPublicKey: DEVICES_SCHEMA.pushPublicKey.allow(null).required(),
            deviceCallbackAuthKey: DEVICES_SCHEMA.pushAuthKey.allow(null).required(),
            deviceCallbackIsExpired: DEVICES_SCHEMA.pushEndpointExpired.allow(null).required(),
            isDevice: isA.boolean().required(),
            isCurrentDevice: isA.boolean().required()
          }))
        }
      },
      handler (request, reply) {
        log.begin('Account.sessions', request)

        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid

        db.sessions(uid)
          .then(sessions => {
            reply(sessions.map(session => {
              const deviceId = session.deviceId
              const isDevice = !! deviceId

              let deviceName = session.deviceName
              if (! deviceName) {
                deviceName = devices.synthesizeName(session)
              }

              let userAgent
              if (! session.uaBrowser) {
                userAgent = ''
              } else if (! session.uaBrowserVersion) {
                userAgent = session.uaBrowser
              } else {
                userAgent = `${session.uaBrowser} ${session.uaBrowserVersion}`
              }

              return {
                deviceId,
                deviceName,
                deviceType: session.uaDeviceType || 'desktop',
                deviceCallbackURL: session.deviceCallbackURL,
                deviceCallbackPublicKey: session.deviceCallbackPublicKey,
                deviceCallbackAuthKey: session.deviceCallbackAuthKey,
                deviceCallbackIsExpired: session.deviceCallbackIsExpired,
                id: session.tokenId,
                isCurrentDevice: session.tokenId === sessionToken.tokenId,
                isDevice,
                location: {
                  state: session.location && session.location.state,
                  country: session.location && session.location.country
                },
                lastAccessTime: session.lastAccessTime,
                lastAccessTimeFormatted: localizeTimestamp.format(
                  session.lastAccessTime,
                  request.headers['accept-language']
                ),
                createdTime: session.createdAt,
                createdTimeFormatted: localizeTimestamp.format(
                  session.createdAt,
                  request.headers['accept-language']
                ),
                os: session.uaOS,
                userAgent
              }
            }))
          },
          reply
        )
      }
    },
    {
      method: 'POST',
      path: '/account/device/destroy',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            id: DEVICES_SCHEMA.id.required()
          }
        },
        response: {
          schema: {}
        }
      },
      handler (request, reply) {
        log.begin('Account.deviceDestroy', request)

        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid
        const id = request.payload.id
        let result

        return push.notifyDeviceDisconnected(uid, id)
          .catch(() => {})
          .then(() => db.deleteDevice(uid, id))
          .then(res => {
            result = res
            return P.all([
              request.emitMetricsEvent('device.deleted', {
                uid: uid,
                device_id: id
              }),
              log.notifyAttachedServices('device:delete', request, {
                uid: uid,
                id: id,
                timestamp: Date.now()
              })
            ])
          })
          .then(() => result)
          .then(reply, reply)
      }
    }
  ]
}

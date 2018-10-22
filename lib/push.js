/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const crypto = require('crypto')
const base64url = require('base64url')
const webpush = require('web-push')
const P = require('./promise')

const ERR_NO_PUSH_CALLBACK = 'No Push Callback'
const ERR_DATA_BUT_NO_KEYS = 'Data payload present but missing key(s)'
const ERR_TOO_MANY_TARGETS = 'Too many targets connected to account'

const LOG_OP_PUSH_TO_TARGETS = 'push.sendPush'

const PUSH_PAYLOAD_SCHEMA_VERSION = 1
const PUSH_COMMANDS = {
  DEVICE_CONNECTED: 'fxaccounts:device_connected',
  DEVICE_DISCONNECTED: 'fxaccounts:device_disconnected',
  PROFILE_UPDATED: 'fxaccounts:profile_updated',
  PASSWORD_CHANGED: 'fxaccounts:password_changed',
  PASSWORD_RESET: 'fxaccounts:password_reset',
  ACCOUNT_DESTROYED: 'fxaccounts:account_destroyed',
  COMMAND_RECEIVED: 'fxaccounts:command_received'
}

const TTL_DEVICE_DISCONNECTED = 5 * 3600 // 5 hours
const TTL_PASSWORD_CHANGED = 6 * 3600 // 6 hours
const TTL_PASSWORD_RESET = TTL_PASSWORD_CHANGED
const TTL_ACCOUNT_DESTROYED = TTL_DEVICE_DISCONNECTED
const TTL_COMMAND_RECEIVED = TTL_PASSWORD_CHANGED

// An arbitrary, but very generous, limit on the number of active targets.
// Currently only for metrics purposes, not enforced.
const MAX_ACTIVE_TARGETS = 200

const pushReasonsToEvents = (() => {
  const reasons = ['accountVerify', 'accountConfirm', 'passwordReset',
    'passwordChange', 'deviceConnected', 'deviceDisconnected',
    'profileUpdated', 'devicesNotify', 'accountDestroyed',
    'commandReceived']
  const events = {}
  for (const reason of reasons) {
    const id = reason.replace(/[A-Z]/, c => `_${c.toLowerCase()}`) // snake-cased.
    events[reason] = {
      send: `push.${id}.send`,
      success: `push.${id}.success`,
      resetSettings: `push.${id}.reset_settings`,
      failed: `push.${id}.failed`,
      noCallback: `push.${id}.no_push_callback`,
      noKeys: `push.${id}.data_but_no_keys`
    }
  }
  return events
})()

/**
 * A device object returned by the db,
 * typically obtained by calling db.devices(uid).
 * @typedef {Object} Device
 * A client instance returned by the db,
 * typically obtained by calling db.clientsMetadata
 * @typedef {Object} ClientInstance
 */

module.exports = function (log, db, config) {
  let vapid
  if (config.vapidKeysFile) {
    const {privateKey, publicKey} = require(config.vapidKeysFile)
    vapid = {
      privateKey,
      publicKey,
      subject: config.publicUrl
    }
  }

  /**
   * Reports push errors to logs
   * @param {Error} err
   * @param {String} uid
   * @param {String} targetId
   */
  function reportPushError(err, uid, targetId) {
    log.error({
      op: LOG_OP_PUSH_TO_TARGETS,
      uid,
      targetId,
      err
    })
  }

  /**
   * Reports push increment actions to logs
   * @param {String} name
   */
  function incrementPushAction(name) {
    if (name) {
      log.info({
        op: LOG_OP_PUSH_TO_TARGETS,
        name: name
      })
    }
  }

  /**
   * Firefox for iOS clients don't yet support all commands types, and due to
   * platform limitations they have to show some bad fallback UX
   * if they receive an unsupported message type.  Filter out
   * targets that we know won't respond well to the given command.
   *
   * @param {Object} payload Push message payload
   * @param {Array<Device|ClientInstance>} targets List of targets to which to send the push.
   */
  function filterSupportedTargets(payload, targets) {
    const command = (payload && payload.command) || null
    let canSendToIOSVersion/* ({Number} version) => bool */
    switch (command) {
    case 'fxaccounts:command_received':
      canSendToIOSVersion = () => true
      break
    case 'sync:collection_changed':
      canSendToIOSVersion = () => payload.data.reason !== 'firstsync'
      break
    case null: // In the null case this is an account verification push message
      canSendToIOSVersion = (deviceVersion, deviceBrowser) => {
        return deviceVersion >= 10.0 && deviceBrowser === 'Firefox Beta'
      }
      break
    case 'fxaccounts:device_connected':
    case 'fxaccounts:device_disconnected':
      canSendToIOSVersion = deviceVersion => deviceVersion >= 10.0
      break
    default:
      canSendToIOSVersion = () => false
    }
    return targets.filter(function(target) {
      // ClientInstances don't have a uaOS property, therefore will never get filtered.
      const deviceOS = target.uaOS && target.uaOS.toLowerCase()
      if (deviceOS === 'ios') {
        const deviceVersion = target.uaBrowserVersion ? parseFloat(target.uaBrowserVersion) : 0
        const deviceBrowserName = target.uaBrowser
        if (! canSendToIOSVersion(deviceVersion, deviceBrowserName)) {
          log.info({
            op: 'push.filteredUnsupportedDevice',
            command: command,
            uaOS: target.uaOS,
            uaBrowserVersion: target.uaBrowserVersion
          })
          return false
        }
      }
      return true
    })
  }

  /**
   * Checks whether the given string is a valid public key for push.
   * This is a little tricky because we need to work around a bug in nodejs
   * where using an invalid ECDH key can cause a later (unrelated) attempt
   * to generate an RSA signature to fail:
   *
   *   https://github.com/nodejs/node/pull/13275
   *
   * @param key
   * The public key as a b64url string.
   */

  const dummySigner = crypto.createSign('RSA-SHA256')
  const dummyKey = Buffer.alloc(0)
  const dummyCurve = crypto.createECDH('prime256v1')
  dummyCurve.generateKeys()

  function isValidPublicKey(publicKey) {
    // Try to use the key in an ECDH agreement.
    // If the key is invalid then this will throw an error.
    try {
      dummyCurve.computeSecret(base64url.toBuffer(publicKey))
      return true
    } catch (err) {
      log.info({
        op: 'push.isValidPublicKey',
        name: 'Bad public key detected'
      })
      // However!  The above call might have left some junk
      // sitting around on the openssl error stack.
      // Clear it by deliberately triggering a signing error
      // before anything yields the event loop.
      try {
        dummySigner.sign(dummyKey)
      } catch (e) {}
      return false
    }
  }

  return {
    isValidPublicKey,

    /**
     * Notify targets that a new command is ready to be retrieved.
     *
     * @param {String} uid
     * @param {Device|ClientInstance} target
     * @param {Number} index - index of the newly-enqueued command
     * @param {String} url - url to retrieve the command details.
     * @param {String} topic
     * @param {String} reason
     * @returns {Promise}
     */
    notifyCommandReceived(uid, target, command, sender, index, url, ttl) {
      if (typeof ttl === 'undefined') {
        ttl = TTL_COMMAND_RECEIVED
      }
      const options = {
        data: {
          version: PUSH_PAYLOAD_SCHEMA_VERSION,
          command: PUSH_COMMANDS.COMMAND_RECEIVED,
          data: {
            command,
            index,
            sender,
            url
          }
        },
        TTL: ttl
      }
      return this.sendPush(uid, [target], 'commandReceived', options)
    },

    /**
     * Notify targets that a new device was connected
     *
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @param {String} deviceName
     * @promise
     */
    notifyDeviceConnected(uid, targets, deviceName) {
      return this.sendPush(uid, targets, 'deviceConnected', {
        data: {
          version: PUSH_PAYLOAD_SCHEMA_VERSION,
          command: PUSH_COMMANDS.DEVICE_CONNECTED,
          data: {
            deviceName
          }
        }
      })
    },

    /**
     * Notify targets that a device was disconnected from the account
     *
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @param {String} idToDisconnect
     * @promise
     */
    notifyDeviceDisconnected(uid, targets, idToDisconnect) {
      return this.sendPush(uid, targets, 'deviceDisconnected', {
        data: {
          version: PUSH_PAYLOAD_SCHEMA_VERSION,
          command: PUSH_COMMANDS.DEVICE_DISCONNECTED,
          data: {
            id: idToDisconnect
          }
        },
        TTL: TTL_DEVICE_DISCONNECTED
      })
    },

    /**
     * Notify targets that the profile attached to the account was updated
     *
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @promise
     */
    notifyProfileUpdated(uid, targets) {
      return this.sendPush(uid, targets, 'profileUpdated', {
        data: {
          version: PUSH_PAYLOAD_SCHEMA_VERSION,
          command: PUSH_COMMANDS.PROFILE_UPDATED
        }
      })
    },

    /**
     * Notify targets that the password was changed
     *
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @promise
     */
    notifyPasswordChanged(uid, targets) {
      return this.sendPush(uid, targets, 'passwordChange', {
        data: {
          version: PUSH_PAYLOAD_SCHEMA_VERSION,
          command: PUSH_COMMANDS.PASSWORD_CHANGED
        },
        TTL: TTL_PASSWORD_CHANGED
      })
    },

    /**
     * Notify targets that the password was reset
     *
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @promise
     */
    notifyPasswordReset(uid, targets) {
      return this.sendPush(uid, targets, 'passwordReset', {
        data: {
          version: PUSH_PAYLOAD_SCHEMA_VERSION,
          command: PUSH_COMMANDS.PASSWORD_RESET
        },
        TTL: TTL_PASSWORD_RESET
      })
    },

    /**
     * Notify targets that there was an update to the account
     *
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @param {String} reason
     * @promise
     */
    notifyAccountUpdated(uid, targets, reason) {
      return this.sendPush(uid, targets, reason)
    },

    /**
     * Notify targets that the account no longer exists
     *
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @promise
     */
    notifyAccountDestroyed(uid, targets) {
      return this.sendPush(uid, targets, 'accountDestroyed', {
        data: {
          version: PUSH_PAYLOAD_SCHEMA_VERSION,
          command: PUSH_COMMANDS.ACCOUNT_DESTROYED,
          data: {
            uid
          }
        },
        TTL: TTL_ACCOUNT_DESTROYED
      })
    },

    /**
     * Send a push notification with or without data to a list of targets
     * @param {String} uid
     * @param {Array<Device|ClientInstance>} targets
     * @param {String} reason
     * @param {Object} [options]
     * @param {Object} [options.data]
     * @param {Number} [options.TTL] (in seconds)
     * @return {Promise}
     */
    async sendPush(uid, targets, reason, options = {}) {
      targets = filterSupportedTargets(options.data, targets)
      const events = pushReasonsToEvents[reason]
      if (! events) {
        return P.reject(`Unknown push reason: ${reason}`)
      }
      // There's no spec-compliant way to error out as a result of having
      // too many targets to notify. For now, just log metrics about it.
      if (targets.length > MAX_ACTIVE_TARGETS) {
        reportPushError(new Error(ERR_TOO_MANY_TARGETS), uid, null)
      }
      for (const target of targets) {
        const targetId = target.id
        const isDevice = target.hasOwnProperty('type')
        const pushCallback = isDevice ? target.pushCallback : target.pushEndpoint
        const pushEndpointExpired = isDevice ? target.pushEndpointExpired : false /* No such field in ClientInstance */
        const {pushPublicKey, pushAuthKey} = target

        log.trace({
          op: LOG_OP_PUSH_TO_TARGETS,
          uid,
          targetId,
          pushCallback
        })

        if (! pushCallback || pushEndpointExpired) {
          // Keep track if there are any devices with no push urls.
          reportPushError(new Error(ERR_NO_PUSH_CALLBACK), uid, targetId)
          incrementPushAction(events.noCallback)
          continue
        }

        // Send the push notification
        incrementPushAction(events.send)
        const pushSubscription = { endpoint: pushCallback }
        let pushPayload = null
        const pushOptions = { 'TTL': options.TTL || '0' }
        if (options.data) {
          if (! pushPublicKey || ! pushAuthKey) {
            reportPushError(new Error(ERR_DATA_BUT_NO_KEYS), uid, targetId)
            incrementPushAction(events.noKeys)
            continue
          }
          pushSubscription.keys = {
            p256dh: pushPublicKey,
            auth: pushAuthKey
          }
          pushPayload = Buffer.from(JSON.stringify(options.data))
        }
        if (vapid) {
          pushOptions.vapidDetails = vapid
        }
        try {
          await webpush.sendNotification(pushSubscription, pushPayload, pushOptions)
          incrementPushAction(events.success)
        } catch (err) {
          // If we've stored an invalid key in the db for some reason, then we
          // might get an encryption failure here.  Check the key, which also
          // happens to work around bugginess in node's handling of said failures.
          const keyWasInvalid = ! err.statusCode && pushPublicKey && ! isValidPublicKey(pushPublicKey)
          // 404 or 410 error from the push servers means
          // the push settings need to be reset.
          // the clients will check this and re-register push endpoints
          if (isDevice && (err.statusCode === 404 || err.statusCode === 410 || keyWasInvalid)) {
            // set the push endpoint expired flag
            // Warning: this method is called without any session tokens or auth validation.
            target.pushEndpointExpired = true
            try {
              await db.updateDevice(uid, null, target)
            } catch (err) {
              reportPushError(err, uid, targetId)
            }
            incrementPushAction(events.resetSettings)
          } else {
            reportPushError(err, uid, targetId)
            incrementPushAction(events.failed)
          }
        }
      }
    }
  }
}


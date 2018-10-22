/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const error = require('./error')
const Pool = require('./pool')

/**
 * @typedef {Object} ClientInstance
 * @property {string} id Client Instance ID
 * @property {string} clientId
 * @property {string} pushEndpoint
 * @property {string} pushPublicKey
 * @property {string} pushAuthKey
 * @property {Object} availableCommands
 */
module.exports = (log, db, config) => {
  const SafeUrl = require('./safe-url')(log)
  const path = new SafeUrl('/v1/refresh-tokens/:uid')
  const pool = new Pool(config.oauth.url, { timeout: 15000 })
  const headers = {Authorization: `FxA-Shared-Secret ${config.oauth.sharedSecretKey}`}
  return {
    /**
     * @param {String} uid
     * @returns {ClientInstance[]}
     */
    async getClientsInstances(uid) {
      const params = {uid: uid.toString('hex')}
      // Refresh tokens are the clients list authority, whether we have
      // stored metadata or not is irrelevant.
      const refreshTokens = await pool.get(path, params, {headers})
      const knownInstances = await db.clientsInstances(uid)
      const knownInstancesById = new Map(knownInstances.map(instance => [instance.id, instance]))
      // We use a map to avoid having duplicate instanceIDs
      // (multiple refresh tokens can have the same instance ID).
      const instancesById = new Map(refreshTokens.map(({ clientId, instanceId }) => {
        const metadata = knownInstancesById.get(instanceId) || {
          id: instanceId,
          clientId,
          name: null,
          pushEndpoint: null,
          pushPublicKey: null,
          pushAuthKey: null,
          availableCommands: {},
        }
        return [instanceId, metadata]
      }))
      return [...instancesById.values()]
    },

    /**
     * Retrieves all the device records AND the client instances records in an account
     * for use with Push.
     * @param {String} uid
     * @returns {PushTarget[]}
     */
    async accountPushClientsAndDevices(uid) {
      const [devices, clientsInstances] = await Promise.all([db.devices(uid), this.getClientsInstances(uid)])
      return [...devices, ...clientsInstances]
    },

    /**
     * Finds a device with the corresponding ID. If not found,
     * try finding a client instance with the same ID.
     * @param {String} uid
     * @param {String} id Device ID or Client Instance ID
     */
    async findDeviceOrClientInstance(uid, id) {
      try {
        return await db.device(uid, id)
      } catch (err) {
        if (err.errno !== 123 /* Unknown device */) {
          throw err
        }
      }
      const clientInstance = await db.clientInstance(uid, id)
      if (! clientInstance) {
        throw error.unknownDevice()
      }
      return clientInstance
    },

    /**
     * Does the same thing as findDeviceOrClientInstance,
     * but looks for a client instance first.
     * @param {String} uid
     * @param {String} id Client Instance ID or Device ID
     */
    async findClientInstanceOrDevice(uid, id) {
      const clientInstance = await db.clientInstance(uid, id)
      if (clientInstance) {
        return clientInstance
      }
      return db.device(uid, id)
    }
  }
}

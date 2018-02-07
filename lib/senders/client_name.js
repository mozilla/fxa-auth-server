/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const request = require('request')
const config = require('../../config').getProperties()
const log = require('./log')('db')

const OAUTH_SERVER = config.oauth.url
const clientCache = {}
const FIREFOX_CLIENT = {
  name: 'Firefox'
}

/**
 * Fetches OAuth client data from the OAuth server.
 * Stores the data into server memory.
 * @param clientId
 * @returns {Promise<any>}
 */
function fetchClientData(clientId) {
  log.trace({ op: 'fetchClientData.start' })

  const options = {
    url: `${OAUTH_SERVER}/v1/client/${clientId}`,
    method: 'GET',
    json: true
  }

  return new Promise((resolve) => {
    if (! clientId || clientId === 'sync') {
      log.trace({ op: 'fetchClientData.sync' })
      return resolve(FIREFOX_CLIENT)
    }

    if (clientCache[clientId]) {
      log.trace({ op: 'fetchClientData.usedCache' })
      return resolve(clientCache[clientId])
    }

    request(options, function (err, res, body) {
      if (err) {
        log.critical({ op: 'fetchClientData.failed', err: err })
        // fallback to the Firefox client if request fails
        return resolve(FIREFOX_CLIENT)
      }

      clientCache[clientId] = body
      log.trace({ op: 'fetchClientData.usedServer', body: body })
      resolve(clientCache[clientId])
    })
  })


}
module.exports = {
  fetchClientData: fetchClientData
}

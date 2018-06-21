/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const config = require('../config').getProperties()
const hapi = require('hapi')
const url = require('url')
const P = require('../lib/promise')

module.exports = async () => {

  return new P((resolve, reject) => {
    const api = new hapi.Server({
      host: url.parse(config.oauth.url).hostname,
      port: parseInt(url.parse(config.oauth.url).port)
    })

    api.route(
      {
        method: 'POST',
        path: '/v1/verify',
        handler: function (request, h) {
          const data = JSON.parse(Buffer.from(request.payload.token, 'hex'))
          return h.response(data).code(data.code || 200)
        }
      }
    )

    api.start().then(() => {
      resolve({
        close() {
          return new P((resolve, reject) => {
            api.stop().then(() => {
              resolve()
            }).catch((err) => {
              return reject(err)
            })
          })
        }
      })
    }).catch((err) => {
      console.log(err) // eslint-disable-line no-console
      return reject(err)
    })
  })
}

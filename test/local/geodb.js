/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const { assert } = require('chai')
const proxyquire = require('proxyquire')
const mockLog = require('../mocks').mockLog
const modulePath = '../../lib/geodb'

describe('geodb', () => {
  it(
    'returns location data when enabled',
    () => {
      const moduleMocks = {
        '../config': {
          'get': function (item) {
            if (item === 'geodb') {
              return {
                enabled: true
              }
            }
          }
        }
      }
      const thisMockLog = mockLog({})

      const getGeoData = proxyquire(modulePath, moduleMocks)(thisMockLog)
      const geoData = getGeoData('63.245.221.32') // Oakland
      assert.equal(geoData.location.city, 'Oakland')
      assert.equal(geoData.location.country, 'United States')
      assert.equal(geoData.location.countryCode, 'US')
      assert.equal(geoData.timeZone, 'America/Los_Angeles')
      assert.equal(geoData.location.state, 'California')
      assert.equal(geoData.location.stateCode, 'CA')
    }
  )

  it(
    'returns empty object data when disabled',
    () => {
      const moduleMocks = {
        '../config': {
          'get': function (item) {
            if (item === 'geodb') {
              return {
                enabled: false
              }
            }
          }
        }
      }
      const thisMockLog = mockLog({})

      const getGeoData = proxyquire(modulePath, moduleMocks)(thisMockLog)
      const geoData = getGeoData('8.8.8.8')
      assert.deepEqual(geoData, {})
    }
  )
})

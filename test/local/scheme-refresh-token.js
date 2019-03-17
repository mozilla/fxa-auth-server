/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const { assert } = require('chai')
const schemeRefreshToken = require('../../lib/scheme-refresh-token')
const sinon = require('sinon')

describe('lib/scheme-refresh-token', () => {
  let db
  let oauthdb
  let response

  beforeEach(() => {
    db = {
      devices: sinon.spy(() => Promise.resolve([
        {
          id: '5eb89097bab6551de3614facaea59cab',
          refreshTokenId: '40f61392cf69b0be709fbd3122d0726bb32247b476b2a28451345e7a5555cec7',
          isCurrentDevice: false,
          location: {},
          name: 'first device',
          type: 'mobile',
          pushCallback: null,
          pushPublicKey: null,
          pushAuthKey: null,
          pushEndpointExpired: false,
          availableCommands: {},
          lastAccessTime: 1552338763337,
          lastAccessTimeFormatted: 'a few seconds ago'
        }
      ]))
    }

    oauthdb = {
      checkRefreshToken: sinon.spy(() => () => Promise.resolve({})),
      getClientInfo: sinon.spy(() => Promise.resolve({
        id: '3c49430b43dfba77',
        name: 'Android Components Reference Browser',
        trusted: true,
        image_uri: '',
        redirect_uri: 'http://127.0.0.1:3030/oauth/success/3c49430b43dfba77'
      })),
    }

    response = {
      unauthenticated: sinon.spy(() => {}),
      authenticated: sinon.spy(() => {})
    }
  })

  it('handles bad authorization header', async () => {
    const scheme = schemeRefreshToken()
    try {
      await scheme().authenticate({
        headers: {
          authorization: 'Bad Auth'
        }
      })
    } catch (err) {
      assert.equal(err.message, 'Invalid parameter in request body')
    }
  })

  it('handles bad refresh token format', async () => {
    const scheme = schemeRefreshToken()
    try {
      await scheme().authenticate({
        headers: {
          authorization: 'Bearer Foo'
        }
      })
    } catch (err) {
      assert.equal(err.message, 'Invalid parameter in request body')
    }
  })

  it('works with a good authorization header', async () => {
    const scheme = schemeRefreshToken(db, oauthdb)
    await scheme().authenticate({
      headers: {
        authorization: 'Bearer B53DF2CE2BDB91820CB0A5D68201EF87D8D8A0DFC11829FB074B6426F537EE78'
      }
    }, response)

    assert.isTrue(response.unauthenticated.calledOnce)
    assert.isFalse(response.authenticated.calledOnce)
  })

  it('authenticates with devices', async () => {
    oauthdb.checkRefreshToken = sinon.spy(() => Promise.resolve({
      active: true,
      sub: '620203b5773b4c1d968e1fd4505a6885',
      jti: '40f61392cf69b0be709fbd3122d0726bb32247b476b2a28451345e7a5555cec7'
    }))

    const scheme = schemeRefreshToken(db, oauthdb)
    await scheme().authenticate({
      headers: {
        authorization: 'Bearer B53DF2CE2BDB91820CB0A5D68201EF87D8D8A0DFC11829FB074B6426F537EE78'
      }
    }, response)

    assert.isFalse(response.unauthenticated.called)
    assert.isTrue(response.authenticated.calledOnce)
    assert.deepEqual(response.authenticated.args[0][0].credentials, {
      uid: '620203b5773b4c1d968e1fd4505a6885',
      tokenVerified: true,
      deviceId: '5eb89097bab6551de3614facaea59cab',
      deviceName: 'first device',
      deviceType: 'mobile',
      client: {
        id: '3c49430b43dfba77',
        image_uri: '',
        name: 'Android Components Reference Browser',
        redirect_uri: 'http://127.0.0.1:3030/oauth/success/3c49430b43dfba77',
        trusted: true
      },
      refreshTokenId: '40f61392cf69b0be709fbd3122d0726bb32247b476b2a28451345e7a5555cec7',
      deviceAvailableCommands: {},
      deviceCallbackAuthKey: undefined,
      deviceCallbackIsExpired: undefined,
      deviceCallbackPublicKey: undefined,
      deviceCallbackURL: undefined,
      deviceCreatedAt: undefined,
    })
  })
})

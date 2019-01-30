/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jshint camelcase: false*/
const Joi = require('joi');
const AppError = require('../error');
const db = require('../db');
const encrypt = require('../encrypt');
const validators = require('../validators');
const hex = require('buf').to.hex;

const PAYLOAD_SCHEMA = Joi.object({
  token: Joi.string().required(),
  token_type_hint: Joi.string().allow('refresh_token')
});

module.exports = {
  validate: {
    payload: PAYLOAD_SCHEMA.options({ stripUnknown: true })
  },
  response: {
    schema: Joi.object().keys({
      // https://tools.ietf.org/html/rfc7662#section-2.2
      active: Joi.boolean().required(),
      scope: validators.scope.optional(),
      client_id: validators.clientId.optional(),
      username: Joi.string(),
      token_type: Joi.string().allow('refresh_token'),
      //exp: Joi.number(), // expiry time
      iat: Joi.number(), // issue time
      nbf: Joi.number(), // no use before time
      sub: Joi.string().required(), // subject
      aud: Joi.string(), // audience
      iss: Joi.string(), // issuer
      jti: Joi.string().required(), // string identifier, as defined in JWT
      email: Joi.string().required(),
      last_used_at: Joi.any().required(),
      profile_changed_at: Joi.any().required(),
    })
  },
  handler: async function tokenEndpoint(req) {
    let refreshToken;
    console.log('pppp', req.payload)
    try {
      refreshToken = await db.getRefreshToken(encrypt.hash(req.payload.token));
    } catch (err) {

      throw new AppError.invalidToken();
      // TODO - add some logging here
    }


    const response = {
      active: !! refreshToken
    };

    console.log('refreshToken', refreshToken)

    if (refreshToken) {
      Object.assign(response, {
        //scope: refreshToken.scope,
        scope: 'profile https://identity.mozilla.com/apps/oldsync',
        client_id: hex(refreshToken.clientId),
        // username
        token_type: 'refresh_token',
        // exp
        iat: refreshToken.createdAt.getTime(),
        nbf: refreshToken.createdAt.getTime(),
        sub: hex(refreshToken.userId),
        jti: hex(refreshToken.token),
        email: refreshToken.email,
        last_used_at: refreshToken.lastUsedAt.getTime(),
        profile_changed_at: refreshToken.profileChangedAt,
      });
    }
    return response;
  }
};

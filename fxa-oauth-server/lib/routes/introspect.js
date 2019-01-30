/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jshint camelcase: false*/
const Joi = require('joi');

const db = require('../db');
const encrypt = require('../encrypt');
const validators = require('../validators');


const PAYLOAD_SCHEMA = Joi.object({
  token: validators.token.required(),
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
      exp: Joi.number(), // expiry time
      iat: Joi.number(), // issue time
      nbf: Joi.number(), // no use before time
      sub: validators.string().required(), // subject
      aud: Joi.string(), // audience
      iss: Joi.string(), // issuer
      jti: validators.token.required(), // string identifier, as defined in JWT
      email: validators.email().required(),
      last_used_at: Joi.any().required(),
      profile_changed_at: Joi.any().required(),
    })
  },
  handler: async function tokenEndpoint(req) {
    let refreshToken;

    try {
      refreshToken = await db.getRefreshToken(encrypt.hash(req.payload.refresh_token));
    } catch (err) {
      // TODO - add some logging here
    }

    const response = {
      active: !! refreshToken
    };

    if (refreshToken) {
      Object.assign(response, {
        scope: refreshToken.scope,
        client_id: refreshToken.clientId,
        // username
        token_type: 'refresh_token',
        // exp
        iat: refreshToken.createdAt,
        nbf: refreshToken.createdAt,
        sub: refreshToken.userId,
        jti: refreshToken.token,
        email: refreshToken.email,
        last_used_at: refreshToken.lastUsedAt,
        profile_changed_at: refreshToken.profileChangedAt,
      });
    }
    return response;
  }
};

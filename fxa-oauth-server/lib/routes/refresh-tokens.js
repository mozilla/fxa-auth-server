/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Joi = require('joi');

const db = require('../db');
const hex = require('buf').to.hex;
const validators = require('../validators');

function serialize (refreshToken) {
  return {
    token: hex(refreshToken.token),
    clientId: hex(refreshToken.clientId),
    instanceId: hex(refreshToken.instanceId),
    userId: hex(refreshToken.userId),
    email: refreshToken.email,
    scope: refreshToken.scope,
    createdAt: refreshToken.createdAt,
    lastUsedAt: refreshToken.lastUsedAt,
    profileChangedAt: refreshToken.profileChangedAt,
  };
}

module.exports = {
  validate: {
    params: {
      uid: validators.uid
    }
  },
  response: {
    schema: Joi.array().items(Joi.object({
      token: validators.token.required(),
      clientId: validators.clientId.required(),
      userId: Joi.string().required(),
      scope: Joi.array().items(Joi.string()),
      instanceId: validators.instanceId.optional(),
    }))
  },
  auth: {
    strategy: 'authServerSecret'
  },
  async handler(req) {
    const {uid} = req.params;
    const refreshTokens = await db.getRefreshTokensForUser(uid).map(serialize);
    return refreshTokens.map(t => {
      return {
        token: t.token,
        clientId: t.clientId,
        userId: t.userId,
        scope: t.scope.getScopeValues(),
        instanceId: t.instanceId,
      };
    });
  }
};

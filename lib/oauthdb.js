/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

/* Operations on OAuth database state.
 *
 * Currently this is not actually talking to a database,
 * it's making authenticated calls to the fxa-oauth-server API
 * to interrogate and manipulate its state, essentially treating
 * fxa-oauth-server as a kind of backend micro-service.
 *
 * We want to work towards merging the fxa-oauth-server code
 * directly into the main fxa-auth-server process, at which point
 * this abstraction will convert into more direct db access.
 *
 */

const P = require('./promise')

const Joi = require('joi')
const signJWT = P.promisify(require('jsonwebtoken').sign)

const createBackendServiceAPI = require('./backendService')
const error = require('./error')
const validators = require('./routes/validators')

// TODO: hook it up
const MAX_TTL_S = 604800000 / 1000; // 2 weeks ms? / 1000
const GRANT_AUTHORIZATION_CODE = 'authorization_code';
const GRANT_REFRESH_TOKEN = 'refresh_token';

const TOKEN_PAYLOAD_SCHEMA = Joi.object({

  client_id: validators.clientId
    .when('$headers.authorization', {
      is: Joi.string().required(),
      then: Joi.forbidden()
    }),

  client_secret: validators.clientSecret
    .when('code_verifier', {
      is: Joi.string().required(), // if (typeof code_verifier === 'string') {
      then: Joi.forbidden()
    })
    .when('grant_type', {
      is: GRANT_REFRESH_TOKEN,
      then: Joi.optional()
    })
    .when('$headers.authorization', {
      is: Joi.string().required(),
      then: Joi.forbidden()
    }),

  code_verifier: validators.codeVerifier,

  redirect_uri: validators.redirectUri.optional(),

  grant_type: Joi.string()
    .valid(GRANT_AUTHORIZATION_CODE, GRANT_REFRESH_TOKEN)
    .default(GRANT_AUTHORIZATION_CODE)
    .optional(),

  ttl: Joi.number()
    .positive()
    .max(MAX_TTL_S)
    .default(MAX_TTL_S)
    .optional(),

  scope: validators.scope
    .when('grant_type', {
      is: GRANT_REFRESH_TOKEN,
      otherwise: Joi.forbidden()
    }),

  code: Joi.string()
    //.length(config.get('unique.code') * 2)
    .length(32 * 2)
    .regex(validators.HEX_STRING)
    .required()
    .when('grant_type', {
      is: GRANT_AUTHORIZATION_CODE,
      otherwise: Joi.forbidden()
    }),

  refresh_token: validators.token
    .required()
    .when('grant_type', {
      is: GRANT_REFRESH_TOKEN,
      otherwise: Joi.forbidden()
    })

});

// The oauth-server's error numbers overlap and conflict
// with the auth-server's, so we have to map them to new ones.
function mapOAuthError(log, err) {
  // If it's already an instance of our internal error type,
  // then just return it as-is.
  if (err instanceof error) {
    return err
  }
  switch (err.errno) {
    case 101:
      return error.unknownClientId(err.clientId)
    case 119:
      return error.staleAuthAt(err.authAt)
    default:
      log.warn({
        op: 'oauthdb.mapOAuthError',
        err: err,
        errno: err.errno,
        warning: 'unmapped oauth-server errno'
      })
      return error.unexpectedError()
  }
}

module.exports = (log, config) => {

  const OAuthAPI = createBackendServiceAPI(log, config, 'oauth', {

    getClientInfo: {
      path: '/v1/client/:clientId',
      method: 'GET',
      validate: {
        params: {
          clientId: validators.clientId.required()
        },
        response: {
          id: validators.clientId.required(),
          name: Joi.string().max(255).regex(validators.DISPLAY_SAFE_UNICODE).required(),
          trusted: Joi.boolean().required(),
          image_uri: Joi.string().optional().allow(''),
          redirect_uri: Joi.string().required().allow('')
        }
      }
    },

    getScopedKeyData: {
      path: '/v1/key-data',
      method: 'POST',
      validate: {
        payload: {
          client_id: validators.clientId.required(),
          assertion: validators.assertion.required(),
          scope: validators.scope.required()
        },
        response: Joi.object().pattern(Joi.any(), Joi.object({
          identifier: validators.scope.required(),
          keyRotationSecret: validators.hexString.length(64).required(),
          keyRotationTimestamp: Joi.number().required(),
        }))
      }
    },

    postVerifyToken: {
      path: '/v1/verify',
      method: 'POST',
      validate: {
        payload: {
          token: validators.token.required(),
        },
        response: {
            user: Joi.string().required(),
            client_id: Joi.string().required(),
            scope: Joi.array(),
            profile_changed_at: Joi.number().min(0)
        }
      }
    },

    postToken: {
      path: '/v1/token',
      method: 'POST',
      validate: {
        payload: TOKEN_PAYLOAD_SCHEMA,
        response: Joi.object().keys({
          access_token: validators.token.required(),
          refresh_token: validators.token,
          id_token: validators.assertion,
          scope: validators.scope.required(),
          token_type: Joi.string().valid('bearer').required(),
          expires_in: Joi.number().max(MAX_TTL_S).required(),
          auth_at: Joi.number(),
          keys_jwe: validators.jwe.optional()
        })
      }
    }
  })

  // Make a symmetrically-signed JWT assertion that we can pass to
  // fxa-oauth-server in lieu of a full-blown BrowserID assertion.

  function makeAssertionJWT(credentials) {
    if (! credentials.emailVerified) {
      throw error.unverifiedAccount()
    }
    if (credentials.mustVerify && ! credentials.tokenVerified) {
      throw error.unverifiedSession()
    }
    const opts = {
      algorithm: 'HS256',
      expiresIn: 60,
      audience: config.oauth.url,
      issuer: config.domain
    }
    const claims = {
      'sub': credentials.uid,
      'fxa-generation': credentials.verifierSetAt,
      'fxa-verifiedEmail': credentials.email,
      'fxa-lastAuthAt': credentials.lastAuthAt(),
      'fxa-tokenVerified': credentials.tokenVerified,
      'fxa-amr': Array.from(credentials.authenticationMethods),
      'fxa-aal': credentials.authenticatorAssuranceLevel
    }
    return signJWT(claims, config.oauth.secretKey, opts)
  }

  const api = new OAuthAPI(config.oauth.url, config.oauth.poolee)

  return {

    close() {
      api.close()
    },

    async getClientInfo(clientId) {
      try {
        return await api.getClientInfo(clientId)
      } catch (err) {
        throw mapOAuthError(log, err)
      }
    },

    async getScopedKeyData(sessionToken, oauthParams) {
      oauthParams.assertion = await makeAssertionJWT(sessionToken)
      try {
        return await api.getScopedKeyData(oauthParams)
      } catch (err) {
        throw mapOAuthError(log, err)
      }
    },

    async postToken(payload) {
      try {
        return await api.postToken(payload)
      } catch (err) {
        throw mapOAuthError(log, err)
      }
    },

    async postVerifyToken(token) {
      try {
        return await api.postVerifyToken(token)
      } catch (err) {
        throw mapOAuthError(log, err)
      }
    },

    /* As we work through the process of merging oauth-server
     * into auth-server, future methods we might want to include
     * here will be things like the following:

    async getClientInstances(account) {
    },

    async createAuthorizationCode(account, params) {
    }

    async redeemAuthorizationCode(account, params) {
    }

    async checkAccessToken(token) {
    }

    async revokeAccessToken(token) {
    }

    async checkRefreshToken(token) {
    }

    async revokeRefreshToken(token) {
    }

     * But in the interests of landing small manageable changes,
     * let's only add those as we need them.
     *
     */

  }
}

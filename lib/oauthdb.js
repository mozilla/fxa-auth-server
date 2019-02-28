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
    case 103:
      return error.incorrectRedirectURI(err.rediretUri);
    case 104:
      return error.invalidToken()
    case 109:
      return error.invalidRequestParameter(err.validation)
    case 110:
      return error.invalidResponseType()
    case 114:
      return error.invalidScopes(err.invalidScopes);
    case 116:
      return error.notPublicClient(err.clientId)
    case 118:
      return error.missingPCKEParameters()
    case 119:
      return error.staleAuthAt(err.authAt)
    case 120:
      return error.insufficientACRValues(err.foundValue);
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

    grantAuthorizationCode: {
      path: '/v1/authorization',
      method: 'POST',
      validate: {
        payload: {
          client_id: validators.clientId.required(),
          assertion: validators.assertion.required(),
          scope: validators.scope.required(),
          response_type: Joi.string().valid('code').required(),
          state: Joi.string().max(256).optional(),
          access_type: Joi.string().valid('offline', 'online').default('online').optional(),
          code_challenge_method: Joi.string().valid('S256').optional(),
          code_challenge: Joi.string().length(43).optional(), // XXX TODO: magic constant === bad
          keys_jwe: validators.jwe.optional(),
          acr_values: Joi.string().max(256).optional().allow(null)
        },
        response: {
          redirect: Joi.string(),
          code: Joi.string(),
          state: Joi.string()
        }
      }
    },

    grantAuthorizationToken: {
      path: '/v1/authorization',
      method: 'POST',
      validate: {
        payload: {
          client_id: validators.clientId.required(),
          assertion: validators.assertion.required(),
          scope: validators.scope.required(),
          response_type: Joi.string().valid('token').required(),
          ttl: Joi.number().positive().optional(),
          access_type: Joi.string().valid('offline', 'online').default('online').optional(),
          acr_values: Joi.string().max(256).optional().allow(null)
        },
        response: {
          access_token: Joi.string().optional(),
          refresh_token: Joi.string().optional(),
          id_token: validators.assertion.optional(),
          token_type: Joi.string().valid('bearer'),
          auth_at: Joi.number(),
          expires_in: Joi.number()
        }
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

    async grantAuthorizationCode(sessionToken, oauthParams) {
      oauthParams.assertion = await makeAssertionJWT(sessionToken)
      try {
        return await api.grantAuthorizationCode(oauthParams)
      } catch (err) {
        throw mapOAuthError(log, err)
      }
    },

    async grantAuthorizationToken(sessionToken, oauthParams) {
      oauthParams.assertion = await makeAssertionJWT(sessionToken)
      try {
        return await api.grantAuthorizationToken(oauthParams)
      } catch (err) {
        throw mapOAuthError(log, err)
      }
    }

    /* As we work through the process of merging oauth-server
     * into auth-server, future methods we might want to include
     * here will be things like the following:

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

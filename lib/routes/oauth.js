/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

/* Routes for managing OAuth authorization grants.
 *
 * These routes are a more-or-less direct proxy through to
 * routes on the underlying "fxa-oauth-server", treating it
 * as a kind of back-end microservice.  We want to eventually
 * merge that codebase directly into the main auth-server
 * here, at which point these routes will become the direct
 * implementation of their respesctive features.
 *
 */

const Joi = require('joi')

const validators = require('./validators')

module.exports = (log, config, oauthdb) => {
  const routes = [
    {
      method: 'GET',
      path: '/oauth/client/{client_id}',
      options: {
        validate: {
          params: {
            client_id: validators.clientId.required()
          }
        },
        response: {
          schema: {
            id: validators.clientId.required(),
            name: Joi.string().max(255).regex(validators.DISPLAY_SAFE_UNICODE).required(),
            trusted: Joi.boolean().required(),
            image_uri: Joi.string().optional().allow(''),
            redirect_uri: Joi.string().required().allow('')
          }
        }
      },
      handler: async function (request) {
        return oauthdb.getClientInfo(request.params.client_id)
      }
    },
    {
      method: 'POST',
      path: '/account/scoped-key-data',
      options: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            client_id: validators.clientId.required(),
            scope: validators.scope.required()
          }
        },
        response: {
          schema: Joi.object().pattern(Joi.any(), Joi.object({
            identifier: validators.scope.required(),
            keyRotationSecret: validators.hexString.length(64).required(),
            keyRotationTimestamp: Joi.number().required(),
          }))
        }
      },
      handler: async function (request) {
        const sessionToken = request.auth.credentials
        return oauthdb.getScopedKeyData(sessionToken, request.payload)
      }
    },
    {
      method: 'POST',
      path: '/oauth/authorization',
      options: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            client_id: validators.clientId.required(),
            redirect_uri: Joi.string()
              .max(256)
              .uri({ scheme: ['https'] })
              .required(),
            scope: validators.scope.required(),
            response_type: Joi.string()
              .valid('code', 'token')
              .default('code')
              .required(),
            state: Joi.string()
              .max(256)
              .when('response_type', {
                is: 'token',
                then: Joi.optional(),
                otherwise: Joi.required()
              }),
            ttl: Joi.number()
              .positive()
              .when('response_type', {
                is: 'token',
                then: Joi.optional(),
                otherwise: Joi.forbidden()
              }),
            access_type: Joi.string()
              .valid('offline', 'online')
              .default('online')
              .optional(),
            code_challenge_method: Joi.string()
              .valid('S256')
              .when('response_type', {
                is: 'code',
                then: Joi.optional(),
                otherwise: Joi.forbidden()
              }),
            code_challenge: Joi.string()
              .length(43) // XXX TODO: magic constant === bad
              .when('response_type', {
                is: 'code',
                then: Joi.optional(),
                otherwise: Joi.forbidden()
              }),
            keys_jwe: validators.jwe
              .when('response_type', {
                is: 'code',
                then: Joi.optional(),
                otherwise: Joi.forbidden()
              }),
            acr_values: Joi.string().max(256).optional().allow(null)
          }
        },
        response: {
          schema: Joi.object().keys({
            redirect: Joi.string(),
            code: Joi.string(),
            state: Joi.string(),
            access_token: validators.accessToken,
            refresh_token: validators.refreshToken.optional(),
            id_token: validators.assertion.optional(),
            token_type: Joi.string().valid('bearer'),
            scope: Joi.string().allow(''),
            auth_at: Joi.number(),
            expires_in: Joi.number()
          }).with('access_token', [
            'token_type',
            'scope',
            'auth_at',
            'expires_in'
          ]).with('code', [
            'state',
            'redirect',
          ]).without('code', [
            'access_token',
            'refresh_token',
            'id_token'
          ])
        }
      },
      handler: async function (request) {
        const sessionToken = request.auth.credentials
        if (request.payload.response_type === 'code') {
          return oauthdb.grantAuthorizationCode(sessionToken, request.payload)
        } else {
          return oauthdb.grantAuthorizationToken(sessionToken, request.payload)
        }
      }
    },
  ]
  return routes
}

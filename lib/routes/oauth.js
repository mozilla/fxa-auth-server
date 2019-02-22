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




module.exports = (log, config, oauthdb, db, mailer, push) => {
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
      },
    },
    {
      method: 'POST',
      path: '/oauth/token',
      options: {
        validate: {
          payload: TOKEN_PAYLOAD_SCHEMA
        },
        response: {
          schema: Joi.object().keys({
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
      },
      handler: async function (request) {
        return oauthdb.postToken(request.payload)
          .then(async (resp) => {

            // TODO: is this how we are gonna get the UIDs now?
            const tokenVerify = await oauthdb.postVerifyToken({
              token: resp.access_token
            });

            const uid = tokenVerify.user;
            const accountRecord = await db.account(uid);

            const devices = db.devices(uid);
            push.notifyDeviceConnected(uid, devices, 'Android Reference Browser');

            try {
              await mailer.sendNewDeviceLoginNotification(
                accountRecord.emails,
                accountRecord,
                {
                  acceptLanguage: request.app.acceptLanguage,
                  // deviceId,
                  // flowId,
                  // flowBeginTime,
                  //ip,
                  //location: geoData.location,
                  //service,
                  //timeZone: geoData.timeZone,
                  uaBrowser: request.app.ua.browser,
                  uaBrowserVersion: request.app.ua.browserVersion,
                  uaOS: request.app.ua.os,
                  uaOSVersion: request.app.ua.osVersion,
                  uaDeviceType: request.app.ua.deviceType,
                  uid: uid
                }
              )
            } catch (err) {
              log.error({
                op: 'Account.login.sendNewDeviceLoginNotification.error',
                error: err
              })
            }

            return resp;
          })
      }
    }
  ]
  return routes
}

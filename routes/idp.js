/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Hapi = require('hapi');
const fs = require('fs');
const CC = require('compute-cluster');
const config = require('../lib/config').root();
const crypto = require('crypto');

const hour = 1000 * 60 * 60;
const T = Hapi.types;
const HEX_STRING = /^(?:[a-fA-F0-9]{2})+$/;

var cc = new CC({ module: __dirname + '/sign.js' });

var account = require('../lib/account');

var getToken1Config = {
  description:
    "Begins an SRP login for the supplied email address, " +
    "returning the temporary sessionId and parameters for " +
    "key stretching and the SRP protocol for the client.",
  tags: ["srp", "account"],
  validate: {
    payload: {
      email: T.String().email().required()
    },
    response: {
      schema: {
        sessionId: T.String(),
        stretch: T.Object({
          salt: T.String()
        }),
        srp: T.Object({
          N_bits: T.Number().valid(2048),  // number of bits for prime
          alg: T.String().valid('sha256'), // hash algorithm (sha256)
          s: T.String().regex(HEX_STRING), // salt
          B: T.String().regex(HEX_STRING)  // server's public key value
        })
      }
    }
  }
};

var getToken2Config = {
  description:
    "Finishes the SRP dance, with the client providing " +
    "proof-of-knownledge of the password and receiving " +
    "the bundle encrypted with the shared key.",
  tags: ["srp", "account"],
  validate: {
    payload: {
      sessionId: T.String().required(),
      A: T.String().regex(HEX_STRING).required(),
      M: T.String().regex(HEX_STRING).required()
    },
    response: {
      schema: {
        bundle: T.String().regex(HEX_STRING).required()
      }
    }
  }
};

var routes = [
  {
    method: 'GET',
    path: '/.well-known/browserid',
    config: {
      handler: wellKnown
    }
  },
  {
    method: 'GET',
    path: '/sign_in.html',
    config: {
      handler: {
        file: './sign_in.html'
      }
    }
  },
  {
    method: 'GET',
    path: '/provision.html',
    config: {
      handler: {
        file: './provision.html'
      }
    }
  },
  {
    method: 'POST',
    path: '/get_random_bytes',
    config: {
      handler: getRandomBytes
    }
  },
  {
    method: 'POST',
    path: '/account/create',
    config: {
      description:
        "Creates an account associated with an email address, " +
        "passing along SRP information (salt and verifier) " +
        "and a wrapped key (used for class B data storage).",
      tags: ["srp", "account"],
      handler: accountCreate,
      validate: {
        payload: {
          email: T.String().email().required(),
          verifier: T.String().regex(HEX_STRING).required(),
          salt: T.String().regex(HEX_STRING).required(),
          params: T.Object(), // TODO: what are these?
          wrapKb: T.String().regex(HEX_STRING) // TODO: required?
        }
      }
    }
  },
  {
    method: 'POST',
    path: '/certificate/sign',
    config: {
      handler: certificateSign,
      auth: {
        strategy: 'hawk',
        payload: 'required'
      },
      tags: ["account"],
      validate: {
        payload: {
          publicKey: T.Object({
            algorithm: T.String().valid("RS", "DS").required(),
            n: T.String().with('e').without('y','p','q','g'),
            e: T.String().with('n').without('y','p','q','g'),
            y: T.String().with('p','q','g').without('n','e'),
            p: T.String().with('y','q','g').without('n','e'),
            q: T.String().with('y','p','g').without('n','e'),
            g: T.String().with('y','p','q').without('n','e')
          }),
          duration: Hapi.types.Number().integer().min(0).max(24 * hour).required()
        }
      }
    }
  },
  {
    method: 'POST',
    path: '/session/auth/start',
    handler: sessionAuthStart,
    config: getToken1Config
  },
  {
    method: 'POST',
    path: '/password/change/auth/start',
    handler: passwordChangeAuthStart,
    config: getToken1Config
  },
  {
    method: 'POST',
    path: '/session/auth/finish',
    handler: sessionAuthFinish,
    config: getToken2Config
  },
  {
    method: 'POST',
    path: '/password/change/auth/finish',
    handler: passwordChangeAuthFinish,
    config: getToken2Config
  },
  {
    method: 'POST',
    path: '/account/reset',
    config: {
      handler: accountReset,
      auth: {
        strategy: 'hawk',
        payload: 'required'
      },
      tags: ["account"],
      validate: {
        payload: {
          bundle: Hapi.types.String().required()
        }
      }
    }
  },
];

function wellKnown(request) {
  request.reply({
    'public-key': fs.readFileSync(config.publicKeyFile),
    'authentication': '/sign_in.html',
    'provisioning': '/provision.html'
  });
}

function accountCreate(request) {
  account.create(
    request.payload,
    function (err) {
      if (err) {
        request.reply(err);
      }
      else {
        //TODO do stuff
        request.reply({ created: true });
      }
    }
  );
}

function certificateSign(request) {
  cc.enqueue(
    {
      email: account.principle(request.auth.credentials.uid),
      publicKey: JSON.stringify(request.payload.publicKey),
      duration: request.payload.duration
    },
    function (err, result) {
      if (err || result.err) {
        request.reply(Hapi.error.internal('Unable to sign certificate', err || result.err));
      }
      else {
        request.reply(result);
      }
    }
  );
}


function getToken1(request) {

  account.getToken1(
    request.payload.email,
    function (err, result) {
      if (err) {
        request.reply(err);
      }
      else {
        request.reply(result);
      }
    }
  );

}

function sessionAuthStart(request) { return getToken1(request); }
function passwordChangeAuthStart(request) { return getToken1(request); }


function getToken2(type, request) {
  account.getToken2(
    request.payload.sessionId,
    type,
    request.payload.A,
    request.payload.M,
    function (err, result) {
      if (err) {
        request.reply(err);
      }
      else {
        request.reply(result);
      }
    }
  );
}

function sessionAuthFinish(request) { return getToken2('sign', request); }
function passwordChangeAuthFinish(request) { return getToken2('reset', request); }


function accountReset(request) {
  account.resetAccount(
    request.auth.credentials.token,
    request.payload.bundle,
    function (err) {
      if (err) {
        request.reply(err);
      }
      else {
        request.reply({ reset: true });
      }
    }
  );
}

function getRandomBytes(request) {
  crypto.randomBytes(32, function(err, buf) {
    request.reply(err || { data: buf.toString('hex') });
  });
}

module.exports = {
  routes: routes
};

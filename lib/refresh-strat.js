'use strict';

// Load modules

const Boom = require('boom');
const Hoek = require('hoek');


// Declare internals

const internals = {};


exports.plugin = {
  pkg: {
    name: 'refreshStrat'
  },
  register: function (server) {
    server.auth.scheme('basic', internals.hawk);
  }
};


internals.hawk = function (server, options) {

  const settings = Hoek.clone(options);
  settings.hawk = settings.hawk || {};

  const scheme = {
    authenticate: async function (request, h) {
      const refreshToken = request.headers.authorization.split(' ')[1];
      const credentials = {refreshToken}

      return h.authenticated({ credentials });
    },
    payload: function (request, h) {

      return h.continue;
    },
    response: function (request, h) {
      return h.continue;
    }
  };

  return scheme;
};


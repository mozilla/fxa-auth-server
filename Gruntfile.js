/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

module.exports = function (grunt) {

  require("load-grunt-tasks")(grunt);

  grunt.initConfig({
    copyright: {
      files: [
        "**/*.js",
        "!node_modules/**"
      ],
      options: {
        pattern: "This Source Code Form is subject to the terms of the Mozilla Public"
      }
    },

    jscs: {
        src: [
          "**/*.js",
          "!node_modules/**",
          "!test/**"
        ],
        options: {
            config: ".jscs.json"
        }
    },

    jshint: {
      files: [
        "**/*.js",
        "**/*.json",
        "!node_modules/**",
        "!web/**"
      ],
      options: {
        jshintrc: ".jshintrc"
      }
    }
  });

  grunt.registerTask("default", ["jshint", "jscs", "copyright"]);
};

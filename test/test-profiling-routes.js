/*******************************************************************************
 * Copyright 2018 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *******************************************************************************/
'use strict';

const debug = require('debug')('profilingRoutes:test');
const request = require('request');
const tap = require('tap');
const appmetrics = require('appmetrics');

const createHttpServer = require('./apps/createHttpServer');

// Setup appmetrics and start app somewhat as a supervisor would.
appmetrics.start();
require('..').attach({appmetrics: appmetrics});

const server = createHttpServer();

let serverOrigin;

tap.test('start', function(t) {
  server.on('listening', function() {
    let { address, port } = this.address();
    if (address === '0.0.0.0') {
      address = '127.0.0.1';
    } else if (address === '::') {
      address = '[::1]';
    }
    serverOrigin = `http://${address}:${port}`;
    t.pass('listened');
    t.end();
  });
});

tap.test('GET /metrics/profiling returns an array', function(t) {
  const options = {
    method: 'GET',
    url: `${serverOrigin}/metrics/profiling`,
  };
  debug('request %j', options);
  request(options, function(err, res, body) {
    t.ifError(err);
    t.equal(res.statusCode, 200);
    t.equal(body, '[]');
    // TODO: test with a timeout?
    // const resBody = JSON.parse(body);
    // t.type(resBody, 'object');
    t.end();
  });
});

tap.test('POST /metrics/profiling/on suceeeds', function(t) {
  const options = {
    method: 'POST',
    url: `${serverOrigin}/metrics/profiling/on`,
  };
  debug('request %j', options);
  request(options, function(err, res, body) {
    t.ifError(err);
    t.equal(res.statusCode, 200);
    t.equal(body, 'Profiling enabled');
    t.end();
  });
});

tap.test('POST /metrics/profiling/off suceeeds', function(t) {
  const options = {
    method: 'POST',
    url: `${serverOrigin}/metrics/profiling/off`,
  };
  debug('request %j', options);
  request(options, function(err, res, body) {
    t.ifError(err);
    t.equal(res.statusCode, 200);
    t.equal(body, 'Profiling disabled');
    t.end();
  });
});

tap.test('stop', function(t) {
  server.close(t.end);
});

/*******************************************************************************
 * Copyright 2017 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 ******************************************************************************/

'use strict';

const debug = require('debug')('appmetrics-prometheus');
const util = require('util');

// Buffer 1 cpu and memory event
var latestCPUEvent = {
  process: 0,
  system: 0
};
var latestMemEvent = {
  physical_used: 0,
  physical: 0,
  virtual: 0
};
let latestLoopEvent;
let latestGCEvent;
let aggregateHttpEvent = {};
let aggregateHttpsEvent = {};
let aggregateHttpOutboundEvent = {};
let aggregateHttpsOutboundEvent = {};
var httpURLDataList = [];
let profilingSamples = [];
var save = {
  http: {},
  https: {},
};
// GC summary data
let gcDurationTotal = 0.0;
let maxHeapUsed = 0;


exports.attach = function(options) {
  if (save.http.Server) {
    // Already attached.
    return exports;
  }
  // Protect our options from modification.
  options = util._extend({}, options);

  // if the user hasn't supplied appmetrics, require
  // here so we get http probe data
  if (!options.appmetrics) {
    options.appmetrics = require('appmetrics');
  }

  patch(save.http, require('http'));
  patch(save.https, require('https'));

  function patch(save, http) {
    // Patch the constructor as well as createServer.
    save.Server = http.Server;
    http.Server = function() {
      const server = save.Server.apply(this, arguments);
      options.server = server;
      monitor(options);
      return server;
    };
    save.createServer = http.createServer;
    http.createServer = function() {
      const server = save.createServer.apply(this, arguments);
      options.server = server;
      monitor(options);
      return server;
    };
  }
  return exports;
};

// Start monitoring process and subscribe to the data.
// Don't export monitor
var monitor = function(options) {
  // Protect our options from modification.
  options = util._extend({}, options);

  var express = require('express');
  var server;

  // Use the server that has been defined by the application.
  server = options.server;
  debug('patch existing request listeners');
  server.listeners('request').forEach(patch);
  debug('patch new request listeners...');
  server.on('newListener', function(eventName, listener) {
    if (eventName !== 'request') return;
    if (listener.__dashboard_patched) return;
    process.nextTick(function() { patch(listener); });
  });

  function patch(listener) {
    debug('patching %s', listener);
    server.removeListener('request', listener);

    // appmetrics is a global singleton, allow the user's appmetrics to be
    // injected, only using our own if the user did not supply one.
    var appmetrics = options.appmetrics || require('appmetrics');
    var monitoring = appmetrics.monitor();

    var app = express();

    const url = '/metrics';
    const profilingMetricsUrl = `${url}/profiling`;
    const enableProfilingMetricsUrl = `${profilingMetricsUrl}/on`;
    const disableProfilingMetricsUrl = `${profilingMetricsUrl}/off`;

    app.use(enableProfilingMetricsUrl, (req, res) => {
      monitoring.enable('profiling');
      res.send('Profiling enabled');
    });
    app.use(disableProfilingMetricsUrl, (req, res) => {
      monitoring.disable('profiling');
      res.send('Profiling disabled');
    });
    app.use(profilingMetricsUrl, (req, res) => {
      res.send(profilingSamples);
    });
    app.use(url, endpoint(options));
    app.use(url, siteNotFound);
    app.use(url, siteError);
    // If request not for the prometheus url, forward it back to the original
    // listener.
    app.use(function(req, res) {
      listener.call(server, req, res);
    });
    app.__dashboard_patched = true;
    server.on('request', app);
  }

  return server;
};

exports.endpoint = endpoint;

function endpoint(options) {
  // appmetrics is a global singleton, allow the user's appmetrics to be
  // injected, only using our own if the user did not supply one.
  var appmetrics = (options || {}).appmetrics || require('appmetrics');
  var monitoring = appmetrics.monitor();
  function site(req, res) {
    const data = [
      stringCPUData(latestCPUEvent),
      stringMemoryData(latestMemEvent),
      stringHttpRequestsAlltimeTotal(httpURLDataList),
      stringHttpRequestDuration(httpURLDataList),
      stringProcessUptime(),
      stringLoopData(),
      stringGCData(),
      stringHttpRequestsTotal(),
      stringHttpRequestsDurationAverage(),
      stringHttpRequestsDurationMax(),
      stringHttpsRequestsTotal(),
      stringHttpsRequestsDurationAverage(),
      stringHttpsRequestsDurationMax(),
      stringHttpOutboundRequestsTotal(),
      stringHttpOutboundRequestsDurationAverage(),
      stringHttpOutboundRequestsDurationMax(),
      stringHttpsOutboundRequestsTotal(),
      stringHttpsOutboundRequestsDurationAverage(),
      stringHttpsOutboundRequestsDurationMax(),
      stringHttpRequestsAlltimeDurationAverage(),
      stringHttpRequestsAlltimeDurationMax(),
    ].filter(Boolean) // Filters out empty strings
      .join('\n')
      .concat('\n'); // Prometheus requires a newline on the end
    aggregateHttpEvent = {};
    aggregateHttpsEvent = {};
    aggregateHttpOutboundEvent = {};
    aggregateHttpsOutboundEvent = {};
    res.send(data);
  }


  monitoring.on('profiling', (profilingSample) => {
    profilingSamples.push(profilingSample);
  });

  monitoring.on('cpu', function(data) {
    latestCPUEvent = data;
  });

  monitoring.on('memory', function(data) {
    latestMemEvent = data;
  });

  monitoring.on('loop', function(data) {
    latestLoopEvent = data;
  });
  monitoring.on('gc', function(data) {
    latestGCEvent = data;
    gcDurationTotal += data.duration;
    maxHeapUsed = Math.max(maxHeapUsed, data.used);
    latestGCEvent.timeSummary = (gcDurationTotal / (process.uptime() * 1000));
    latestGCEvent.usedHeapAfterGCMax = maxHeapUsed;
  });

  monitoring.on('http', (data) => saveHttpOrHttpsData(data, aggregateHttpEvent, httpURLDataList));
  monitoring.on('https', (data) => saveHttpOrHttpsData(data, aggregateHttpsEvent, httpURLDataList));
  monitoring.on('http-outbound', (data) => updateAggregateEvent(aggregateHttpOutboundEvent, data));
  monitoring.on('https-outbound', (data) => updateAggregateEvent(aggregateHttpsOutboundEvent, data));

  return site;
}

function siteNotFound(req, res) {
  res.statusCode = 404;
  return res.end();
}

function siteError(err, req, res, _next) {
  res.statusCode = 500;
  return res.end(err.message);
}

/*
 * Functions to create Strings for the response
 */
function stringCPUData(latestCPUEvent) {
  var content = '';
  content += '# HELP os_cpu_used_ratio The ratio of the systems CPU that is currently used (values are 0-1)\n';
  content += '# TYPE os_cpu_used_ratio gauge\n';
  content += 'os_cpu_used_ratio ' + latestCPUEvent.system + '\n';
  content += '# HELP process_cpu_used_ratio The ratio of the process CPU that is currently used (values are 0-1)\n';
  content += '# TYPE process_cpu_used_ratio gauge\n';
  content += 'process_cpu_used_ratio ' + latestCPUEvent.process;
  return content;
}

function stringMemoryData(latestMemEvent) {
  var content = '';
  content += '# HELP os_resident_memory_bytes OS memory size in bytes.\n';
  content += '# TYPE os_resident_memory_bytes gauge\n';
  content += 'os_resident_memory_bytes ' + latestMemEvent.physical_used + '\n';
  content += '# HELP process_resident_memory_bytes Resident memory size in bytes.\n';
  content += '# TYPE process_resident_memory_bytes gauge\n';
  content += 'process_resident_memory_bytes ' + latestMemEvent.physical + '\n';
  content += '# HELP process_virtual_memory_bytes Virtual memory size in bytes.\n';
  content += '# TYPE process_virtual_memory_bytes gauge\n';
  content += 'process_virtual_memory_bytes ' + latestMemEvent.virtual;
  return content;
}

function stringHttpRequestsAlltimeTotal(httpURLDataList) {
  if (!httpURLDataList.length) return;
  return [
    // i.e. Total number of HTTP requests received by this app since it started
    '# HELP http_requests_total Total number of HTTP requests made.',
    '# TYPE http_requests_total counter',
    ...httpURLDataList.map(data =>
      `http_requests_total{code="${data.code}", handler="${data.url}", method="${data.method.toLowerCase()}"} ${data.hits}`
    ),
  ].join('\n');
  }
function stringHttpRequestDuration(httpURLDataList) {
  var content = '';
  content += '# HELP http_request_duration_microseconds The HTTP request latencies in microseconds.\n';
  content += '# TYPE http_request_duration_microseconds summary\n';
  for (var i = 0; i < httpURLDataList.length; i++) {
    var data = httpURLDataList[i];
    var list = data.duration_list;
    var quantileFifty = findQuantile(list, 0.5);
    var quantileNinety = findQuantile(list, 0.9);
    var quantileNinetyNine = findQuantile(list, 0.99);
    var sumDurations = findSumOfArray(list);
    var countDurations = list.length;
    content += 'http_request_duration_microseconds{handler="' + data.url + '",quantile="0.5"} ' + quantileFifty + '\n';
    content += 'http_request_duration_microseconds{handler="' + data.url + '",quantile="0.9"} ' + quantileNinety + '\n';
    content += 'http_request_duration_microseconds{handler="' + data.url + '",quantile="0.99"} ' + quantileNinetyNine + '\n';
    content += 'http_request_duration_microseconds_sum{handler="' + data.url + '"} ' + sumDurations + '\n';
    content += 'http_request_duration_microseconds_count{handler="' + data.url + '"} ' + countDurations;
  }
  return content;
}

function stringProcessUptime() {
  return [
    '# HELP process_uptime_count_seconds The number of seconds for which the current Node.js process has been running',
    '# TYPE process_uptime_count_seconds counter',
    `process_uptime_count_seconds ${process.uptime()}`,
  ];
}

function stringLoopData() {
  if (!latestLoopEvent) return;
  return [
    '# HELP event_loop_tick_min_milliseconds The shortest tick time in the event loop samples, in milliseconds',
    '# TYPE event_loop_tick_min_milliseconds guage',
    `event_loop_tick_min_milliseconds ${latestLoopEvent.minimum}`,

    '# HELP event_loop_tick_max_milliseconds The longest tick time in the event loop samples, in milliseconds',
    '# TYPE event_loop_tick_max_milliseconds guage',
    `event_loop_tick_max_milliseconds ${latestLoopEvent.maximum}`,

    '# HELP event_loop_tick_count The number of event loop ticks in the last interval',
    '# TYPE event_loop_tick_count counter',
    `event_loop_tick_count ${latestLoopEvent.count}`,

    '# HELP event_loop_tick_average_milliseconds The average tick time in the event loop samples, in milliseconds',
    '# TYPE event_loop_tick_average_milliseconds guage',
    `event_loop_tick_average_milliseconds ${latestLoopEvent.average}`,

    '# HELP event_loop_cpu_user The percentage of 1 CPU used by the event loop thread in user code the last interval. This is a value between 0.0 and 1.0.',
    '# TYPE event_loop_cpu_user guage',
    `event_loop_cpu_user ${latestLoopEvent.cpu_user}`,

    '# HELP event_loop_cpu_system The percentage of 1 CPU used by the event loop thread in system code in the last interval. This is a value between 0.0 and 1.0.',
    '# TYPE event_loop_cpu_system guage',
    `event_loop_cpu_system ${latestLoopEvent.cpu_system}`,
  ].join('\n');
}

function stringGCData() {
  if (!latestGCEvent) return;
  return [
    '# HELP heap_size_bytes The size of the JavaScript heap in bytes',
    '# TYPE heap_size_bytes guage',
    `heap_size_bytes ${latestGCEvent.size}`,

    '# HELP heap_memory_used_bytes The amount of memory used on the JavaScript heap in bytes',
    '# TYPE heap_memory_used_bytes guage',
    `heap_memory_used_bytes ${latestGCEvent.used}`,

    '# HELP heap_memory_used_max_bytes The maximum amount of memory used on the JavaScript heap in bytes',
    '# TYPE heap_memory_used_max_bytes count',
    `heap_memory_used_max_bytes ${maxHeapUsed}`,

    '# HELP gc_cycle_duration_milliseconds The duration of the GC cycle in milliseconds',
    '# TYPE gc_cycle_duration_milliseconds guage',
    `gc_cycle_duration_milliseconds ${latestGCEvent.duration}`,

    '# HELP gc_cycle_duration_total_milliseconds The total duration of all GC cycles in milliseconds',
    '# TYPE gc_cycle_duration_total_milliseconds count',
    `gc_cycle_duration_total_milliseconds ${gcDurationTotal}`,
  ].join('\n');
}

function stringHttpRequestsTotal() {
  if (isEmptyObject(aggregateHttpEvent)) return;
  return [
    '# HELP http_requests_snapshot_total Total number of HTTP requests received in this snapshot.',
    '# TYPE http_requests_snapshot_total guage',
    `http_requests_snapshot_total ${aggregateHttpEvent.total}`,
  ].join('\n');
}

function stringHttpRequestsDurationAverage() {
  if (isEmptyObject(aggregateHttpEvent)) return;
  return [
    '# HELP http_requests_duration_average_microseconds Average duration of HTTP requests received in this snapshot.',
    '# TYPE http_requests_duration_average_microseconds guage',
    `http_requests_duration_average_microseconds ${aggregateHttpEvent.average}`,
  ].join('\n');
}

function stringHttpRequestsDurationMax() {
  if (isEmptyObject(aggregateHttpEvent)) return;
  return [
    '# HELP http_requests_duration_max_microseconds Longest HTTP request received in this snapshot.',
    '# TYPE http_requests_duration_max_microseconds guage',
    `http_requests_duration_max_microseconds{handler="${aggregateHttpEvent.url}"} ${aggregateHttpEvent.longest}`,
  ].join('\n');
}

function stringHttpsRequestsTotal() {
  if (isEmptyObject(aggregateHttpsEvent)) return;
  return [
    '# HELP https_requests_total Total number of HTTPS requests received in this snapshot.',
    '# TYPE https_requests_total guage',
    `https_requests_total ${aggregateHttpsEvent.total}`,
  ].join('\n');
}

function stringHttpsRequestsDurationAverage() {
  if (isEmptyObject(aggregateHttpsEvent)) return;
  return [
    '# HELP https_requests_duration_average_microseconds Average duration of HTTPS requests received in this snapshot.',
    '# TYPE https_requests_duration_average_microseconds guage',
    `https_requests_duration_average_microseconds ${aggregateHttpsEvent.average}`,
  ].join('\n');
}

function stringHttpsRequestsDurationMax() {
  if (isEmptyObject(aggregateHttpsEvent)) return;
  return [
    '# HELP https_requests_duration_max_microseconds Longest HTTPS request received in this snapshot.',
    '# TYPE https_requests_duration_max_microseconds guage',
    `https_requests_duration_max_microseconds{handler="${aggregateHttpsEvent.url}"} ${aggregateHttpsEvent.longest}`,
  ].join('\n');
}

function stringHttpOutboundRequestsTotal() {
  if (isEmptyObject(aggregateHttpOutboundEvent)) return;
  return [
    '# HELP http_outbound_requests_total Total number of HTTP requests sent during this snapshot.',
    '# TYPE http_outbound_requests_total guage',
    `http_outbound_requests_total ${aggregateHttpOutboundEvent.total}`,
  ].join('\n');
}

function stringHttpOutboundRequestsDurationAverage() {
  if (isEmptyObject(aggregateHttpOutboundEvent)) return;
  return [
    '# HELP http_outbound_requests_duration_average_microseconds Average duration of HTTP requests sent during this snapshot.',
    '# TYPE http_outbound_requests_duration_average_microseconds guage',
    `http_outbound_requests_duration_average_microseconds ${aggregateHttpOutboundEvent.average}`,
  ].join('\n');
}

function stringHttpOutboundRequestsDurationMax() {
  if (isEmptyObject(aggregateHttpOutboundEvent)) return;
  return [
    '# HELP http_outbound_requests_duration_max_microseconds Longest HTTP request sent during this snapshot.',
    '# TYPE http_outbound_requests_duration_max_microseconds guage',
    `http_outbound_requests_duration_max_microseconds{url="${aggregateHttpOutboundEvent.url}"} ${aggregateHttpOutboundEvent.longest}`,
  ].join('\n');
}

function stringHttpsOutboundRequestsTotal() {
  if (isEmptyObject(aggregateHttpsOutboundEvent)) return;
  return [
    '# HELP https_outbound_requests_total Total number of HTTPS requests sent during this snapshot.',
    '# TYPE https_outbound_requests_total guage',
    `https_outbound_requests_total ${aggregateHttpsOutboundEvent.total}`,
  ].join('\n');
}

function stringHttpsOutboundRequestsDurationAverage() {
  if (isEmptyObject(aggregateHttpsOutboundEvent)) return;
  return [
    '# HELP https_outbound_requests_duration_average_microseconds Average duration of HTTPS requests sent during this snapshot.',
    '# TYPE https_outbound_requests_duration_average_microseconds guage',
    `https_outbound_requests_duration_average_microseconds ${aggregateHttpsOutboundEvent.average}`,
  ].join('\n');
}

function stringHttpsOutboundRequestsDurationMax() {
  if (isEmptyObject(aggregateHttpsOutboundEvent)) return;
  return [
    '# HELP https_outbound_requests_duration_max_microseconds Longest HTTPS request sent during this snapshot.',
    '# TYPE https_outbound_requests_duration_max_microseconds guage',
    `https_outbound_requests_duration_max_microseconds{url="${aggregateHttpsOutboundEvent.url}"} ${aggregateHttpsOutboundEvent.longest}`,
  ].join('\n');
}

function stringHttpRequestsAlltimeDurationAverage() {
  if (!httpURLDataList.length) return;
  return [
    '# HELP http_requests_alltime_duration_average_microseconds Average duration of HTTP requests received since app started.',
    '# TYPE http_requests_alltime_duration_average_microseconds guage',
    ...httpURLDataList.map(data =>
      `http_requests_alltime_duration_average_microseconds{handler="${data.url}",method="${data.method.toLowerCase()}"} ${data.average_duration}`
    ),
  ].join('\n');
}

function stringHttpRequestsAlltimeDurationMax() {
  if (!httpURLDataList.length) return;
  return [
    '# HELP http_requests_alltime_duration_max_microseconds Average duration of HTTP requests received since app started.',
    '# TYPE http_requests_alltime_duration_max_microseconds guage',
    ...httpURLDataList.map(data =>
      `http_requests_alltime_duration_max_microseconds{handler="${data.url}",method="${data.method.toLowerCase()}"} ${data.longest_duration}`
    ),
  ].join('\n');
}

function saveHttpOrHttpsData(data, aggregateEvent, httpURLDataList) {
  updateAggregateEvent(aggregateEvent, data);
  updateHttpURLDataList(httpURLDataList, data);
}

function updateAggregateEvent(event, data) {
  if (isEmptyObject(event)) {
    event.total = 1;
    event.average = data.duration;
    event.longest = data.duration;
    event.time = data.time;
    event.url = data.url;
    event.code = data.statusCode;
    event.method = data.method;
  } else {
    event.total = event.total + 1;
    event.average = (event.average * (event.total - 1) + data.duration) / event.total;
    if (data.duration > event.longest) {
      event.longest = data.duration;
      event.url = data.url;
    }
  }
}

function updateHttpURLDataList(URLDataList, data) {
  // See if httpURLDataList contains a json object which has already has the collected url and statusCode
  var found = false;
  var foundIndex;
  var i = 0;
  while (found === false && i < URLDataList.length) {
    if (URLDataList[i].url == data.url && URLDataList[i].code == data.statusCode) {
      found = true;
      foundIndex = i;
    }
    i++;
  }

  // If found we increment the number of hits on the url
  // Else add new json object to URLDataList with the 'hits' value of 1
  if (found) {
    var urlData = URLDataList[foundIndex];
    // Recalculate the average
    urlData.average_duration = (urlData.average_duration * urlData.hits + data.duration) / (urlData.hits + 1);
    urlData.hits = urlData.hits + 1;
    // Add new duration to the duration_list
    urlData.duration_list.push(data.duration);
    urlData.longest_duration = Math.max(...urlData.duration_list);
    // Reorder duration_list so it is in ascending order
    urlData.duration_list.sort(function(a, b){ return a - b; });
  } else {
    URLDataList.push({
      url: data.url,
      average_duration: data.duration,
      longest_duration: data.duration,
      hits: 1,
      method: data.method,
      code: data.statusCode,
      duration_list: [data.duration]
    });
  }
}

function isEmptyObject(obj) {
  return !Object.keys(obj).length;
}

function findQuantile(list, quantile) {
  // Quantile must be a decimal, calculation: q(n+1)
  var n = list.length;
  var placeInList = Math.round((quantile * (n + 1)));
  var foundQuantile = '';
  // If the placeInList is greater than the size,
  // the foundQuantile must be the maximum index
  if (placeInList > n) {
    foundQuantile = list[n - 1];
  } else {
    // Locate the quantile in the list using index -1 due to the list starting at index 0
    foundQuantile = list[placeInList - 1];
  }
  return foundQuantile;
}

function findSumOfArray(arr) {
  var sum = 0;
  for (var i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}

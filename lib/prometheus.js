// var express = require('express');
// module.exports = function(app) {
//   var router = express.Router();
//   var cpu = '', memory = '', http = '', httpOutbound = '', httpURLs = '';
//   router.get('/', function (req, res, next) {
//     var fullUrl = req.protocol + '://' + req.get('host');
//     var socket = require('socket.io-client')(fullUrl);
//     socket.on('cpu', function(data) {
//       cpu = JSON.parse(data);
//     });
//     socket.on('memory', function(data) {
//       memory = JSON.parse(data);
//     });
//     socket.on('http', function(data) {
//       http = JSON.parse(data);
//     });
//     socket.on('http-outbound', function(data) {
//       httpOutbound = JSON.parse(data);
//     });
//     socket.on('http-urls', function(data) {
//       httpURLs = JSON.parse(data);
//     });
//     res.writeHead(200, {'Content-Type': 'text/plain'});
//     res.write('appmetrics_cpu_process: ' + cpu.process + '\n');
//     res.write('appmetrics_cpu_system: ' + cpu.system + '\n');
//     res.write('appmetrics_memory_physical_total: ' + memory.physical_total + '\n');
//     res.write('appmetrics_memory_physical_used: ' + memory.physical_used + '\n');
//     res.write('appmetrics_memory_physical_free: ' + memory.physical_free + '\n');
//     res.write('appmetrics_memory_virtual: ' + memory.virtual + '\n');
//     res.write('appmetrics_memory_private: ' + memory.private + '\n');
//     res.write('appmetrics_memory_physical: ' + memory.physical + '\n');
//     // res.write('\nHTTP\n');
//     // res.write('appmetrics_http_total: ' + http.total + '\n');
//     // res.write('appmetrics_http_average: ' + http.average + '\n');
//     // res.write('appmetrics_http_longest: ' + http.longest + '\n');
//     // res.write('appmetrics_http_time: ' + http.time + '\n');
//     // res.write('appmetrics_http_url: ' + http.url + '\n');
//     // res.write('\nHTTP-Outbound\n');
//     // res.write('appmetrics_http_outbound_total: ' + httpOutbound.total + '\n');
//     // res.write('appmetrics_http_outbound_average: ' + httpOutbound.average + '\n');
//     // res.write('appmetrics_http_outbound_longest: ' + httpOutbound.longest + '\n');
//     // res.write('appmetrics_http_outbound_time: ' + httpOutbound.time + '\n');
//     // res.write('appmetrics_http_outbound_url: ' + httpOutbound.url + '\n');
//     // res.write('\nHTTP-URLs\n');
//     // for (var i = 0; i < httpURLs.length; i++) {
//     //   res.write('appmetrics_http_URLs_url: ' + httpURLs[i].url + '\n');
//     //   res.write('appmetrics_http_URLs_averageResponseTime: ' + httpURLs[i].averageResponseTime + '\n');
//     // }
//     res.end();
//   });
//   app.use('/metrics', router);
// }

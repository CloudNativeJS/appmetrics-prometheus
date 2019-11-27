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

const expectedMetrics = [
  'os_cpu_used_ratio',
  'process_cpu_used_ratio',
  'os_resident_memory_bytes',
  'process_resident_memory_bytes',
  'process_virtual_memory_bytes',
  'http_request_duration_microseconds',
  'process_uptime_count_seconds',
  // Other metrics not immediately available:
  // 'http_requests_total',
  // 'event_loop_tick_min_milliseconds',
  // 'event_loop_tick_max_milliseconds',
  // 'event_loop_tick_average_milliseconds',
  // 'event_loop_cpu_user',
  // 'event_loop_cpu_system',
  // 'heap_size_bytes',
  // 'heap_memory_used_bytes',
  // 'heap_memory_used_max_bytes',
  // 'gc_cycle_duration_milliseconds',
  // 'gc_cycle_duration_total_milliseconds',
  // 'http_requests_snapshot_total',
  // 'http_requests_duration_average_microseconds',
  // 'http_requests_duration_max_microseconds',
  // 'http_requests_alltime_duration_average_microseconds',
];

module.exports = {
  expectedMetrics,
};

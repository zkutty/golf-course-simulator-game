/**
 * Quick way to enable performance profiling
 * Run this in the browser console:
 * localStorage.setItem('enablePerfProfiler', 'true'); location.reload();
 * 
 * Or import and call enablePerfProfiler() from your code
 */

import { perfProfiler } from './performanceProfiler';

export function enablePerfProfiler() {
  localStorage.setItem('enablePerfProfiler', 'true');
  perfProfiler.start();
  console.log('✅ Performance profiler enabled! Check console for detailed metrics.');
  console.log('📊 Metrics will be logged every 3 seconds.');
  console.log('💡 Access profiler data: window.perfProfiler.getMetrics()');
}

export function disablePerfProfiler() {
  localStorage.removeItem('enablePerfProfiler');
  perfProfiler.stop();
  console.log('❌ Performance profiler disabled.');
}

// Auto-enable if flag is set
if (typeof window !== 'undefined' && localStorage.getItem('enablePerfProfiler') === 'true') {
  enablePerfProfiler();
}


/**
 * Comprehensive performance profiler for identifying bottlenecks
 * Enable with: localStorage.setItem('enablePerfProfiler', 'true')
 */

interface PerfMetric {
  name: string;
  count: number;
  totalTime: number;
  maxTime: number;
  minTime: number;
  lastTime: number;
}

interface ReactRenderInfo {
  component: string;
  count: number;
  lastRender: number;
  avgTime: number;
}

class PerformanceProfiler {
  private metrics = new Map<string, PerfMetric>();
  private reactRenders = new Map<string, ReactRenderInfo>();
  private frameTimes: number[] = [];
  private eventCounts = new Map<string, number>();
  private memorySnapshots: number[] = [];
  private isEnabled = false;
  private logInterval: number | null = null;
  private frameCount = 0;
  private lastFrameTime = performance.now();
  private slowFrameThreshold = 16.67; // 60fps = 16.67ms per frame

  constructor() {
    this.isEnabled = localStorage.getItem('enablePerfProfiler') === 'true';
    if (this.isEnabled) {
      this.start();
      console.log('[PerfProfiler] Enabled - check console for detailed metrics');
    }
  }

  start() {
    if (this.logInterval) return;
    
    // Monitor frame rate
    this.monitorFrameRate();
    
    // Log metrics every 3 seconds
    this.logInterval = window.setInterval(() => {
      this.logMetrics();
    }, 3000);
    
    // Monitor memory every 5 seconds
    if ('memory' in performance) {
      setInterval(() => {
        const mem = (performance as any).memory;
        this.memorySnapshots.push(mem.usedJSHeapSize);
        if (this.memorySnapshots.length > 20) {
          this.memorySnapshots.shift();
        }
      }, 5000);
    }
  }

  stop() {
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
    }
  }

  measure<T>(name: string, fn: () => T): T {
    if (!this.isEnabled) return fn();
    
    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = performance.now() - start;
      this.recordMetric(name, duration);
    }
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.isEnabled) return fn();
    
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      this.recordMetric(name, duration);
    }
  }

  private recordMetric(name: string, duration: number) {
    const existing = this.metrics.get(name);
    if (existing) {
      existing.count++;
      existing.totalTime += duration;
      existing.maxTime = Math.max(existing.maxTime, duration);
      existing.minTime = Math.min(existing.minTime, duration);
      existing.lastTime = duration;
    } else {
      this.metrics.set(name, {
        name,
        count: 1,
        totalTime: duration,
        maxTime: duration,
        minTime: duration,
        lastTime: duration,
      });
    }
  }

  logReactRender(component: string, renderTime: number) {
    if (!this.isEnabled) return;
    
    const existing = this.reactRenders.get(component);
    if (existing) {
      existing.count++;
      existing.lastRender = performance.now();
      existing.avgTime = (existing.avgTime * (existing.count - 1) + renderTime) / existing.count;
    } else {
      this.reactRenders.set(component, {
        component,
        count: 1,
        lastRender: performance.now(),
        avgTime: renderTime,
      });
    }
  }

  logEvent(eventType: string) {
    if (!this.isEnabled) return;
    const count = this.eventCounts.get(eventType) || 0;
    this.eventCounts.set(eventType, count + 1);
  }

  private monitorFrameRate() {
    const checkFrame = () => {
      const now = performance.now();
      const frameTime = now - this.lastFrameTime;
      this.lastFrameTime = now;
      
      this.frameTimes.push(frameTime);
      if (this.frameTimes.length > 60) {
        this.frameTimes.shift();
      }
      
      this.frameCount++;
      
      // Only warn about significantly slow frames (>20ms) to reduce noise
      // The 3-second summary will show average frame time
      if (frameTime > 20) {
        console.warn(`[PerfProfiler] Slow frame: ${frameTime.toFixed(2)}ms (target: ${this.slowFrameThreshold}ms)`);
      }
      
      requestAnimationFrame(checkFrame);
    };
    requestAnimationFrame(checkFrame);
  }

  private logMetrics() {
    console.group('[PerfProfiler] Metrics Report');
    
    // Frame rate stats
    if (this.frameTimes.length > 0) {
      const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const fps = 1000 / avgFrameTime;
      const slowFrames = this.frameTimes.filter(t => t > this.slowFrameThreshold).length;
      console.log(`📊 Frame Rate: ${fps.toFixed(1)} fps (avg ${avgFrameTime.toFixed(2)}ms), ${slowFrames} slow frames`);
    }
    
    // Function timing metrics
    if (this.metrics.size > 0) {
      console.group('⏱️ Function Timings (slowest first)');
      const sorted = Array.from(this.metrics.values())
        .sort((a, b) => b.avgTime - a.avgTime)
        .slice(0, 10);
      
      sorted.forEach(m => {
        const avgTime = m.totalTime / m.count;
        const emoji = avgTime > 16 ? '🔴' : avgTime > 8 ? '🟡' : '🟢';
        console.log(
          `${emoji} ${m.name}: avg ${avgTime.toFixed(2)}ms, max ${m.maxTime.toFixed(2)}ms, called ${m.count}x`
        );
      });
      console.groupEnd();
    }
    
    // React render stats
    if (this.reactRenders.size > 0) {
      console.group('⚛️ React Renders (most frequent first)');
      const sorted = Array.from(this.reactRenders.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      
      sorted.forEach(r => {
        const emoji = r.avgTime > 16 ? '🔴' : r.avgTime > 8 ? '🟡' : '🟢';
        console.log(
          `${emoji} ${r.component}: ${r.count} renders, avg ${r.avgTime.toFixed(2)}ms`
        );
      });
      console.groupEnd();
    }
    
    // Event counts
    if (this.eventCounts.size > 0) {
      console.group('🖱️ Event Counts (last 3s)');
      const sorted = Array.from(this.eventCounts.entries())
        .sort((a, b) => b[1] - a[1]);
      
      sorted.forEach(([event, count]) => {
        const rate = count / 3; // per second
        const emoji = rate > 60 ? '🔴' : rate > 30 ? '🟡' : '🟢';
        console.log(`${emoji} ${event}: ${count} events (${rate.toFixed(1)}/sec)`);
      });
      console.groupEnd();
      
      // Reset event counts
      this.eventCounts.clear();
    }
    
    // Memory stats
    if ('memory' in performance && this.memorySnapshots.length > 0) {
      const mem = (performance as any).memory;
      const current = mem.usedJSHeapSize / 1024 / 1024; // MB
      const peak = mem.jsHeapSizeLimit / 1024 / 1024; // MB
      const avg = this.memorySnapshots.reduce((a, b) => a + b, 0) / this.memorySnapshots.length / 1024 / 1024;
      console.log(`💾 Memory: ${current.toFixed(1)}MB used, ${peak.toFixed(1)}MB limit, ${avg.toFixed(1)}MB avg`);
    }
    
    console.groupEnd();
  }

  getMetrics() {
    return {
      metrics: Array.from(this.metrics.values()),
      reactRenders: Array.from(this.reactRenders.values()),
      frameTimes: [...this.frameTimes],
      eventCounts: Object.fromEntries(this.eventCounts),
    };
  }

  reset() {
    this.metrics.clear();
    this.reactRenders.clear();
    this.frameTimes = [];
    this.eventCounts.clear();
    this.frameCount = 0;
  }
}

export const perfProfiler = new PerformanceProfiler();

// Helper to wrap expensive functions
export function profile<T extends (...args: any[]) => any>(
  name: string,
  fn: T
): T {
  return ((...args: any[]) => {
    return perfProfiler.measure(name, () => fn(...args));
  }) as T;
}

// React hook to track component renders (import React in component files)
export function createUsePerfProfiler(React: any) {
  return function usePerfProfiler(componentName: string) {
    const renderStartRef = React.useRef(performance.now());
    
    React.useEffect(() => {
      const renderTime = performance.now() - renderStartRef.current;
      perfProfiler.logReactRender(componentName, renderTime);
      renderStartRef.current = performance.now();
    });
  };
}

// Make it available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).perfProfiler = perfProfiler;
}


# Performance Debugging Guide

## Quick Start

To enable performance profiling, open your browser console and run:

```javascript
localStorage.setItem('enablePerfProfiler', 'true');
location.reload();
```

The profiler will automatically start and log detailed metrics every 3 seconds.

## What Gets Profiled

### 1. **Frame Rate Monitoring**
- Tracks actual FPS vs target 60fps
- Warns about slow frames (>16.67ms)
- Shows average frame time

### 2. **Function Timings**
- `CanvasCourse.render` - Main render loop
- `buildBaseCanvas` - Terrain cache building (expensive!)
- `buildBaseCanvas.pass1_tiles` - Tile texture rendering
- `buildBaseCanvas.pass2_edges` - Edge blending
- `buildBaseCanvas.pass2.5_greens` - Green treatment
- `buildBaseCanvas.pass3_lighting` - Global lighting
- `render.infiniteCanvas` - Infinite canvas tile rendering
- `scoreCourseHoles` - Hole scoring calculations
- `evaluateHole` - Hole evaluation

### 3. **React Render Tracking**
- Component render frequency
- Average render time per component
- Most frequently rendering components

### 4. **Event Frequency**
- `pointermove` events per second
- Other DOM events

### 5. **Memory Usage**
- JavaScript heap size
- Memory trends over time

## Reading the Metrics

Metrics are logged every 3 seconds with color-coded indicators:

- 🟢 Green: Normal performance (< 8ms or < 30 events/sec)
- 🟡 Yellow: Moderate performance (8-16ms or 30-60 events/sec)
- 🔴 Red: Poor performance (> 16ms or > 60 events/sec)

### Example Output

```
[PerfProfiler] Metrics Report
📊 Frame Rate: 45.2 fps (avg 22.1ms), 12 slow frames
⏱️ Function Timings (slowest first)
  🔴 buildBaseCanvas: avg 234.5ms, max 456.2ms, called 1x
  🟡 CanvasCourse.render: avg 12.3ms, max 18.5ms, called 180x
  🟢 scoreCourseHoles: avg 2.1ms, max 3.4ms, called 5x
⚛️ React Renders (most frequent first)
  🟡 App: 45 renders, avg 8.2ms
  🟢 CanvasCourse: 12 renders, avg 3.1ms
🖱️ Event Counts (last 3s)
  🔴 pointermove: 342 events (114.0/sec)
💾 Memory: 45.2MB used, 2048.0MB limit, 42.1MB avg
```

## Common Issues & Solutions

### High `pointermove` Event Rate (> 60/sec)
**Problem**: Too many pointer move events causing React re-renders
**Solution**: Already fixed with refs and dirty flags, but check if any components are still using `useState` in pointer handlers

### Slow `buildBaseCanvas` (> 100ms)
**Problem**: Terrain cache rebuild is expensive
**Solution**: 
- Only rebuilds when course changes (good!)
- Consider reducing tile count or simplifying rendering passes
- Check if `course` object is being recreated unnecessarily

### Slow `render.infiniteCanvas` (> 16ms)
**Problem**: Rendering too many tiles per frame
**Solution**:
- Reduce visible tile range
- Cache rendered tiles in a texture
- Simplify tile rendering (remove soft edges, lighting)

### High React Render Frequency
**Problem**: Components re-rendering too often
**Solution**:
- Check component dependencies in `useMemo`/`useEffect`
- Ensure props are stable (not recreated on each render)
- Use React DevTools Profiler to identify unnecessary renders

### Slow `scoreCourseHoles` or `evaluateHole`
**Problem**: Expensive calculations running too frequently
**Solution**:
- Ensure they're wrapped in `useMemo` with correct dependencies
- Consider memoizing intermediate results
- Check if they're being called outside of memoization

## Accessing Profiler Data Programmatically

```javascript
// Get all metrics
const metrics = window.perfProfiler.getMetrics();

// Reset metrics
window.perfProfiler.reset();

// Disable profiler
localStorage.removeItem('enablePerfProfiler');
location.reload();
```

## Disabling Profiler

```javascript
localStorage.removeItem('enablePerfProfiler');
location.reload();
```

Or call:
```javascript
window.perfProfiler.stop();
```

## Tips

1. **Start with frame rate**: If FPS is low, check function timings to find the bottleneck
2. **Check event frequency**: High event rates suggest inefficient event handlers
3. **Monitor memory**: Growing memory suggests leaks (objects not being cleaned up)
4. **Focus on red indicators**: These are your biggest performance problems
5. **Compare before/after**: Reset metrics after making changes to see improvement

## React DevTools Profiler

For React-specific performance issues, use the React DevTools Profiler:
1. Install React DevTools browser extension
2. Open DevTools → Profiler tab
3. Click Record, interact with app, stop recording
4. Look for components with long render times or frequent renders


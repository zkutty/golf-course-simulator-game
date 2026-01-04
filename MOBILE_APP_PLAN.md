# Mobile App Implementation Plan

## Executive Summary
Convert the golf course simulator into a mobile-first Progressive Web App (PWA), with optional Capacitor wrapper for native app store distribution.

## Phase 1: PWA Foundation (Week 1-3)

### 1.1 PWA Manifest & Service Worker
- [ ] Create `public/manifest.json` with app metadata
- [ ] Add app icons (192×192, 512×512, maskable)
- [ ] Implement service worker for offline support
- [ ] Cache game assets and app shell
- [ ] Add install prompt handling

### 1.2 Touch Interaction Overhaul
**Current Issues:**
- Hover-based brush preview (src/ui/CanvasCourse.tsx, src/ui/PixiStage.tsx)
- Mouse-only event handlers
- No gesture support

**Changes Needed:**
```typescript
// Replace hover with tap-and-hold
- onMouseMove → onTouchMove + onMouseMove
- Add onTouchStart, onTouchEnd handlers
- Implement long-press for brush preview
- Add pinch-to-zoom gesture (use-gesture library)
- Pan gesture for course navigation
```

**Files to Modify:**
- `src/ui/CanvasCourse.tsx` - Add touch event handlers
- `src/ui/PixiStage.tsx` - Add touch event handlers
- `src/App.tsx` - Gesture state management
- `src/ui/HUD.tsx` - Touch-friendly controls

### 1.3 Mobile UI Layout
**Responsive Improvements:**
```css
/* Current: 768px breakpoint */
/* New: Multiple breakpoints + bottom sheet design */

@media (max-width: 480px) {
  /* Phone portrait - full reflow */
}

@media (max-width: 768px) {
  /* Phone landscape / small tablet */
}

@media (max-width: 1024px) {
  /* Tablet */
}
```

**UI Changes:**
- Convert sidebar to collapsible bottom sheet on mobile
- Add floating action button for mode switching
- Touch-friendly button sizing (minimum 44×44px tap targets)
- Reduce information density on small screens
- Add swipe gestures to toggle panels

**Files to Modify:**
- `src/ui/cozyLayout.css` - Enhanced breakpoints
- `src/ui/HUD.tsx` - Bottom sheet component
- `src/ui/gameui/ModePanel.tsx` - Mobile mode switcher
- `src/ui/gameui/CourseInfoPane.tsx` - Collapsible design

### 1.4 Performance Optimization
**Mobile-Specific:**
- [ ] Reduce tile grid resolution on small screens (64×64 → 48×48 or adaptive)
- [ ] Implement render throttling for touch events
- [ ] Add performance mode toggle (reduce visual effects)
- [ ] Lazy load audio assets
- [ ] Optimize Pixi.js sprite batching for mobile GPUs
- [ ] Add FPS limiter (30fps for battery saving)

**Files to Modify:**
- `src/game/gameState.ts` - Adaptive grid sizing
- `src/ui/CanvasCourse.tsx` - Render throttling
- `src/ui/PixiStage.tsx` - Mobile GPU optimizations
- `src/utils/performance.ts` - FPS limiting

### 1.5 Viewport & Zoom System
**Current:** Fixed viewport, adaptive tile size (4-40px)
**New:** Pinch-to-zoom with constraints

```typescript
// Implement zoom levels
const ZOOM_LEVELS = {
  min: 0.5,   // See full course
  max: 3.0,   // Detail editing
  default: 1.0
};

// Pan constraints (keep course in view)
// Momentum scrolling for smooth UX
```

**Files to Modify:**
- `src/game/render/camera.ts` - Zoom state management
- `src/ui/CanvasCourse.tsx` - Zoom rendering
- `src/ui/PixiStage.tsx` - Zoom rendering
- Add new `src/hooks/useGestures.ts` - Gesture hook

---

## Phase 2: Native Features with Capacitor (Week 4-6)

### 2.1 Capacitor Setup
```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npx cap add ios
npx cap add android
```

**Configuration:**
- App ID: `com.simgolf.coursesimulator`
- App Name: "Golf Course Simulator"
- Web directory: `dist`

### 2.2 Native Plugin Integration
```bash
npm install @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen
```

**Haptic Feedback:**
- Tap feedback on button press
- Impact feedback on terrain paint
- Success/error vibrations

**Status Bar:**
- Immersive mode (hide on game view)
- Match theme color

**Splash Screen:**
- Custom branding
- Auto-hide on load

### 2.3 Platform-Specific UI
- [ ] Handle iOS safe areas (notch, home indicator)
- [ ] Handle Android navigation bar
- [ ] Back button handling (Android)
- [ ] Orientation locking (landscape preferred for game)

### 2.4 App Store Preparation
**iOS:**
- [ ] Create App Store Connect listing
- [ ] Generate app icons and screenshots
- [ ] Configure privacy settings (no tracking)
- [ ] TestFlight beta testing
- [ ] Submit for review

**Android:**
- [ ] Create Play Console listing
- [ ] Generate app signing key
- [ ] Create feature graphic and screenshots
- [ ] Internal testing track
- [ ] Submit for review

---

## Phase 3: Mobile-Specific Features (Optional Enhancement)

### 3.1 Touch-Optimized Hole Wizard
- Large touch targets for tee/green placement
- Visual feedback for drag operations
- Snap-to-grid for easier placement on small screens

### 3.2 Gesture Shortcuts
- Two-finger swipe: Undo/Redo
- Pinch out: Zoom in
- Pinch in: Zoom out
- Two-finger rotate: Rotate view (future feature)
- Long-press: Context menu

### 3.3 Mobile-Specific UI Modes
- **Architect View:** Full detail with grid (tablet/large phones)
- **Simple View:** Reduced detail for small phones
- **Play View:** Shot visualization only

### 3.4 Offline Mode Enhancements
- Cache entire game state
- Sync save data when online
- Cloud save support (future: Firebase/Supabase)

---

## Technical Dependencies to Add

```json
{
  "dependencies": {
    "@use-gesture/react": "^10.3.0",
    "workbox-precaching": "^7.0.0",
    "workbox-routing": "^7.0.0",
    "workbox-strategies": "^7.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0",
    "vite-plugin-pwa": "^0.20.0"
  },
  "optionalDependencies": {
    "@capacitor/core": "^6.0.0",
    "@capacitor/ios": "^6.0.0",
    "@capacitor/android": "^6.0.0",
    "@capacitor/haptics": "^6.0.0",
    "@capacitor/status-bar": "^6.0.0",
    "@capacitor/splash-screen": "^6.0.0"
  }
}
```

---

## Testing Strategy

### Device Testing Matrix
| Device | OS | Browser | Priority |
|--------|----|---------|---------|
| iPhone 14 Pro | iOS 17 | Safari | High |
| iPhone SE 2020 | iOS 17 | Safari | High |
| Samsung Galaxy S23 | Android 14 | Chrome | High |
| iPad Air | iOS 17 | Safari | Medium |
| Pixel 7 | Android 14 | Chrome | Medium |
| OnePlus 9 | Android 13 | Chrome | Low |

### Test Cases
- [ ] Course editing with touch
- [ ] Hole wizard completion
- [ ] Game simulation (10+ weeks)
- [ ] Save/load functionality
- [ ] Offline mode
- [ ] Installation flow (PWA)
- [ ] Orientation changes
- [ ] Battery usage (30min session)
- [ ] Memory usage (no leaks)
- [ ] Rendering performance (30fps minimum)

---

## Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| First Load | < 3s | < 5s |
| Time to Interactive | < 2s | < 4s |
| Frame Rate | 60fps | 30fps |
| Bundle Size | < 500KB | < 1MB |
| Memory Usage | < 150MB | < 300MB |
| Battery (30min) | < 10% | < 20% |

---

## Risk Mitigation

### High Risk
1. **WebGL Performance on Budget Phones**
   - Mitigation: Canvas 2D fallback, performance mode, reduced grid size

2. **iOS Safari Quirks**
   - Mitigation: Extensive iOS testing, Capacitor for better control

### Medium Risk
3. **Touch Gesture Conflicts**
   - Mitigation: Configurable gestures, clear visual feedback

4. **App Store Rejection**
   - Mitigation: Follow guidelines strictly, clear app description

### Low Risk
5. **Offline Storage Limits**
   - Mitigation: Compress save data, warn user at 80% quota

---

## Success Metrics

### Launch (Month 1)
- [ ] 1,000 PWA installations
- [ ] < 5% crash rate
- [ ] Average session > 10 minutes
- [ ] 4+ star rating (if app store)

### Growth (Month 3)
- [ ] 10,000 active users
- [ ] < 2% crash rate
- [ ] 30%+ return rate (weekly)
- [ ] Positive user reviews

---

## Deliverables

### Phase 1 (PWA)
1. PWA manifest and service worker
2. Touch interaction implementation
3. Mobile-responsive UI
4. Performance optimizations
5. Testing on 5+ devices
6. Deployment documentation

### Phase 2 (Capacitor)
1. iOS app build
2. Android app build
3. Native plugin integration
4. App store assets
5. Submission to stores
6. Beta testing program

---

## Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| PWA Foundation | 2-3 weeks | Installable mobile web app |
| Capacitor Wrapper | 2-3 weeks | Native apps for stores |
| Store Submission | 1-2 weeks | Published apps |
| **Total** | **5-8 weeks** | Full mobile presence |

---

## Alternative: Quick Mobile Win (1 Week)

If you need a mobile-usable version ASAP:

1. **Touch Events (2 days)**
   - Add basic touch handlers to Canvas/Pixi components
   - Replace hover with tap

2. **UI Adjustments (2 days)**
   - Improve responsive breakpoints
   - Larger tap targets
   - Simplified mobile layout

3. **Gestures (2 days)**
   - Add use-gesture for pinch-zoom
   - Pan support

4. **Testing (1 day)**
   - Test on 2-3 devices
   - Fix critical bugs

**Result:** Usable mobile web app (not installable, but functional)

---

## Recommendation

**Start with Phase 1 (PWA)** to validate mobile usage and gather user feedback before committing to app store submission. This approach:
- Minimizes risk
- Allows rapid iteration
- Tests market demand
- Keeps options open for native features later

Once you have validated mobile usage with PWA, Phase 2 (Capacitor) can be added incrementally without disrupting existing users.

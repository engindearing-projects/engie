//! Phase 3: Floating desktop character
//!
//! A transparent borderless always-on-top window showing an animated sprite.
//! The character can be dragged by the user and moves on its own (idle animations,
//! random walks, reactions to tool calls).
//!
//! Gated behind the `character` feature flag.
//! Uses `tao` for windowing + `tiny-skia` for CPU rendering + `softbuffer` for
//! blitting to the OS compositor.
//!
//! # Integration
//!
//! In your `main.rs` event loop:
//!
//! ```rust,ignore
//! // Create character (after tray, on main thread):
//! let mut character = CharacterWindow::new(&event_loop);
//!
//! // In event loop:
//! Event::NewEvents(StartCause::Init) => {
//!     // Start a 16ms (~60 fps) timer for animation / physics
//! }
//! Event::UserEvent(UserEvent::Tick) => {
//!     character.tick();
//!     character.render();
//! }
//! Event::WindowEvent { window_id, event } if window_id == character.window_id() => {
//!     match event {
//!         WindowEvent::CursorMoved { position, .. } => {
//!             character.update_cursor(position);
//!         }
//!         WindowEvent::MouseInput { state: ElementState::Pressed, button: MouseButton::Left, .. } => {
//!             if let Some(pos) = character.last_cursor_position() {
//!                 character.start_drag(pos);
//!             }
//!         }
//!         WindowEvent::MouseInput { state: ElementState::Released, button: MouseButton::Left, .. } => {
//!             character.end_drag();
//!         }
//!         _ => {}
//!     }
//! }
//! ```

use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Instant;

use softbuffer::{Context as SoftContext, Surface};
use tao::dpi::{LogicalPosition, LogicalSize, PhysicalPosition};
use tao::event_loop::EventLoopWindowTarget;
use tao::window::{Window, WindowBuilder, WindowId};

use crate::animation::{AnimState, AnimationController};
use crate::physics::PhysicsState;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Logical size of the character sprite / window (square).
const SPRITE_LOGICAL: f64 = 128.0;

/// Physical size used for rendering (we always render at 1x and let the OS scale).
const SPRITE_PX: u32 = 128;

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

struct DragState {
    /// Cursor position at drag start (physical, screen-relative).
    start_cursor: PhysicalPosition<f64>,
    /// Window outer position at drag start.
    start_window: (f64, f64),
}

// ---------------------------------------------------------------------------
// CharacterWindow
// ---------------------------------------------------------------------------

pub struct CharacterWindow {
    window: Arc<Window>,
    surface: Surface<Arc<Window>, Arc<Window>>,
    animation: AnimationController,
    physics: PhysicsState,
    dragging: Option<DragState>,
    last_tick: Instant,
    /// Last known cursor position relative to the window (for drag start).
    last_cursor: Option<PhysicalPosition<f64>>,
}

impl CharacterWindow {
    /// Create the character window. Must be called on the main thread.
    ///
    /// `T` is the user event type of your event loop (use `()` if you have none).
    pub fn new<T: 'static>(event_loop: &EventLoopWindowTarget<T>) -> Self {
        let window = Arc::new(
            WindowBuilder::new()
                .with_title("") // no title bar anyway
                .with_decorations(false)
                .with_transparent(true)
                .with_always_on_top(true)
                .with_resizable(false)
                .with_inner_size(LogicalSize::new(SPRITE_LOGICAL, SPRITE_LOGICAL))
                .with_position(LogicalPosition::new(100.0, 100.0))
                .build(event_loop)
                .expect("failed to create character window"),
        );

        // Create softbuffer context and surface.
        // softbuffer needs owned (Arc) handles for both display and window so it
        // can keep references alive for the lifetime of the surface.
        let context =
            SoftContext::new(Arc::clone(&window)).expect("softbuffer: failed to create context");
        let surface = Surface::new(&context, Arc::clone(&window))
            .expect("softbuffer: failed to create surface");

        // macOS: force window + softbuffer's CALayer to be non-opaque so
        // per-pixel alpha compositing works (no black box around the sprite).
        #[cfg(target_os = "macos")]
        {
            use tao::platform::macos::WindowExtMacOS;
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::{AnyClass, AnyObject};

                let ns_win = &*(window.ns_window() as *const AnyObject);

                // Window must be non-opaque for alpha compositing
                let _: () = msg_send![ns_win, setOpaque: false];
                // Remove the default window shadow (looks odd on a transparent sprite)
                let _: () = msg_send![ns_win, setHasShadow: false];

                // Clear background color
                let ns_color_cls = AnyClass::get(c"NSColor").unwrap();
                let clear: *const AnyObject = msg_send![ns_color_cls, clearColor];
                let _: () = msg_send![ns_win, setBackgroundColor: &*clear];

                // Make content view's layer (and softbuffer's sublayers) non-opaque
                let cv: *const AnyObject = msg_send![ns_win, contentView];
                if !cv.is_null() {
                    let _: () = msg_send![&*cv, setWantsLayer: true];
                    let layer: *const AnyObject = msg_send![&*cv, layer];
                    if !layer.is_null() {
                        let _: () = msg_send![&*layer, setOpaque: false];

                        // Also set all sublayers (softbuffer creates one) to non-opaque
                        let sublayers: *const AnyObject = msg_send![&*layer, sublayers];
                        if !sublayers.is_null() {
                            let count: usize = msg_send![&*sublayers, count];
                            for i in 0..count {
                                let sub: *const AnyObject =
                                    msg_send![&*sublayers, objectAtIndex: i];
                                if !sub.is_null() {
                                    let _: () = msg_send![&*sub, setOpaque: false];
                                }
                            }
                        }
                    }
                }
            }
        }

        // Determine screen size for physics bounds
        let monitor = window
            .current_monitor()
            .or_else(|| window.available_monitors().next());
        let (screen_w, screen_h) = match monitor {
            Some(m) => {
                let size = m.size();
                (size.width as f64, size.height as f64)
            }
            None => (1920.0, 1080.0),
        };

        let animation = AnimationController::load_placeholder_sprites(SPRITE_PX);
        let physics = PhysicsState::new(screen_w, screen_h, SPRITE_PX);

        Self {
            window,
            surface,
            animation,
            physics,
            dragging: None,
            last_tick: Instant::now(),
            last_cursor: None,
        }
    }

    // -- event handling ------------------------------------------------------

    /// Advance animation and physics by the wall-clock time since the last tick.
    pub fn tick(&mut self) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_tick).as_secs_f32();
        self.last_tick = now;

        let is_dragging = self.dragging.is_some();

        // Tick animation
        let frame_changed = self.animation.tick(dt);

        // Decide animation state based on physics
        if !is_dragging {
            let current = self.animation.state();
            // Don't interrupt one-shot animations
            let is_oneshot = matches!(current, AnimState::Reacting | AnimState::Waving);
            if !is_oneshot {
                if self.physics.should_sleep() {
                    self.animation.set_state(AnimState::Sleeping);
                } else if self.physics.is_walking() {
                    self.animation.set_state(AnimState::Walking);
                } else {
                    self.animation.set_state(AnimState::Idle);
                }
            }
        }

        // Tick physics (moves the window position)
        if let Some(pos) = self.physics.tick(dt, is_dragging) {
            self.window
                .set_outer_position(tao::dpi::PhysicalPosition::new(pos.x, pos.y));
        }

        // Re-render if the frame changed or we moved
        if frame_changed || !is_dragging {
            self.render();
        }
    }

    /// Render the current animation frame into the window surface.
    pub fn render(&mut self) {
        let frame = self.animation.current_frame();
        let src = frame.pixmap.data(); // RGBA u8 slice
        let w = SPRITE_PX;
        let h = SPRITE_PX;

        // Resize the surface to match the sprite dimensions
        let nz_w = NonZeroU32::new(w).unwrap();
        let nz_h = NonZeroU32::new(h).unwrap();
        if self.surface.resize(nz_w, nz_h).is_err() {
            return; // surface not ready
        }

        let mut buffer = match self.surface.buffer_mut() {
            Ok(b) => b,
            Err(_) => return,
        };

        // Convert RGBA (tiny-skia) -> 0xAARRGGBB (softbuffer native format on macOS).
        // tiny-skia stores pixels as premultiplied RGBA u8 by default, so we
        // keep them as-is and just pack into u32.
        for (i, chunk) in src.chunks_exact(4).enumerate() {
            let r = chunk[0] as u32;
            let g = chunk[1] as u32;
            let b = chunk[2] as u32;
            let a = chunk[3] as u32;
            buffer[i] = (a << 24) | (r << 16) | (g << 8) | b;
        }

        let _ = buffer.present();
    }

    // -- drag handling -------------------------------------------------------

    /// Call when the cursor moves over the character window. Stores the position
    /// and, if a drag is active, moves the window.
    pub fn update_cursor(&mut self, position: PhysicalPosition<f64>) {
        self.last_cursor = Some(position);

        if let Some(ref drag) = self.dragging {
            // Compute new window position: original window pos + cursor delta
            let delta_x = position.x - drag.start_cursor.x;
            let delta_y = position.y - drag.start_cursor.y;
            let new_x = drag.start_window.0 + delta_x;
            let new_y = drag.start_window.1 + delta_y;

            self.window
                .set_outer_position(PhysicalPosition::new(new_x as i32, new_y as i32));
            self.physics.set_position(new_x, new_y);

            // Record position for throw velocity calculation
            self.physics.record_drag_position(new_x, new_y);
        } else {
            // Hit-test: toggle click-through based on distance from sprite center
            let center = SPRITE_LOGICAL / 2.0;
            let dx = position.x - center;
            let dy = position.y - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let in_hitbox = dist < SPRITE_LOGICAL * 0.4; // 40% radius

            let _ = self.window.set_ignore_cursor_events(!in_hitbox);
        }
    }

    /// Begin a drag operation. Uses the last known cursor position.
    pub fn start_drag(&mut self, cursor: PhysicalPosition<f64>) {
        let outer = self.window.outer_position().unwrap_or_default();
        self.dragging = Some(DragState {
            start_cursor: cursor,
            start_window: (outer.x as f64, outer.y as f64),
        });
        self.physics.stop();
        self.physics.wake();
        self.animation.set_state(AnimState::Dragged);
    }

    /// End a drag operation. Calculates throw velocity from recent cursor
    /// movement and enables gravity so the character falls and settles.
    pub fn end_drag(&mut self) {
        self.dragging = None;
        self.physics.begin_throw();
        self.animation.set_state(AnimState::Idle);
    }

    /// Whether a drag is currently active.
    pub fn is_dragging(&self) -> bool {
        self.dragging.is_some()
    }

    // -- reactions -----------------------------------------------------------

    /// Trigger a reaction animation in response to a tool call.
    /// Wakes the character if sleeping.
    pub fn react(&mut self, _tool_name: &str) {
        self.physics.wake();
        self.animation.set_state(AnimState::Reacting);
    }

    /// Play the wave greeting animation.
    pub fn wave(&mut self) {
        self.physics.wake();
        self.animation.set_state(AnimState::Waving);
    }

    // -- accessors -----------------------------------------------------------

    /// Get the `tao` window ID for matching in the event loop.
    pub fn window_id(&self) -> WindowId {
        self.window.id()
    }

    /// Get the last known cursor position over this window.
    pub fn last_cursor_position(&self) -> Option<PhysicalPosition<f64>> {
        self.last_cursor
    }
}

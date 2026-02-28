//! Physics and movement for the desktop character.
//!
//! Handles screen bounds, random walks, and idle timing.
//! No external `rand` crate -- uses a simple time-seeded PRNG.

use tao::dpi::PhysicalPosition;

// ---------------------------------------------------------------------------
// Physics state
// ---------------------------------------------------------------------------

/// Number of recent cursor samples to keep for throw velocity calculation.
const DRAG_HISTORY_LEN: usize = 5;

pub struct PhysicsState {
    /// Current position (top-left of the character window, in physical pixels).
    pub position: (f64, f64),
    /// Current velocity (pixels per second).
    pub velocity: (f64, f64),
    /// If set, the character is moving toward this point.
    pub destination: Option<(f64, f64)>,
    /// Screen work area: (x, y, width, height).
    pub screen_bounds: (f64, f64, f64, f64),
    /// Seconds until the next random movement is chosen.
    pub movement_timer: f32,
    /// Seconds the character has been stationary (for sleep transition).
    pub idle_timer: f32,
    /// Character sprite size in physical pixels (for bounds clamping).
    sprite_size: f64,
    /// Internal PRNG state.
    rng_state: u64,
    /// Whether gravity is currently active (after a throw).
    pub gravity_enabled: bool,
    /// Recent drag positions for throw velocity calculation: (x, y, timestamp).
    drag_history: Vec<(f64, f64, std::time::Instant)>,
}

impl PhysicsState {
    pub fn new(screen_width: f64, screen_height: f64, sprite_size: u32) -> Self {
        let seed = time_seed();
        Self {
            position: (screen_width / 2.0, screen_height / 2.0),
            velocity: (0.0, 0.0),
            destination: None,
            screen_bounds: (0.0, 0.0, screen_width, screen_height),
            movement_timer: 5.0 + seeded_f32(seed) * 10.0,
            idle_timer: 0.0,
            sprite_size: sprite_size as f64,
            rng_state: seed,
            gravity_enabled: false,
            drag_history: Vec::with_capacity(DRAG_HISTORY_LEN),
        }
    }

    /// Advance physics by `dt` seconds.
    ///
    /// When `is_dragging` is true all timers are paused and no position change
    /// is computed (the window position is controlled by drag events instead).
    ///
    /// Returns `Some(position)` when the window should be moved.
    pub fn tick(&mut self, dt: f32, is_dragging: bool) -> Option<PhysicalPosition<i32>> {
        if is_dragging {
            self.idle_timer = 0.0;
            self.movement_timer = 3.0 + self.next_f32() * 8.0;
            return None;
        }

        self.idle_timer += dt;

        let mut moved = false;

        // Gravity / throw physics takes priority over walk destinations
        if self.gravity_enabled {
            let gravity = 200.0_f64; // pixels per second^2
            self.velocity.1 += gravity * dt as f64;

            // Apply velocity
            self.position.0 += self.velocity.0 * dt as f64;
            self.position.1 += self.velocity.1 * dt as f64;

            // Horizontal drag — slow down X over time
            self.velocity.0 *= (1.0 - 2.0 * dt as f64).max(0.0);

            moved = true;

            // Check if settled on the bottom edge
            let max_y = self.screen_bounds.1 + self.screen_bounds.3 - self.sprite_size;
            if self.position.1 >= max_y && self.velocity.1 > 0.0 {
                self.position.1 = max_y;
                // Bounce with heavy damping
                self.velocity.1 = -self.velocity.1 * 0.3;
                // If the bounce is tiny, settle
                if self.velocity.1.abs() < 15.0 {
                    self.velocity = (0.0, 0.0);
                    self.gravity_enabled = false;
                    self.movement_timer = 3.0 + self.next_f32() * 8.0;
                }
            }
        } else if let Some((dx, dy)) = self.destination {
            let speed: f64 = 60.0; // pixels per second
            let dir_x = dx - self.position.0;
            let dir_y = dy - self.position.1;
            let dist = (dir_x * dir_x + dir_y * dir_y).sqrt();

            if dist < 2.0 {
                // Arrived
                self.destination = None;
                self.velocity = (0.0, 0.0);
                self.movement_timer = 5.0 + self.next_f32() * 10.0;
            } else {
                let nx = dir_x / dist;
                let ny = dir_y / dist;
                self.velocity = (nx * speed, ny * speed);
                self.position.0 += self.velocity.0 * dt as f64;
                self.position.1 += self.velocity.1 * dt as f64;
                moved = true;
            }
        } else {
            // Countdown to next random movement
            self.movement_timer -= dt;
            if self.movement_timer <= 0.0 {
                self.pick_random_destination();
            }
        }

        // Bounce off screen edges instead of hard clamping
        let (bx, by, bw, bh) = self.screen_bounds;
        let min_x = bx;
        let max_x = bx + bw - self.sprite_size;
        let min_y = by;
        let max_y = by + bh - self.sprite_size;
        let bounce_dampen = 0.5;

        if self.position.0 < min_x {
            self.position.0 = min_x;
            self.velocity.0 = self.velocity.0.abs() * bounce_dampen;
            self.destination = None; // cancel walk to avoid re-hitting edge
            moved = true;
        } else if self.position.0 > max_x {
            self.position.0 = max_x;
            self.velocity.0 = -self.velocity.0.abs() * bounce_dampen;
            self.destination = None;
            moved = true;
        }

        if self.position.1 < min_y {
            self.position.1 = min_y;
            self.velocity.1 = self.velocity.1.abs() * bounce_dampen;
            self.destination = None;
            moved = true;
        } else if self.position.1 > max_y {
            self.position.1 = max_y;
            self.velocity.1 = -self.velocity.1.abs() * bounce_dampen;
            self.destination = None;
            moved = true;
        }

        if moved {
            Some(PhysicalPosition::new(
                self.position.0 as i32,
                self.position.1 as i32,
            ))
        } else {
            None
        }
    }

    /// Whether the character has been idle long enough to sleep (30 seconds).
    pub fn should_sleep(&self) -> bool {
        self.idle_timer > 30.0
    }

    /// Whether the character is currently moving (walking to a destination or in a throw arc).
    pub fn is_walking(&self) -> bool {
        self.destination.is_some() || self.gravity_enabled
    }

    /// Immediately set the position (used during drag).
    pub fn set_position(&mut self, x: f64, y: f64) {
        self.position = (x, y);
    }

    /// Cancel any in-progress walk.
    pub fn stop(&mut self) {
        self.destination = None;
        self.velocity = (0.0, 0.0);
    }

    /// Reset the idle timer (e.g. after a reaction or user interaction).
    pub fn wake(&mut self) {
        self.idle_timer = 0.0;
    }

    /// Record cursor position during a drag for throw velocity calculation.
    pub fn record_drag_position(&mut self, x: f64, y: f64) {
        let now = std::time::Instant::now();
        self.drag_history.push((x, y, now));
        // Keep only the most recent samples
        if self.drag_history.len() > DRAG_HISTORY_LEN {
            self.drag_history.remove(0);
        }
    }

    /// Calculate throw velocity from recent drag history and enable gravity.
    /// Returns the computed velocity for external use (or just lets physics handle it).
    pub fn begin_throw(&mut self) {
        if self.drag_history.len() < 2 {
            self.drag_history.clear();
            return;
        }

        let first = self.drag_history.first().unwrap();
        let last = self.drag_history.last().unwrap();
        let dt = last.2.duration_since(first.2).as_secs_f64();

        if dt < 0.001 {
            self.drag_history.clear();
            return;
        }

        let vx = (last.0 - first.0) / dt;
        let vy = (last.1 - first.1) / dt;

        // Clamp to a reasonable max velocity (1500 px/s)
        let max_vel = 1500.0;
        let speed = (vx * vx + vy * vy).sqrt();
        let (vx, vy) = if speed > max_vel {
            let scale = max_vel / speed;
            (vx * scale, vy * scale)
        } else {
            (vx, vy)
        };

        // Only enable gravity if there was meaningful movement
        if speed > 30.0 {
            self.velocity = (vx, vy);
            self.gravity_enabled = true;
            self.destination = None;
        }

        self.drag_history.clear();
    }

    // -- private helpers -----------------------------------------------------

    fn pick_random_destination(&mut self) {
        let (bx, by, bw, bh) = self.screen_bounds;
        let margin = self.sprite_size;

        // Bias toward edges: pick a random edge, then a random point along it.
        let edge = (self.next_u32() % 4) as u8;
        let along = self.next_f32() as f64;

        let (dx, dy) = match edge {
            0 => (bx + margin + along * (bw - 2.0 * margin), by + margin), // top
            1 => (bx + margin + along * (bw - 2.0 * margin), by + bh - 2.0 * margin), // bottom
            2 => (bx + margin, by + margin + along * (bh - 2.0 * margin)), // left
            _ => (bx + bw - 2.0 * margin, by + margin + along * (bh - 2.0 * margin)), // right
        };

        self.destination = Some((dx, dy));
        self.idle_timer = 0.0;
    }

    // -- internal PRNG (xorshift64) ------------------------------------------

    fn next_u64(&mut self) -> u64 {
        let mut s = self.rng_state;
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        self.rng_state = s;
        s
    }

    fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    fn next_f32(&mut self) -> f32 {
        (self.next_u32() % 10_000) as f32 / 10_000.0
    }
}

// ---------------------------------------------------------------------------
// Time-based seed (no rand crate)
// ---------------------------------------------------------------------------

fn time_seed() -> u64 {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // Mix seconds and nanos for a decent seed.
    dur.as_secs().wrapping_mul(6_364_136_223_846_793_005)
        ^ dur.subsec_nanos() as u64
}

fn seeded_f32(seed: u64) -> f32 {
    ((seed >> 16) % 10_000) as f32 / 10_000.0
}

//! Animation controller for the desktop character.
//!
//! Manages sprite frames, animation states, and transitions.
//! Placeholder sprites are generated programmatically using tiny-skia
//! (circles with soft gradients, pulsing, squishing, radiating particles).

use std::collections::HashMap;
use tiny_skia::{
    Color, FillRule, GradientStop, Paint, PathBuilder, Pixmap, Point,
    RadialGradient, SpreadMode, Transform,
};

// ---------------------------------------------------------------------------
// Animation state enum
// ---------------------------------------------------------------------------

/// Animation states the character can be in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnimState {
    /// Default breathing / blinking animation.
    Idle,
    /// Moving toward a destination.
    Walking,
    /// Being dragged by the user.
    Dragged,
    /// Reacting to a tool call (bounce / sparkle).
    Reacting,
    /// Idle for too long -- napping.
    Sleeping,
    /// Greeting wave animation.
    Waving,
}

// ---------------------------------------------------------------------------
// Sprite frame
// ---------------------------------------------------------------------------

/// A single frame of animation backed by a tiny-skia `Pixmap`.
pub struct SpriteFrame {
    pub pixmap: Pixmap,
}

// ---------------------------------------------------------------------------
// Animation controller
// ---------------------------------------------------------------------------

pub struct AnimationController {
    state: AnimState,
    frame_index: usize,
    frame_timer: f32,
    frames: HashMap<AnimState, Vec<SpriteFrame>>,
    fps: f32,
}

impl AnimationController {
    // -- public API ----------------------------------------------------------

    /// Build a controller with programmatically generated placeholder sprites.
    /// `size` is the width/height of each frame in pixels.
    pub fn load_placeholder_sprites(size: u32) -> Self {
        let mut frames: HashMap<AnimState, Vec<SpriteFrame>> = HashMap::new();

        frames.insert(AnimState::Idle, generate_idle_frames(size));
        frames.insert(AnimState::Walking, generate_walking_frames(size));
        frames.insert(AnimState::Reacting, generate_reacting_frames(size));
        frames.insert(AnimState::Dragged, generate_dragged_frames(size));
        frames.insert(AnimState::Sleeping, generate_sleeping_frames(size));
        frames.insert(AnimState::Waving, generate_waving_frames(size));

        Self {
            state: AnimState::Idle,
            frame_index: 0,
            frame_timer: 0.0,
            frames,
            fps: 12.0,
        }
    }

    /// Advance by `dt` seconds. Returns `true` if the visible frame changed.
    pub fn tick(&mut self, dt: f32) -> bool {
        self.frame_timer += dt;
        let frame_duration = 1.0 / self.fps;

        if self.frame_timer < frame_duration {
            return false;
        }

        self.frame_timer -= frame_duration;
        let total = self.frame_count();
        if total == 0 {
            return false;
        }

        self.frame_index += 1;

        if self.frame_index >= total {
            if self.is_oneshot() {
                // Return to idle after a one-shot animation finishes.
                self.set_state(AnimState::Idle);
            } else {
                self.frame_index = 0;
            }
        }

        true
    }

    /// Get the current frame's sprite data.
    pub fn current_frame(&self) -> &SpriteFrame {
        let seq = self.frames.get(&self.state).expect("missing animation");
        let idx = self.frame_index.min(seq.len().saturating_sub(1));
        &seq[idx]
    }

    /// Current animation state.
    pub fn state(&self) -> AnimState {
        self.state
    }

    /// Transition to a new state, resetting the frame counter.
    pub fn set_state(&mut self, state: AnimState) {
        if self.state != state {
            self.state = state;
            self.frame_index = 0;
            self.frame_timer = 0.0;
        }
    }

    // -- private helpers -----------------------------------------------------

    fn frame_count(&self) -> usize {
        self.frames
            .get(&self.state)
            .map_or(0, |seq| seq.len())
    }

    /// One-shot animations play once then return to Idle.
    fn is_oneshot(&self) -> bool {
        matches!(self.state, AnimState::Reacting | AnimState::Waving)
    }
}

// ===========================================================================
// Placeholder sprite generation
// ===========================================================================
//
// All sprites are `size x size` pixmaps drawn with tiny-skia primitives.
// The mascot is a soft glowing orb in blue-purple (#6366f1 -> #8b5cf6).

/// Core color constants (linear RGB, tiny-skia uses 0..1 floats).
const CORE_R: f32 = 0.388; // #6366f1
const CORE_G: f32 = 0.400;
const CORE_B: f32 = 0.945;

const EDGE_R: f32 = 0.545; // #8b5cf6
const EDGE_G: f32 = 0.361;
const EDGE_B: f32 = 0.965;

/// Brighter inner core (#818cf8) for enhanced glow.
const BRIGHT_R: f32 = 0.506;
const BRIGHT_G: f32 = 0.549;
const BRIGHT_B: f32 = 0.973;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Draw a filled circle with a radial gradient onto `pixmap`.
/// Uses the brighter core color for a more visible glow.
fn draw_orb(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    radius: f32,
    alpha: f32,
) {
    // Outer soft glow layer (larger, more transparent)
    let glow_radius = radius * 1.35;
    let glow_path = {
        let mut pb = PathBuilder::new();
        pb.push_circle(cx, cy, glow_radius);
        pb.finish().unwrap()
    };

    let glow_stops = vec![
        GradientStop::new(
            0.0,
            Color::from_rgba(BRIGHT_R, BRIGHT_G, BRIGHT_B, alpha * 0.3).unwrap(),
        ),
        GradientStop::new(
            0.6,
            Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, alpha * 0.12).unwrap(),
        ),
        GradientStop::new(
            1.0,
            Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, 0.0).unwrap(),
        ),
    ];

    let glow_gradient = RadialGradient::new(
        Point::from_xy(cx, cy),
        Point::from_xy(cx + glow_radius, cy),
        glow_radius,
        glow_stops,
        SpreadMode::Pad,
        Transform::identity(),
    );

    if let Some(shader) = glow_gradient {
        let mut paint = Paint::default();
        paint.shader = shader;
        paint.anti_alias = true;
        pixmap.fill_path(&glow_path, &paint, FillRule::Winding, Transform::identity(), None);
    }

    // Main orb body with brighter core
    let path = {
        let mut pb = PathBuilder::new();
        pb.push_circle(cx, cy, radius);
        pb.finish().unwrap()
    };

    let stops = vec![
        GradientStop::new(
            0.0,
            Color::from_rgba(BRIGHT_R, BRIGHT_G, BRIGHT_B, alpha).unwrap(),
        ),
        GradientStop::new(
            0.4,
            Color::from_rgba(CORE_R, CORE_G, CORE_B, alpha * 0.95).unwrap(),
        ),
        GradientStop::new(
            0.75,
            Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, alpha * 0.7).unwrap(),
        ),
        GradientStop::new(
            1.0,
            Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, 0.0).unwrap(),
        ),
    ];

    let gradient = RadialGradient::new(
        Point::from_xy(cx, cy),
        Point::from_xy(cx + radius, cy),
        radius,
        stops,
        SpreadMode::Pad,
        Transform::identity(),
    );

    if let Some(shader) = gradient {
        let mut paint = Paint::default();
        paint.shader = shader;
        paint.anti_alias = true;
        pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
    }
}

/// Draw a small filled circle (solid color, no gradient).
fn draw_dot(pixmap: &mut Pixmap, cx: f32, cy: f32, radius: f32, alpha: f32) {
    let path = {
        let mut pb = PathBuilder::new();
        pb.push_circle(cx, cy, radius);
        pb.finish().unwrap()
    };

    let mut paint = Paint::default();
    paint.set_color(Color::from_rgba(CORE_R, CORE_G, CORE_B, alpha).unwrap());
    paint.anti_alias = true;
    pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
}

/// Draw a short arc segment (used for wave / zzz decorations).
fn draw_arc_segment(
    pixmap: &mut Pixmap,
    cx: f32,
    cy: f32,
    radius: f32,
    start_angle: f32,
    sweep: f32,
    alpha: f32,
) {
    let steps = 12;
    let mut pb = PathBuilder::new();
    for i in 0..=steps {
        let t = start_angle + sweep * (i as f32 / steps as f32);
        let x = cx + radius * t.cos();
        let y = cy + radius * t.sin();
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    if let Some(path) = pb.finish() {
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba(CORE_R, CORE_G, CORE_B, alpha).unwrap());
        paint.anti_alias = true;
        let stroke = tiny_skia::Stroke {
            width: 2.5,
            ..Default::default()
        };
        pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
    }
}

// ---------------------------------------------------------------------------
// Per-state frame generators
// ---------------------------------------------------------------------------

/// Idle: a softly pulsing orb. 8 frames, opacity oscillates 0.75 .. 1.0,
/// radius scales between 0.95x and 1.05x for a breathing effect.
fn generate_idle_frames(size: u32) -> Vec<SpriteFrame> {
    let frame_count = 8;
    let center = size as f32 / 2.0;
    let base_radius = size as f32 * 0.35;

    (0..frame_count)
        .map(|i| {
            let t = i as f32 / frame_count as f32;
            let phase = (t * std::f32::consts::TAU).sin();
            // Brighter pulse range
            let alpha = 0.75 + 0.25 * phase.abs();
            // Subtle size breathing
            let scale = 0.95 + 0.10 * (0.5 + 0.5 * phase);
            let radius = base_radius * scale;

            let mut pixmap = Pixmap::new(size, size).unwrap();
            draw_orb(&mut pixmap, center, center, radius, alpha);
            SpriteFrame { pixmap }
        })
        .collect()
}

/// Walking: the orb squishes and bounces vertically like hopping. 8 frames total.
fn generate_walking_frames(size: u32) -> Vec<SpriteFrame> {
    let frame_count = 8;
    let center = size as f32 / 2.0;
    let base_radius = size as f32 * 0.30;

    (0..frame_count)
        .map(|i| {
            let t = i as f32 / frame_count as f32;
            // Squash/stretch cycle (2x frequency for a double-bounce feel)
            let squash = 1.0 + 0.18 * (t * std::f32::consts::TAU * 2.0).sin();
            let stretch = 1.0 / squash; // volume preservation

            // Vertical bounce: hop up and down using abs(sin) for a bouncy arc
            let bounce_height = size as f32 * 0.08;
            let bounce_y = -bounce_height * (t * std::f32::consts::TAU).sin().abs();

            let mut pixmap = Pixmap::new(size, size).unwrap();

            // Draw the orb stretched via transform with bounce offset
            let path = {
                let mut pb = PathBuilder::new();
                pb.push_circle(0.0, 0.0, base_radius);
                pb.finish().unwrap()
            };

            let stops = vec![
                GradientStop::new(0.0, Color::from_rgba(BRIGHT_R, BRIGHT_G, BRIGHT_B, 0.95).unwrap()),
                GradientStop::new(0.4, Color::from_rgba(CORE_R, CORE_G, CORE_B, 0.9).unwrap()),
                GradientStop::new(0.75, Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, 0.7).unwrap()),
                GradientStop::new(1.0, Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, 0.0).unwrap()),
            ];

            let gradient = RadialGradient::new(
                Point::from_xy(0.0, 0.0),
                Point::from_xy(base_radius, 0.0),
                base_radius,
                stops,
                SpreadMode::Pad,
                Transform::identity(),
            );

            if let Some(shader) = gradient {
                let mut paint = Paint::default();
                paint.shader = shader;
                paint.anti_alias = true;

                let xform = Transform::from_translate(center, center + bounce_y)
                    .pre_scale(squash, stretch);
                pixmap.fill_path(&path, &paint, FillRule::Winding, xform, None);
            }

            SpriteFrame { pixmap }
        })
        .collect()
}

/// Reacting: frame 1 = bright white flash, frames 2-8 = orb + 8 radiating dots.
/// Dots are bigger and brighter for visibility. 8 frames one-shot.
fn generate_reacting_frames(size: u32) -> Vec<SpriteFrame> {
    let frame_count = 8;
    let center = size as f32 / 2.0;
    let orb_radius = size as f32 * 0.30;
    let max_dist = size as f32 * 0.45;
    let dot_radius = size as f32 * 0.06;

    (0..frame_count)
        .map(|i| {
            let mut pixmap = Pixmap::new(size, size).unwrap();

            if i == 0 {
                // Frame 0: bright white flash — a large bright circle
                let flash_path = {
                    let mut pb = PathBuilder::new();
                    pb.push_circle(center, center, orb_radius * 1.5);
                    pb.finish().unwrap()
                };
                let flash_stops = vec![
                    GradientStop::new(0.0, Color::from_rgba(1.0, 1.0, 1.0, 0.95).unwrap()),
                    GradientStop::new(0.3, Color::from_rgba(BRIGHT_R, BRIGHT_G, BRIGHT_B, 0.9).unwrap()),
                    GradientStop::new(0.7, Color::from_rgba(CORE_R, CORE_G, CORE_B, 0.5).unwrap()),
                    GradientStop::new(1.0, Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, 0.0).unwrap()),
                ];
                let flash_gradient = RadialGradient::new(
                    Point::from_xy(center, center),
                    Point::from_xy(center + orb_radius * 1.5, center),
                    orb_radius * 1.5,
                    flash_stops,
                    SpreadMode::Pad,
                    Transform::identity(),
                );
                if let Some(shader) = flash_gradient {
                    let mut paint = Paint::default();
                    paint.shader = shader;
                    paint.anti_alias = true;
                    pixmap.fill_path(&flash_path, &paint, FillRule::Winding, Transform::identity(), None);
                }
            } else {
                let t = (i - 1) as f32 / (frame_count - 2) as f32; // 0..1 for frames 1-7

                // Orb pulses brighter then fades
                let orb_alpha = 1.0 - 0.25 * t;
                draw_orb(&mut pixmap, center, center, orb_radius, orb_alpha);

                // 8 dots at cardinal + diagonal directions, flying outward
                let dist = orb_radius + t * (max_dist - orb_radius);
                let dot_alpha = 1.0 - 0.7 * t; // stay bright longer before fading
                let dot_size = dot_radius * (1.0 - 0.3 * t);
                let angles: [f32; 8] = [
                    0.0,
                    std::f32::consts::FRAC_PI_4,
                    std::f32::consts::FRAC_PI_2,
                    std::f32::consts::FRAC_PI_4 * 3.0,
                    std::f32::consts::PI,
                    std::f32::consts::PI + std::f32::consts::FRAC_PI_4,
                    std::f32::consts::PI + std::f32::consts::FRAC_PI_2,
                    std::f32::consts::TAU - std::f32::consts::FRAC_PI_4,
                ];
                for angle in &angles {
                    let dx = dist * angle.cos();
                    let dy = dist * angle.sin();
                    draw_dot(
                        &mut pixmap,
                        center + dx,
                        center + dy,
                        dot_size,
                        dot_alpha,
                    );
                }
            }

            SpriteFrame { pixmap }
        })
        .collect()
}

/// Dragged: slightly elongated orb (stretched vertically). 4 frames, gentle wobble.
fn generate_dragged_frames(size: u32) -> Vec<SpriteFrame> {
    let frame_count = 4;
    let center = size as f32 / 2.0;
    let base_radius = size as f32 * 0.30;

    (0..frame_count)
        .map(|i| {
            let t = i as f32 / frame_count as f32;
            let stretch_y = 1.12 + 0.05 * (t * std::f32::consts::TAU).sin();
            let stretch_x = 1.0 / stretch_y;

            let mut pixmap = Pixmap::new(size, size).unwrap();

            let path = {
                let mut pb = PathBuilder::new();
                pb.push_circle(0.0, 0.0, base_radius);
                pb.finish().unwrap()
            };

            let stops = vec![
                GradientStop::new(0.0, Color::from_rgba(CORE_R, CORE_G, CORE_B, 0.95).unwrap()),
                GradientStop::new(0.7, Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, 0.8).unwrap()),
                GradientStop::new(1.0, Color::from_rgba(EDGE_R, EDGE_G, EDGE_B, 0.0).unwrap()),
            ];

            let gradient = RadialGradient::new(
                Point::from_xy(0.0, 0.0),
                Point::from_xy(base_radius, 0.0),
                base_radius,
                stops,
                SpreadMode::Pad,
                Transform::identity(),
            );

            if let Some(shader) = gradient {
                let mut paint = Paint::default();
                paint.shader = shader;
                paint.anti_alias = true;

                let xform = Transform::from_translate(center, center)
                    .pre_scale(stretch_x, stretch_y);
                pixmap.fill_path(&path, &paint, FillRule::Winding, xform, None);
            }

            SpriteFrame { pixmap }
        })
        .collect()
}

/// Sleeping: dim orb (alpha 0.4) + larger "zzz" arcs that float upward. 10 frames looping.
fn generate_sleeping_frames(size: u32) -> Vec<SpriteFrame> {
    let frame_count = 10;
    let center = size as f32 / 2.0;
    let radius = size as f32 * 0.32;

    (0..frame_count)
        .map(|i| {
            let t = i as f32 / frame_count as f32;
            let mut pixmap = Pixmap::new(size, size).unwrap();

            // Dimmer orb — noticeably sleepy
            draw_orb(&mut pixmap, center, center, radius, 0.4);

            // Three arcs floating upward to the right, staggered, larger and more visible
            for z in 0..3 {
                let phase = (t + z as f32 * 0.33) % 1.0;
                let arc_x = center + size as f32 * 0.22 + phase * size as f32 * 0.12;
                let arc_y = center - size as f32 * 0.10 - phase * size as f32 * 0.35;
                let arc_alpha = 0.8 * (1.0 - phase); // brighter, fade as they rise
                // Arcs grow as they rise, starting bigger
                let arc_size = size as f32 * 0.10 * (0.8 + 0.4 * phase);
                draw_arc_segment(
                    &mut pixmap,
                    arc_x,
                    arc_y,
                    arc_size,
                    -0.5,
                    std::f32::consts::PI,
                    arc_alpha,
                );
            }

            SpriteFrame { pixmap }
        })
        .collect()
}

/// Waving: orb + a larger arc that swings side to side. 12 frames one-shot for smoother motion.
fn generate_waving_frames(size: u32) -> Vec<SpriteFrame> {
    let frame_count = 12;
    let center = size as f32 / 2.0;
    let radius = size as f32 * 0.30;

    (0..frame_count)
        .map(|i| {
            let t = i as f32 / (frame_count - 1) as f32;
            let mut pixmap = Pixmap::new(size, size).unwrap();

            draw_orb(&mut pixmap, center, center, radius, 0.95);

            // Larger arc that swings more broadly — two full oscillations
            let swing_angle = -std::f32::consts::FRAC_PI_3
                + std::f32::consts::FRAC_PI_3 * 2.0
                    * (t * std::f32::consts::PI * 2.0).sin();
            let arm_length = radius * 1.2;
            let arc_cx = center + arm_length * swing_angle.cos();
            let arc_cy = center - radius * 0.8;
            let arc_alpha = if t < 0.12 || t > 0.88 {
                let edge_t = if t < 0.12 { t / 0.12 } else { (1.0 - t) / 0.12 };
                0.9 * edge_t
            } else {
                0.9
            };
            // Larger arc for visibility
            draw_arc_segment(
                &mut pixmap,
                arc_cx,
                arc_cy,
                size as f32 * 0.16,
                -std::f32::consts::FRAC_PI_2,
                std::f32::consts::PI * 1.2,
                arc_alpha,
            );

            SpriteFrame { pixmap }
        })
        .collect()
}

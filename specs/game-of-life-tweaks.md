# Conway's Game of Life Tweaks

This document is the canonical reference for the modifications to standard Conway's Game of Life implemented in this project. It covers only what differs from standard GoL — the reader is assumed to know the B3/S23 rule, Moore neighborhoods, and basic GoL terminology.

The universe is a 2D torus (wrapping in both axes). All coordinate arithmetic is modular.

## Simulation Lifecycle

The simulation alternates between two modes each tick: **physics ticking** and **entropy cycling**.

When **physics is ticking**, the full simulation runs: observation and nucleation create new cells from entropy, GoL rules advance active cells, history and oscillator counters update, and color inheritance occurs.

When **physics is not ticking**, all cell state is preserved unchanged — no cells are created, no GoL rules are applied, no history is updated. Only the entropy visualization changes as new entropy is injected. This mode is used when rendering frames between physics steps to maintain visual continuity without advancing the simulation.

The universe starts empty (all null cells) with an entropy field. Growth is organic — cells come into existence wherever they are observed or where entropy coherence triggers nucleation. There is no predetermined expansion schedule or generation-based phase transitions. The universe grows outward from wherever observation begins, bounded only by the availability of entropy.

The simulation continues until end-of-universe is detected (see [End of the Universe Detection](#end-of-the-universe-detection)), after which the universe fades out and resets.

## Entropy Field

Each cell has an associated entropy value: a 4-component signed integer vector with components in the range [-128, 127].

| Channel | Purpose |
|---------|---------|
| R | Probability seed — used to collapse a cell into alive or dead state |
| G, B | Hue direction vector — x and y components of a 2D unit vector (scaled to [-127, 127]) representing the cell's color angle |
| A | Unused |

Entropy is externally injected random data. It serves as the raw material for cell creation — a cell cannot come into existence without non-null entropy at its position. Unobserved cells visualize their entropy; observed cells collapse from it.

Entropy is injected at the expanding frontier of the universe, not uniformly across all cells. As the universe interior grows and stabilizes, the frontier where fresh entropy is needed shrinks.

### Entropy Frontier

The universe is divided into blocks (e.g. 16x16 cells) for interior tracking. An "interior" region starts at the center of the universe and expands outward. The interior expands in a given direction when all blocks along that edge are fully populated — every cell in those blocks exists (is non-null).

Entropy is only injected into the border regions outside the interior. Once a region's entropy has been consumed (collapsed into cell state) and all its cells exist, the interior boundary advances past it, and that region no longer receives fresh entropy. This creates a self-limiting growth pattern: the entropy frontier shrinks as the universe fills in.

## Cell State

Each cell's state is a 4-component signed integer vector:

| Channel | Purpose |
|---------|---------|
| R | Alive bit: 0 (dead) or 1 (alive) |
| G, B | Hue unit vector: 2D direction vector stored as int8 pair |
| A | Unused |

A cell with state `(0, 0, 0, 0)` is a **null cell** — it does not exist. This is distinct from a dead cell, which exists but has alive = 0 and a non-zero hue vector.

### Alive Bit

Standard B3/S23 rule, computed without branching:

```
alive = (neighbors == 3) | ((neighbors == 2) & prev_alive)
```

Where `neighbors` is the count of alive cells in the Moore neighborhood and `prev_alive` is the cell's previous alive bit. The bitwise OR and AND operators avoid conditional branching.

### Hue Unit Vector

Color is encoded as a 2D direction vector rather than a scalar angle. This avoids the discontinuity at the 360°/0° boundary — averaging two vectors near that boundary produces the correct intermediate angle, while averaging two scalar angles would not.

To recover a hue angle in degrees: `hue = atan2(g, b) * (180 / pi)`, adjusting negative values by adding 360°.

Special values:
- **Null hue** `(0, 0)`: indicates no hue has been assigned. Because the zero vector has no direction, a cell ending up with null hue after creation is replaced with the **default hue** `(0, 127)` (pointing "north", corresponding to 0°).

## Cell Existence States

Cells exist in one of three states, which determine how they participate in physics:

### NULL Cells

State vector is all zeros `(0, 0, 0, 0)`. The cell does not exist — it has no physics, no history, and no oscillator state. It may visualize its entropy value if entropy is present, but does not participate in GoL rules.

### Frozen Cells

The cell exists (non-null state) but has fewer than 8 existing neighbors — its Moore neighborhood is incomplete. The cell's state is preserved unchanged: it cannot tick because GoL rules require a full neighborhood to produce a deterministic result.

Frozen cells appear at the **event horizon** — the boundary between existing cells and the void. They are rendered at elevated brightness to visually mark this boundary.

### Active Cells

The cell exists with a complete Moore neighborhood (all 8 neighbors are non-null). Standard GoL rules apply. History is updated, oscillator counters advance, and color inheritance occurs.

## Observation Based Creation

NULL cells can come into existence through two mechanisms. Both require physics to be ticking, and both require non-null entropy at the cell's position — entropy is the raw material for existence.

### Nucleation via Entropy Field Coherence

Nucleation allows the universe to expand spontaneously, without direct observation.

For a NULL cell that is **not observed** (no existing neighbors and not within the external observer's viewport), the entropy field of its 8 neighbors is tested for coherence — whether the neighboring entropy vectors collectively "point inward" toward the cell.

**Pressure calculation:**

For each of the 8 neighbors, the dot product is taken between the neighbor's entropy vector (GB channels, normalized to [-1, 1]) and a unit vector pointing from that neighbor toward the cell. This dot product measures how much the neighbor's entropy "pushes" toward the cell.

The transform vectors for each neighbor direction are:

| Neighbor | Transform Vector |
|----------|-----------------|
| NW | normalize(1, 1) |
| N | (0, 1) |
| NE | normalize(-1, 1) |
| W | (1, 0) |
| E | (-1, 0) |
| SW | normalize(1, -1) |
| S | (0, -1) |
| SE | normalize(-1, -1) |

The sum of all 8 dot products is the **total pressure** (maximum 8.0). If:

```
total_pressure >= nucleation_threshold * 8.0
```

the cell nucleates. The default nucleation threshold is 0.93, requiring ~7.44 out of 8.0 pressure — meaning nearly all neighbors must point strongly inward.

**Nucleated cell state:**

The alive bit is determined by collapsing entropy (same as observation, see below). The hue vector is derived from the **residual pressure vector** — the vector sum of all 8 weighted transform vectors — minus the cell's own entropy vector. This delta is normalized to produce the cell's initial hue direction.

If the residual vector is near-zero (entropy forces cancel out), the null hue fallback applies.

### Creation via Observation

#### Observation by Neighbor(s)

If **any** existing (non-null) neighbor is present, the NULL cell is considered observed and comes into existence (provided it has non-null entropy).

##### Event Horizon Expansion Into Entropy

This neighbor-observation rule creates a propagating wavefront: each newly created cell's existence causes its null neighbors to be observed on the next tick, which in turn come into existence if they have entropy. The expansion front follows wherever entropy has been injected.

This is the primary mechanism for universe expansion — the "big bang" starts from a seed of existing cells and expands outward at 1 cell per generation in all directions. The expansion halts at the boundary of injected entropy and resumes when new entropy is injected at the frontier.

#### External Observation

A rectangular viewport defined by the external observer (the user's view) also triggers cell creation. Any NULL cell within this viewport that has non-null entropy comes into existence.

**Collapse into state:**

When a cell is created by observation (either by neighbors or externally), its alive bit is determined by its entropy R channel:

```
alive = (entropy_r + 128) / 255 <= alive_probability
```

Where `alive_probability` is a configurable parameter (default 0.5).

The cell's hue is blended from its own entropy GB vector **and** the hue vectors of all existing neighbors. All 9 vectors (8 neighbors + own entropy, where null neighbors contribute zero) are summed and normalized. This means newly observed cells inherit color influence from their existing neighbors, creating smooth color gradients at the event horizon rather than random color noise.

## Color Inheritance

When a cell is **born** (transitions from dead to alive) during normal GoL physics, and is not part of a detected oscillator (P0 / active), it inherits its hue from its three alive parent neighbors.

The hue vectors of all alive neighbors are summed (each weighted by their alive bit, so dead neighbors contribute nothing) and the result is normalized:

```
new_hue = normalize(sum of (neighbor.alive * neighbor.hue_vector) for all 8 neighbors)
```

This creates coherent color domains — groups of cells that share similar hues. As gliders and other patterns propagate, they carry their color with them, and the color domains slowly drift and blend over time.

Cells that **survive** (were alive and remain alive) retain their existing hue unchanged.

## Oscillator Detection

The system detects oscillating cells (repeating patterns of fixed period) to distinguish "active" cells from settled structures. This is used for visual rendering and end-of-universe detection.

### History Bits

Each cell maintains a 32-bit unsigned integer history. On each tick, the history is shifted left by 1 and the new alive bit is OR'd into the least significant bit:

```
history = (history << 1) | alive
```

This stores the last 32 on/off states as a bit sequence, with the most recent state in bit 0.

### Period Oscillation Detection

For a given period P, the cell is oscillating at period P if the last P states exactly match the P states before them:

```
mask = (1 << P) - 1
is_oscillating = (history & mask) == ((history >> P) & mask)
```

The system tracks oscillation counters for periods **1, 2, 3, 4, and 15** (must be checked in ascending order). Each counter:

- Increments by 1 each tick the period matches
- Resets to 0 when the period stops matching
- Is clamped at `256 - P` to prevent a lower-period oscillator from being mistaken for a higher-period one when both counters saturate

### Min P

The cell's detected oscillator period is the period whose counter has the **highest value**, provided that value meets the minimum threshold of **8 consecutive matches** (MIN_OSC_LEN). The highest-count rule works because a P2 oscillator also matches P4 (every P2 pattern repeats at P4), but the P2 counter will have accumulated twice as many matches, so it wins.

### P0 Cells

Cells with no detected oscillator period are classified as **P0** or "active" — their behavior is still changing and unpredictable. P0 cells have their own counter tracking consecutive ticks of non-oscillating behavior. When a cell transitions from active to oscillating, its P0 counter resets to 0.

## End of the Universe Detection

Active cell counting aggregates the universe in 16x16 blocks. For each block, the count of cells that are both **alive** (alive bit = 1) and **active** (min period = 0, i.e. P0) is summed.

When the global active cell count drops to **zero** — and was previously greater than zero — the universe has ended. All remaining alive cells are oscillators: still lifes, blinkers, and other periodic structures. The universe is "dead" in the sense that no further novel behavior will occur, even though patterns continue to repeat.

After the universe ends, all cells fade to black over approximately 30 generations using a cubic ease-out curve applied as a multiplier to saturation and lightness, then the universe resets.

## Color Rendering

Cells are rendered using the HSL (Hue, Saturation, Lightness) color model.

**Hue** is derived from the cell's hue unit vector (or entropy vector for null cells): `hue = atan2(hue_x, hue_y)`, converted to degrees and normalized to [0, 1].

**Saturation and lightness** depend on the cell's existence state and oscillator classification:

**Active on-cells** (P0, alive): indexed by the 2 most recent prior history bits (4 possible states):

| Pattern | Meaning | Saturation | Lightness |
|---------|---------|-----------|-----------|
| 001 | Newly born (off for a while) | 0.98 | 0.60 |
| 011 | On for 2+ ticks | 0.71 | 0.46 |
| 101 | Brief recharge (off then on) | 0.93 | 0.51 |
| 111 | Sustained on (still-life-like) | 0.71 | 0.26 |

**Oscillator on-cells**: indexed by detected period:

| Period | Saturation | Lightness |
|--------|-----------|-----------|
| P1 (still life) | 0.68 | 0.21 |
| P2 (blinker) | 0.68 | 0.26 |
| P3 | 1.00 | 0.65 |
| P4 | 1.00 | 0.65 |

Still lifes and blinkers are dimmed; rarer oscillators are highlighted.

**Off cells** (exist but dead): ease from recently-died brightness toward a baseline (saturation 0.40, lightness 0.04) using the P1 oscillation counter as a progress indicator. A quadratic ease-out prevents abrupt transitions.

**Frozen cells** (event horizon): rendered at fixed elevated brightness — (saturation 1.0, lightness 0.84) if alive, (saturation 0.0, lightness 0.64) if dead — to visually mark the boundary between the existing universe and the void.

**Null cells** (entropy visualization): rendered using their entropy hue vector at user-configurable saturation and lightness. This creates the shimmering "quantum foam" background visible beyond the event horizon.

**Newly created cells**: cells that just came into existence start at reduced brightness — (saturation 0.6, lightness 0.2) if alive, (saturation 0.0, lightness 0.05) if dead — before normal rendering takes over on subsequent ticks.

All saturation and lightness values are scaled by user-configurable multipliers (`saturation_on`, `saturation_off`, `lightness_on`, `lightness_off`) and by the `existence` fade multiplier (1.0 during normal operation, easing to 0.0 after the universe ends).

## Implementation Notes

### Normalization Overflow on Limited-Precision Hardware

When summing hue vectors from up to 9 sources (8 neighbors + own entropy), the intermediate vector magnitude can overflow limited-precision floating point. For example, a max component sum of 3 x 127 = 381 yields `dot(v, v)` up to ~290,000 — which exceeds FP16's maximum of ~65,504.

To prevent this, scale the vector sum down before normalizing (e.g. divide by 4). Since `normalize()` only depends on direction, scaling does not affect the result. This applies to all hue vector summation paths: color inheritance, observation-based hue blending, and nucleation pressure vectors.

### Near-Zero Vector Epsilon

When normalizing a vector that could be near-zero (e.g. residual entropy pressure, hue sums where contributions cancel out), check `dot(v, v) > epsilon` before normalizing to avoid producing NaN or Inf. If the vector is below the threshold, fall back to null hue (which will be replaced by the default hue `(0, 127)` downstream).

### Torus Wrapping for Non-Power-of-Two Sizes

All neighbor lookups must wrap coordinates around the torus. Use `(coord + size) % size` rather than bitwise masking, to support universes with arbitrary (non-power-of-two) dimensions. This applies to both cell state lookups and entropy vector lookups.

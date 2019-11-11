WebGL2 Conway's Game of Life
============================

This is my take on Conway's Game of Life. The main features were originally written in JS 12/2018-01/2019, converted to
WebGL1 shortly after, and then to WebGL2 to allow for multiple outputs from the main shader.

## Additional Features

### "Big Bang" start to the universe
The universe starts as a single point, and expands at a rate of one cell per generation, in every direction.

This came out of thinking how to build a massively distributed GoL universe. Because the state of each cell
is impacted by its immediate neighbors, unless the universe size was constrained, the impact of each cell's state could
potentially expand the universe's size by a rate of one cell per generation, in every direction. (See:
[speed of light](https://www.conwaylife.com/wiki/Speed))

If we follow that backwards to a single point in the first generation, that single cell has no neighbors, so what
determines the cell's state? We could start the universe out as [soup](https://www.conwaylife.com/wiki/Soup),
so each cell has a random initial state. Since this initial state isn't determined by the universe's state, let's
consider the cell to be outside of the universe, where time doesn't yet tick.

Even with an initial state set, a single cell can't tick, because it has no neighbors to determine its next state. As
the universe expands, still the cells at the boundary don't have any neighbors in the direction outside the universe,
so they also can't tick.

Based on that, each cell needs to exist for two generations, before it can start ticking. The first generation it is
created, and has its initial state randomly set. The second generation its state doesn't change, because it doesn't have
any neighbors away from the center of the universe. Since it existed with a state in the last generation though, it does
allow its neighbors toward the center to tick, by providing its state.

#### Generation -2
Because the first cell needs two generations before it starts ticking, and we want the universe to start ticking at
generation zero, the game starts at generation -2. As the game runs, there will be a square ring two cells wide, of
non-ticking cells going through their initialization phase. In this implementation, instead of an infinitely expanding
universe, a screen sized [torus](https://www.conwaylife.com/wiki/Torus) is used. As a result, the universe boundaries
collide once the edge of the torus is reached.

So let's define a few things that fall into place with an infinitely expanding universe that starts from nothing:
```
universe_edge_dist = generation;              // distance from the universe's center, to the edge of where time ticks
universe_edge_length = 2 * generation + 1;    // universe starts as a single point, and expands at the speed of light
event_horizon_dist = universe_edge_dist + 1;  // distance to the universe boundary, state exists, but time doesn't tick
entropy_dist = event_horizon_dist + 1;        // distance to where the initial state is being injected into the universe
```

At generation -2, the universe has a negative size, so it doesn't yet exist. The distance to the "event horizon", for
lack of a better name, where time doesn't yet tick, is -1. It's just on the other side of the universe, pushing the
first bit of entropy into the universe. And the distance to where entropy is injected is 0, so the first cell has its
initial state set.

#### Generation -1
At generation -1, the universe still has a negative size, so there's nowhere for time to tick. The event horizon has
just entered the universe at the center, and a ring of entropy is injected around that single point.

#### Generation 0
The universe now has a size of 1, and because that single cell now is surrounded by neighboring event horizon cells, it
is able to start ticking. From here on out, within the boundaries of the universe, the game runs normally.

#### Side note: injecting 100% alive cells
When tweaking the universe so that each cell has a 100% chance of starting out alive, an interesting pattern emerges.
TODO: link w/ param to set alive odds to 100%

### Cells inherit color
In addition to an on/off state, each cell also stores a hue angle as a 2D unit vector. When a new cell is born, it
inherits the color of its three parents, by summing and normalizing their hue vectors. A 2D vector is used instead of
storing the hue angle as a single number, to simplify handling the 360/0&deg; boundary.

It turns out somebody else built this same feature and solution several years before I did, and did a nice job of
[documenting it in more detail](https://jimblackler.net/blog/?p=384).

### Oscillator detection
Some lifeforms form [oscillators](https://www.conwaylife.com/wiki/Oscillator), most frequently
[blinkers](https://www.conwaylife.com/wiki/Blinker), which oscillate at a period of 2. Other common oscillators have
[periods as high as 15](https://www.conwaylife.com/wiki/Pentadecathlon). Detecting oscillators as separate from
non-oscillating lifeforms allows for other features, like [Active lifeform highlighting](#active-lifeform-highlighting)
and [End of the Universe detection](#end-of-the-universe-detection).

#### History bit shifting
Cell state is shifted into a history texture, using alternating front and back textures, to conform to WebGL2.
```GLSL
next_history.r = last_history.r << 1 | uint(next_cell.r);
```

To detect an oscillator of period P, the last P states are compared to the prior P states:
```GLSL
uint mask = uint((1 << p) - 1);
bool is_match = (history & mask) == ((history >> p) & mask);
```

Since this requires the last 2*P states to be stored in history, and P=15 is the largest oscillator that is being
tracked, an `R32UI` texture format is used for the history textures.

#### Oscillation counters
The lightness and saturation of a cell is altered for oscillators, depending on their period. P1 (steady state), and
P2 (most frequently blinkers), are dimmed because they are so common. Other oscillators are highlighted for their 
rarity. I also tried rotating the hue of these oscillators, however this isn't working correctly as implemented.

However, an oscillator also oscillates at all multiples of its period. So for example, a P2 is also a P4, P6, etc, and
a P1 oscillates at all periods up to 1/2 its lifespan.

To detect the minimum period for an oscillator, a count is kept for each P being detected, for each cell. When
`is_match` is true, the count is incremented, and when false the count is reset to zero. Since a lower P will have its
count naturally increment faster than a higher P, the P with the highest count is considered the oscillation period of
the cell. To avoid identifying random state changes as oscillators, a minimum oscillation threshold is used.

However, a single byte is used to store the count of each P being tracked, for each cell. So once this overflows, or
becomes saturated at 255, it becomes impossible to determine the P with the max oscillation count. To prevent this
issue, the count is clamped to `256 - P`:
```GLSL
// clamp count at 256 - p, so that for example a P2 isn't seen as a P4 when both hit 255 length
uint next_increment = min(prev_osc_count + uint(1), uint(256) - p);
```

#### Active lifeform highlighting
Since the active lifeforms tend to be more interesting than steady state (P1) and simple oscillators (P2), those cells
are highlighted with a higher saturation and lightness. To add extra highlighting to cells that are turning on after
being off for a while, as well as fade out cells that stay alive, the last three states of the cell are used:
```GLSL
const float LIGHTNESS[4] = float[4](
  0.6,  // 001
  0.36, // 011
  0.41, // 101
  0.26  // 111
);
```

#### End of the universe detection
Eventually every GoL universe uses up its entropy, and reaches a steady state in which all alive cells are oscillators.
After this point, nothing new will happen, and continuing the simulation is no longer interesting. Once it's detected
that every cell is either dead or an oscillator, the game is ended, and a new one begins.
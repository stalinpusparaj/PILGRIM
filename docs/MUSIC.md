# Music of PILGRIM: THE NARROW WAY

The twelve songs of GDD 2.13 live as note data in `content/music/` (`themes.ts` exports `SONGS`; the notes are in
`songs-pilgrim.ts`, `songs-road.ts`, `songs-fair.ts` and `songs-shadow.ts`). The in-house sequencer
(`src/audio/Sequencer.ts`) plays them on the synth instruments, and `?music=<songId>` opens the test page.

## Originality statement

Every melody, counter-melody, bass line and arrangement in `content/music/` is an **original composition written
for this game**. Nothing is transcribed, quoted, paraphrased or closely imitated from any existing song. That covers
hymns (including "To Be a Pilgrim"/Monks Gate, Amazing Grace, Slane, Old Hundredth, Nicaea, How Great Thou Art,
Abide With Me, Adeste Fideles), folk and dance tunes (Greensleeves, Simple Gifts, Scarborough Fair, traditional
jigs), classical themes (Ode to Joy, Pachelbel's Canon and its chord sequence, Morning Mood, Für Elise), nursery
tunes (Twinkle Twinkle, Frère Jacques, My Bonnie, Pop Goes the Weasel), and any film or game score, above all the
2019 Pilgrim's Progress film. Famous openings were avoided on purpose: no do-re-mi-do, no 5-1-2-3, no
sol-up-to-mi'-then-down (My Bonnie), no semitone see-saw before a falling 4th (Für Elise), no 1-2-3-5-3-2-1
pastoral (a well-known film theme). Two motifs were changed during composition because their first notes
came too close to a known tune. What the songs share with older music is only common grammar: major and minor
scales, cadences, oom-pah, drones and the like.

## Writing and checking songs

- Grammar: `TrackDef.notes` in `src/audio/types.ts`. One beat = one meter-bottom note, every bar adds up to
  `meter[0]` beats, every track fills exactly `loopBars` bars. `validateSong()` (`src/audio/seq-validate.ts`)
  checks all of it and logs problems in dev builds; all twelve songs pass with no problems.
- Helpers (`content/music/notation.ts`) only build strings: `bars()` joins bars with `|`, `rep()` repeats,
  `arp()` writes broken chords, `pulse()` repeated notes with a velocity ramp, `octave()` transposes by octaves,
  `triplets()` turns 6/8 eighth-counts into 2/4 triplet beats.
- Tempo: the sequencer caps bpm at 260 beats a minute, counted in meter-bottom notes. A fast 6/8 jig would need
  about 400 eighths a minute, so the jig is written in 2/4 with triplet eighths (`1/3`, `2/3` beats) and its bpm is
  the dotted-quarter pulse.
- Ranges, for laptop and phone speakers: tunes mostly sit in D4-A5, never above C6 except the music box, bells
  and glockenspiel. Bass never goes below E2. Pads stay between E3 and A4 so they don't muddy the bass
  (Despair's deliberately dark pad goes down to B2).
- Layer gains follow one scheme: tune 0.7-0.8, pad 0.4-0.55, bass 0.5-0.6, drums 0.3-0.5, bells 0.3-0.45. In
  Chrome through the real engine, every song in every state peaks between about -9 and -17 dBFS (RMS about -21 to -29 dBFS):
  even, never clipping, no sudden loud entries.
- States: each track lists the `MusicState`s it plays in, and changing state crossfades the layers. Every song
  has at least two tracks in every state. The default state is `calm`, so every tune plays in `calm`
  (the two drones and the tension bed have no tune as such) and `?music=<id>` gives the real tune straight away.

## The "hope cell"

The Pilgrim hook opens with three rising notes: do, re, then a leap up to sol (D-E-A). The Burden motif is that
cell upside down in minor (D-C-G). In the dark songs the cell comes back quietly in the `joy` state: the last
answer of the Burden, a flute in the Valley (E-F#-B) and the bells in Despair's dungeon (C-D-G). It is a small
promise that the main theme is coming.

## The themes

**Pilgrim (main theme): D major, 4/4, 96 bpm, 16 bars (40 s).** Hopeful, singable, and the emotional heart of the
game: it plays the moment the burden falls. The hook in bar 1 is "do re SOL, la sol" (D4 E4 A4 B4 A4) in a
short-short-LONG-short-short rhythm, answered in bar 2 by a gentle fall (fa. mi re). The hook comes back in bars 3
and 5 and its leap opens wider each time (a 4th, then a 5th, then a minor 6th up to D5), so the tune literally
opens up. The B phrase walks up over IV-V-vi to the top note, F#5, on the relative minor (bittersweet). Then the
hook returns and the tune steps down the scale to a plain, satisfying cadence on D. Arrangement: flute tune, warm
pad, finger-picked pluck in eighths, bass in half notes. `joy` adds a marimba doubling the tune (clear attack on
small speakers), a sustained choir harmony line always below the tune (in the hook bars it enters a beat late,
under the long note, so the rising "do re" stays on top; at the cadences it sits under the final D), soft
kick-and-rim drums with hats, and bell sparkles. `sad` is
pad plus the flute, softly. `tension` drops the tune (pad, picking, bass). `boss` is the calm band plus drums.

**Title: D major, 4/4, 76 bpm, 16 bars (50 s).** A lullaby version of the Pilgrim A phrase. A music box plays it
an octave up, then again at the original pitch, warmer, while bell chimes answer from above. A soft pad holds the
chords. `joy` adds a quiet choir under the second pass.

**Burden: D minor, 4/4, 60 bpm, 8 bars (32 s).** Slow and low. The motif is three heavy notes, D-C-G (a step
down, then a 4th down), the Pilgrim hook upside down. Low strings play it with the bass and soft tom thuds, like
heavy footsteps. Each bar of motif is answered by a one-semitone sigh that starts higher every time (F-E, Bb-A,
D-C#). The last answer is the Pilgrim cell itself, D-E-A, very quietly. Harmony moves i-iv / VI-V. States: `calm`
flute answers; `sad` the choir sings them; `tension` adds a slow plucked tread of eighths; `boss` tread and
thuds; `joy` adds bells echoing the answers an octave up.

**Mr Worldly Wiseman: F major, 3/4 waltz, 138 bpm, 32 bars (42 s), form A B A C.** Charming, posh and a bit
silly. In the A strain every other bar is a falling arpeggio, a step lower each time (F5, E5, D5, C5), like a
pompous gentleman bowing his way down a grand staircase. Between the bows he fusses with a chromatic curl (Bb A
G# A F). B has a silly chromatic climb (B C C# D F). C is a mock-serious episode in D minor. Pizzicato pluck tune,
a bassoon-ish low flute an octave below, oom (bass on the downbeat) pah-pah (plucked chords). `joy` adds the flute
at pitch and a wood-block "tock"; `sad` keeps only the low flute, the oom and a soft pad.

**The Interpreter: G major, 3/4, 76 bpm, 16 bars (38 s).** A gentle music box, curious and full of wonder. Each
phrase climbs a few steps ("mi. fa sol") and leaps up to a long note, and each one reaches higher (G5, then B5,
then C6), as if looking at the next picture on the wall. Two lydian glints (F# over C in bar 9, C# in bar 14) add the "ooh". Music
box tune over a music-box arpeggio and a soft pad. `joy` adds bell glints; `tension`/`boss` add a soft bass;
`sad` is tune and pad only.

**Apollyon: E minor march, 4/4, 84 bpm, 16 bars (46 s).** Low and heavy, a cartoon menace, never terrifying.
The motif is a stamp and a leap: "DUM . da-DOOM" (E3, E3, up to B3), then a heavy fall down the chord. The middle
section creeps upward in half notes over a drummed E pedal, like a big lizard climbing the road, then the stamp
returns. The tune is on low strings with the bass marching in quarters. `calm` strings, bass and pad; `tension`
adds the kick; `boss` adds a snare with ruffs and tom fills, a low choir, and the strings doubled an octave up so
the tune cuts through on phones. `sad` is strings and pad; `joy` is lighter: the high strings over pad and bass.

**The Valley of the Shadow: E (suspended), 4/4, 52 bpm, 8 bars (37 s).** A drone, spooky-fun rather than scary.
A low E drone runs under suspended chords that slide to a neighbouring F chord and back (Esus2, F/E, D/E, C/E). An
"aah" choir leans on half steps, and bells twinkle rarely. Major key, minor key? Deliberately unclear. `tension`
adds a cartoon tiptoe on plucked whole tones; `boss` adds a soft heartbeat; `joy` brings the hope cell on a flute
(E-F#-B) over the drone.

**Vanity Fair: C major jig (6/8 feel, written 2/4 in triplets), 132 bpm dotted-quarter pulse, 32 bars (29 s),
form A B C A.** Fast and a bit too much, a fairground barker. The hook is "DO' sol DO' sol" ("come BUY, come
BUY!"), then a rattle down the scale and chromatic wiggles (D#-E, F#-G). The C strain shouts the same call a 5th
lower, in F. Busy marimba broken chords on every eighth, offbeat plucks, bass on both dotted beats. `joy`/`boss`
add drums, hats and a glockenspiel doubling the flute, which is exactly one layer too many. `tension` is marimba,
bass, pad and drums with no tune; `sad` is pad and bass.

**Giant Despair: C minor, 4/4, 54 bpm, 8 bars (36 s).** A drone: a dark, low pad that barely moves (Cm, Ab, Cm,
Fm, Cm, Ab, G, Cm), with bells that drip slowly and unevenly in the dungeon. `tension`/`boss` add a low string
line and slow tom thumps; `sad` adds a quiet choir; `joy` swaps the gloom for the hope cell on bells (C-D-G), for
when the Key of Promise is near.

**The Delectable Mountains: A major, 3/4, 88 bpm, 16 bars (33 s).** Pastoral and airy. The tune is a shepherd's
call: a long high note falls a 5th, then climbs back up, and each call starts higher (E5, F#5, A5), like an echo
answering from further up the hill. In the second half the call rises instead of falling, and the view opens. A
lydian G# over D adds air. Open-fifth pad, plucked fifths, a drone-like bass, flute on top. `joy` adds bells;
`tension` drops the tune; `sad` is the flute over the pad.

**The Celestial City (finale): E major, 4/4, 84 bpm, 16 bars (46 s).** Full, bright and triumphant: the Pilgrim
theme restated a whole step higher than it has ever been heard. Where the main theme rests at bar 8, this one
climbs on up the E chord. The B climax reaches G#5. A new ending sings the hook, then its widest leap, then
cadences on E5, an octave above where the tune began. Flute tune, strings an octave below, a choir harmony line
under the tune (entering a beat late in the hook bars, climbing under bar 8), pad, harp-like pluck, bass, bells (chimes at phrase starts, falling E-major cascades where phrases breathe), drums
and cymbal swells. `joy`/`boss` play everything; `calm` drops the drums; `sad` keeps strings, choir and pad;
`tension` keeps the tune, harp, bass and pad.

**Tension bed ("Look Out!"): A minor, 4/4, 112 bpm, 8 bars (17 s).** A generic bed for arrows and chases. A bass
ostinato in eighths jumps the octave. Strings pulse in eighths, swelling across each pair of bars (Am, F, Dm, E),
and a quick four-note rising "look out!" figure ends every second bar. Kick and rim are soft. `boss` adds hats;
`calm` is pad and ostinato; `sad` is pad and strings.
